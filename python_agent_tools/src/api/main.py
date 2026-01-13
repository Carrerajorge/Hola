from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, get_type_hints, Type
import structlog

from ..utils.logging_config import setup_logging
from ..utils.config import get_settings

setup_logging()
logger = structlog.get_logger(__name__)
settings = get_settings()

from ..tools.base import BaseTool, ToolCategory, Priority

def _register_tools():
    """Import all tools to register them."""
    from ..tools.shell import ShellTool
    from ..tools.code_execute import CodeExecuteTool
    from ..tools.file_tools import FileReadTool, FileWriteTool
    from ..tools.plan import PlanTool
    from ..tools.orchestrate import OrchestrateTool
    from ..tools.memory_tools import MemoryStoreTool, MemoryRetrieveTool, ContextManageTool
    from ..tools.reason import ReasonTool
    from ..tools.message import MessageSendTool, MessageReceiveTool, BroadcastTool
    from ..tools.search_web import SearchWebTool
    from ..tools.api_call import ApiCallTool
    from ..tools.embeddings import EmbeddingsTool
    from ..tools.secrets_manage import SecretsManageTool
    from ..tools.sanitize_input import SanitizeInputTool

_register_tools()

from ..core.registry import registry
from ..core.factory import ToolFactory

app = FastAPI(
    title="Python Agent Tools API",
    description="API for executing agent tools",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .agents import agents_router
app.include_router(agents_router, prefix="/agents", tags=["agents"])

factory = ToolFactory()

class ToolExecuteRequest(BaseModel):
    tool_name: str
    input: Dict[str, Any]

class ToolExecuteResponse(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}

class ToolInfo(BaseModel):
    name: str
    description: str
    category: str
    priority: str
    dependencies: List[str]

@app.get("/health")
async def health():
    return {"status": "healthy", "tools_count": len(registry.list_all())}

@app.get("/tools", response_model=List[ToolInfo])
async def list_tools():
    """List all registered tools."""
    tools = []
    for name in registry.list_all():
        tool_class = registry.get(name)
        if tool_class:
            tools.append(ToolInfo(
                name=tool_class.name,
                description=tool_class.description,
                category=tool_class.category.value,
                priority=tool_class.priority.value,
                dependencies=tool_class.dependencies
            ))
    return tools

@app.get("/tools/{tool_name}")
async def get_tool(tool_name: str):
    """Get tool details."""
    tool_class = registry.get(tool_name)
    if not tool_class:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    return ToolInfo(
        name=tool_class.name,
        description=tool_class.description,
        category=tool_class.category.value,
        priority=tool_class.priority.value,
        dependencies=tool_class.dependencies
    )

@app.post("/tools/{tool_name}/execute", response_model=ToolExecuteResponse)
async def execute_tool(tool_name: str, request: ToolExecuteRequest):
    """Execute a tool with given input."""
    logger.info("execute_tool_request", tool=tool_name)
    
    tool = factory.get_or_create(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    try:
        tool_class = tool.__class__
        input_class: Optional[Type[Any]] = None
        for base in getattr(tool_class, '__orig_bases__', []):
            if hasattr(base, '__args__') and len(base.__args__) > 0:
                input_class = base.__args__[0]
                break
        if input_class is None:
            raise HTTPException(status_code=500, detail="Could not determine input class for tool")
        tool_input = input_class(**request.input)
        result = await tool.execute(tool_input)
        return ToolExecuteResponse(
            success=result.success,
            data=result.data,
            error=result.error,
            metadata=result.metadata
        )
    except Exception as e:
        logger.error("tool_execution_failed", tool=tool_name, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
