"""
Pydantic models for request/response schemas.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


# ─── Enums ───────────────────────────────────────────────
class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class FileActionType(str, Enum):
    READ = "read"
    WRITE = "write"
    CREATE = "create"
    DELETE = "delete"
    RENAME = "rename"
    MOVE = "move"
    LIST = "list"
    SEARCH = "search"
    ORGANIZE = "organize"


# ─── Chat ────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: MessageRole
    content: str
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    workspace_path: Optional[str] = None


class ChatResponse(BaseModel):
    message: str
    role: MessageRole = MessageRole.ASSISTANT
    tasks: Optional[List[Dict[str, Any]]] = None
    files_affected: Optional[List[str]] = None
    timestamp: datetime = Field(default_factory=datetime.now)


# ─── Tasks ───────────────────────────────────────────────
class TaskItem(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    subtasks: Optional[List["TaskItem"]] = None


class TaskPlan(BaseModel):
    id: str
    title: str
    description: str
    tasks: List[TaskItem]
    created_at: datetime = Field(default_factory=datetime.now)


# ─── Files ───────────────────────────────────────────────
class FileInfo(BaseModel):
    name: str
    path: str
    size: int
    is_dir: bool
    extension: Optional[str] = None
    modified_at: Optional[datetime] = None
    mime_type: Optional[str] = None


class FileOperation(BaseModel):
    action: FileActionType
    path: str
    destination: Optional[str] = None
    content: Optional[str] = None
    pattern: Optional[str] = None


class WorkspaceInfo(BaseModel):
    path: str
    total_files: int
    total_dirs: int
    total_size: int
    file_types: Dict[str, int]
