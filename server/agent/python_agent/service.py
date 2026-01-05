#!/usr/bin/env python3
"""
FastAPI service that wraps the AI Agent v5.0 for REST API access.
Exposes the Python agent via HTTP endpoints on port 8081.
"""

import os
import sys
import asyncio
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
from contextlib import asynccontextmanager

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "-q"])
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field

from agent_v5 import Agent, AgentConfig, VERSION

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agent_service")

agent_instance: Optional[Agent] = None
startup_time: Optional[datetime] = None


class RunRequest(BaseModel):
    input: str = Field(..., min_length=1, max_length=10000, description="User input for the agent")
    verbose: bool = Field(default=False, description="Enable verbose output")
    timeout: int = Field(default=60, ge=1, le=300, description="Execution timeout in seconds")


class RunResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None
    execution_time: float
    status: Dict[str, Any]


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    agent_state: str
    tools_count: int


class ToolInfo(BaseModel):
    name: str
    description: str
    category: str
    parameters: Dict[str, Any]


class ToolsResponse(BaseModel):
    tools: List[ToolInfo]
    count: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent_instance, startup_time
    logger.info("Starting Python Agent Service v5.0...")
    startup_time = datetime.now()
    agent_instance = Agent(AgentConfig(verbose=False))
    logger.info(f"Agent initialized with {len(agent_instance.tools.list_tools())} tools")
    yield
    logger.info("Shutting down agent service...")
    if agent_instance:
        await agent_instance.cleanup()


app = FastAPI(
    title="Python AI Agent v5.0 Service",
    description="REST API wrapper for the AI Agent v5.0 with browser, documents, and research capabilities",
    version=VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": str(exc), "detail": "Internal server error"}
    )


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint to verify the service is running."""
    global agent_instance, startup_time
    
    if not agent_instance:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    uptime = (datetime.now() - startup_time).total_seconds() if startup_time else 0
    status = agent_instance.get_status()
    
    return HealthResponse(
        status="healthy",
        version=VERSION,
        uptime_seconds=uptime,
        agent_state=status.get("state", "unknown"),
        tools_count=status.get("tools", 0)
    )


@app.get("/tools", response_model=ToolsResponse, tags=["Tools"])
async def list_tools():
    """List all available tools in the agent."""
    global agent_instance
    
    if not agent_instance:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    schemas = agent_instance.tools.get_schemas()
    tools = []
    
    for schema in schemas:
        tools.append(ToolInfo(
            name=schema.get("name", "unknown"),
            description=schema.get("description", ""),
            category=schema.get("category", "general"),
            parameters=schema.get("parameters", {})
        ))
    
    return ToolsResponse(tools=tools, count=len(tools))


@app.post("/run", response_model=RunResponse, tags=["Agent"])
async def run_agent(request: RunRequest):
    """Execute the agent with user input and return the result."""
    global agent_instance
    
    if not agent_instance:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    start_time = datetime.now()
    
    try:
        if request.verbose:
            agent_instance.config.verbose = True
        else:
            agent_instance.config.verbose = False
        
        agent_instance.config.timeout = request.timeout
        
        result = await asyncio.wait_for(
            agent_instance.run(request.input),
            timeout=request.timeout
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        status = agent_instance.get_status()
        
        return RunResponse(
            success=True,
            result=result,
            error=None,
            execution_time=execution_time,
            status=status
        )
        
    except asyncio.TimeoutError:
        execution_time = (datetime.now() - start_time).total_seconds()
        return RunResponse(
            success=False,
            result=None,
            error=f"Execution timed out after {request.timeout} seconds",
            execution_time=execution_time,
            status=agent_instance.get_status() if agent_instance else {}
        )
        
    except Exception as e:
        execution_time = (datetime.now() - start_time).total_seconds()
        logger.error(f"Agent execution error: {e}")
        return RunResponse(
            success=False,
            result=None,
            error=str(e),
            execution_time=execution_time,
            status=agent_instance.get_status() if agent_instance else {}
        )


@app.get("/status", tags=["Status"])
async def get_status():
    """Get detailed agent status."""
    global agent_instance
    
    if not agent_instance:
        raise HTTPException(status_code=503, detail="Agent not initialized")
    
    return {
        "success": True,
        "status": agent_instance.get_status(),
        "history_length": len(agent_instance.history),
        "current_iteration": agent_instance.iteration
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PYTHON_AGENT_PORT", 8081))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
