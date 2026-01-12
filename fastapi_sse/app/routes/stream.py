"""SSE streaming endpoint with Redis Streams consumer groups."""
import asyncio
import json
import time
import uuid
from typing import Optional, AsyncIterator
from fastapi import APIRouter, Request, Query, Header, HTTPException, Depends
from fastapi.responses import StreamingResponse
import structlog

from ..session import get_session_manager, SessionManager
from ..redis_streams import get_streams_manager, RedisStreamsManager, StreamEvent
from ..config import get_settings

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Streaming"])


class SSEFormatter:
    """Formats events for Server-Sent Events protocol."""
    
    @staticmethod
    def format(
        event: str,
        data: dict,
        event_id: Optional[str] = None,
        retry: Optional[int] = None
    ) -> str:
        """
        Format data as SSE message.
        
        Args:
            event: Event type name
            data: Event data payload (will be JSON encoded)
            event_id: Optional event ID for client replay
            retry: Optional retry interval in milliseconds
            
        Returns:
            SSE formatted string
        """
        lines = []
        if event_id:
            lines.append(f"id: {event_id}")
        if retry:
            lines.append(f"retry: {retry}")
        lines.append(f"event: {event}")
        lines.append(f"data: {json.dumps(data)}")
        lines.append("")
        lines.append("")
        return "\n".join(lines)


async def stream_events(
    session_id: str,
    request: Request,
    last_event_id: Optional[str],
    session_manager: SessionManager,
    streams_manager: RedisStreamsManager
) -> AsyncIterator[str]:
    """
    Stream events from Redis Streams to SSE client.
    
    Features:
    - Consumer group for reliable delivery
    - Last-Event-ID support for replay/retry
    - Heartbeat to keep connection alive
    - Idle timeout to close stale connections
    - Automatic acknowledgment and deduplication
    
    Args:
        session_id: Session to stream events for
        request: FastAPI request for disconnect detection
        last_event_id: Last event ID from client for replay
        session_manager: Session manager instance
        streams_manager: Redis Streams manager instance
        
    Yields:
        SSE formatted event strings
    """
    settings = get_settings()
    consumer_name = f"sse-{uuid.uuid4().hex[:8]}"
    formatter = SSEFormatter()
    
    start_time = time.time()
    last_activity = time.time()
    events_sent = 0
    
    try:
        yield formatter.format("connected", {
            "session_id": session_id,
            "consumer": consumer_name,
            "timestamp": time.time()
        })
        events_sent += 1
        
        await streams_manager.ensure_consumer_group(session_id, consumer_name)
        
        async for event in streams_manager.iter_events(
            session_id,
            consumer_name,
            last_event_id=last_event_id
        ):
            if await request.is_disconnected():
                logger.info(
                    "client_disconnected",
                    session_id=session_id,
                    events_sent=events_sent
                )
                break
            
            elapsed = time.time() - start_time
            idle_time = time.time() - last_activity
            
            if idle_time > settings.sse_idle_timeout_sec:
                logger.info(
                    "idle_timeout",
                    session_id=session_id,
                    idle_seconds=idle_time
                )
                yield formatter.format("timeout", {
                    "reason": "idle_timeout",
                    "idle_seconds": idle_time
                })
                break
            
            if event.event_type == "heartbeat":
                yield formatter.format("heartbeat", {
                    "ts": time.time(),
                    "session_id": session_id,
                    "events_sent": events_sent,
                    "elapsed_seconds": elapsed
                })
                continue
            
            last_activity = time.time()
            
            yield formatter.format(
                event.event_type,
                event.data,
                event_id=event.event_id
            )
            events_sent += 1
            
            await session_manager.touch(session_id)
            
            if event.event_type in ("final", "error"):
                logger.info(
                    "stream_completed",
                    session_id=session_id,
                    event_type=event.event_type,
                    events_sent=events_sent,
                    duration=time.time() - start_time
                )
                break
    
    except asyncio.CancelledError:
        logger.info(
            "stream_cancelled",
            session_id=session_id,
            events_sent=events_sent
        )
    except Exception as e:
        logger.exception(
            "stream_error",
            session_id=session_id,
            error=str(e)
        )
        yield formatter.format("error", {
            "message": str(e),
            "type": type(e).__name__
        })
    finally:
        logger.debug(
            "stream_closed",
            session_id=session_id,
            events_sent=events_sent,
            duration=time.time() - start_time
        )


@router.get("/chat/stream")
async def chat_stream(
    request: Request,
    session_id: str = Query(..., description="Session ID for the chat"),
    prompt: Optional[str] = Query(None, description="Optional prompt to start processing"),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID", description="Last received event ID for replay"),
    session_manager: SessionManager = Depends(get_session_manager),
    streams_manager: RedisStreamsManager = Depends(get_streams_manager)
):
    """
    Stream chat events via Server-Sent Events.
    
    Opens a persistent SSE connection and streams events from Redis Streams.
    Uses consumer groups for reliable at-least-once delivery with acknowledgment.
    
    **Event Types:**
    - `connected`: Initial connection confirmation
    - `trace`: Intermediate processing events (agent steps, reasoning)
    - `tool_call`: Tool invocation events
    - `tool_result`: Tool execution results
    - `final`: Final result when processing completes
    - `error`: Error events
    - `heartbeat`: Keep-alive pings (every SSE_HEARTBEAT_SEC seconds)
    - `timeout`: Connection closed due to idle timeout
    
    **Replay Support:**
    Include `Last-Event-ID` header to replay events after that ID.
    Useful for recovering from disconnections.
    
    **Connection Lifecycle:**
    - Heartbeat sent every SSE_HEARTBEAT_SEC (default 15s)
    - Connection closed after SSE_IDLE_TIMEOUT_SEC idle time (default 300s)
    - Session TTL refreshed on each non-heartbeat event
    
    Args:
        session_id: Required session identifier
        prompt: Optional prompt to initiate processing
        last_event_id: Optional event ID for replay (from header)
        
    Returns:
        StreamingResponse with text/event-stream content type
        
    Raises:
        404: Session not found
    """
    session = await session_manager.get(session_id)
    
    if not session:
        if prompt:
            session = await session_manager.create(
                session_id=session_id,
                prompt=prompt
            )
            
            try:
                from ..workers.agent_tasks import execute_agent
                task = execute_agent.delay(
                    session_id=session_id,
                    message=prompt,
                    context=None,
                    model=None
                )
                await session_manager.update(session_id, task_id=task.id, status="processing")
            except ImportError:
                await streams_manager.add_event(
                    session_id,
                    "trace",
                    {"message": "Agent worker not available, demo mode"}
                )
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Session {session_id} not found. Provide prompt parameter to create."
            )
    
    logger.info(
        "sse_connection_opened",
        session_id=session_id,
        has_last_event_id=last_event_id is not None,
        has_prompt=prompt is not None
    )
    
    return StreamingResponse(
        stream_events(
            session_id=session_id,
            request=request,
            last_event_id=last_event_id,
            session_manager=session_manager,
            streams_manager=streams_manager
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Last-Event-ID"
        }
    )
