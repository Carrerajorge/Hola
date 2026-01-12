"""FastAPI SSE Backend for IliaGPT - Production-ready with Redis and Celery."""
import time
import uuid
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from .config import get_settings, Settings
from .redis_client import (
    redis_manager,
    get_session_manager,
    get_event_publisher,
    SessionManager,
    EventPublisher
)
from .schemas import (
    ChatRequest,
    SessionState,
    HealthResponse,
    ErrorResponse
)
from .sse import create_sse_response
from .rate_limiter import RateLimitMiddleware, RateLimiter
from .celery_app import celery_app

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management."""
    logger.info("application_starting")
    
    try:
        await redis_manager.initialize()
        logger.info("redis_connected")
    except Exception as e:
        logger.error("redis_connection_failed", error=str(e))
    
    yield
    
    logger.info("application_shutting_down")
    await redis_manager.close()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Scalable SSE streaming backend for IliaGPT with Redis state and Celery workers",
        lifespan=lifespan
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    app.add_middleware(
        RateLimitMiddleware,
        limiter=RateLimiter(),
        exclude_paths=["/health", "/ready", "/metrics", "/docs", "/openapi.json"]
    )
    
    return app


app = create_app()


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.detail,
            request_id=getattr(request.state, "request_id", None)
        ).model_dump()
    )


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Liveness probe - is the service running?"""
    import concurrent.futures
    
    redis_ok = False
    celery_ok = False
    
    try:
        client = await redis_manager.get_client()
        await client.ping()
        redis_ok = True
    except Exception:
        pass
    
    def check_celery_sync():
        """Check Celery in a thread to avoid blocking the event loop."""
        try:
            from .celery_app import celery_app
            inspect = celery_app.control.inspect()
            ping_result = inspect.ping()
            return ping_result is not None and len(ping_result) > 0
        except Exception:
            return False
    
    try:
        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            celery_ok = await asyncio.wait_for(
                loop.run_in_executor(pool, check_celery_sync),
                timeout=3.0
            )
    except asyncio.TimeoutError:
        celery_ok = False
    except Exception:
        celery_ok = False
    
    status = "healthy" if redis_ok else "unhealthy"
    if redis_ok and not celery_ok:
        status = "degraded"
    
    return HealthResponse(
        status=status,
        version="1.0.0",
        redis=redis_ok,
        celery=celery_ok,
        uptime_seconds=time.time() - START_TIME
    )


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Readiness probe - is the service ready to accept traffic?"""
    try:
        client = await redis_manager.get_client()
        await client.ping()
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Not ready: {str(e)}")


@app.get("/chat/stream", tags=["Chat"])
async def chat_stream(
    request: Request,
    session_id: str = Query(..., description="Session ID for the chat"),
    session_manager: SessionManager = Depends(get_session_manager)
):
    """
    Stream chat events via SSE.
    
    Returns text/event-stream with:
    - connected: Initial connection confirmation
    - trace: Intermediate processing events
    - final: Final result
    - error: Error events
    - heartbeat: Keep-alive pings
    """
    session = await session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    logger.info("sse_connection_opened", session_id=session_id)
    
    return create_sse_response(session_id, request)


@app.post("/chat/start", tags=["Chat"])
async def start_chat(
    chat_request: ChatRequest,
    session_id: Optional[str] = Query(None, description="Existing session ID or new one will be created"),
    session_manager: SessionManager = Depends(get_session_manager),
    event_publisher: EventPublisher = Depends(get_event_publisher)
):
    """
    Start a new chat message processing.
    
    Creates or updates session and queues the agent task for processing.
    Returns session_id to use for streaming events.
    """
    if not session_id:
        session_id = str(uuid.uuid4())
    
    session_state = SessionState(
        session_id=session_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        status="processing",
        context=chat_request.context or {}
    )
    
    await session_manager.set(session_id, session_state.model_dump(mode="json"))
    
    from .workers.agent_tasks import execute_agent
    task = execute_agent.delay(
        session_id=session_id,
        message=chat_request.message,
        context=chat_request.context,
        model=chat_request.model
    )
    
    await session_manager.update(session_id, {"task_id": task.id})
    
    logger.info(
        "chat_started",
        session_id=session_id,
        task_id=task.id,
        message_length=len(chat_request.message)
    )
    
    return {
        "session_id": session_id,
        "task_id": task.id,
        "stream_url": f"/chat/stream?session_id={session_id}"
    }


@app.get("/session/{session_id}", tags=["Session"])
async def get_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """Get current session state."""
    session = await session_manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/session/{session_id}", tags=["Session"])
async def delete_session(
    session_id: str,
    session_manager: SessionManager = Depends(get_session_manager)
):
    """Delete a session."""
    if not await session_manager.exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    
    await session_manager.delete(session_id)
    return {"deleted": True, "session_id": session_id}


@app.get("/metrics", tags=["Monitoring"])
async def get_metrics():
    """Prometheus-compatible metrics endpoint."""
    uptime = time.time() - START_TIME
    
    return {
        "uptime_seconds": uptime,
        "service": "iliagpt-sse",
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "fastapi_sse.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        workers=1 if settings.debug else settings.workers
    )
