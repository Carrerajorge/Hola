"""
Cowork Clone - Main Application
A file management AI agent inspired by Claude's Cowork mode.
"""
import os
import json
import uuid
import asyncio
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config.settings import get_settings
from backend.agents.cowork_agent import CoworkAgent
from backend.services.file_manager import FileManager

# ─── App Setup ───────────────────────────────────────────
app = FastAPI(
    title="Cowork Clone",
    description="AI-powered file management agent",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Templates and static files
BASE_DIR = Path(__file__).parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "frontend" / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "frontend" / "templates")

# ─── Session Management ─────────────────────────────────
sessions: Dict[str, CoworkAgent] = {}
workspace_paths: Dict[str, str] = {}


def get_or_create_session(session_id: str, workspace_path: str = None) -> CoworkAgent:
    """Get existing session or create a new one."""
    if session_id not in sessions:
        wp = workspace_path or get_settings().workspace_path or os.path.expanduser("~/cowork-workspace")
        os.makedirs(wp, exist_ok=True)
        sessions[session_id] = CoworkAgent(wp)
        workspace_paths[session_id] = wp
    return sessions[session_id]


# ─── Request Models ──────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    workspace_path: Optional[str] = None


class WorkspaceRequest(BaseModel):
    path: str


# ─── Routes ──────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main application page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Process a chat message through the AI agent."""
    session_id = req.session_id or str(uuid.uuid4())
    agent = get_or_create_session(session_id, req.workspace_path)

    try:
        result = await agent.process_message(req.message)
        return JSONResponse({
            "session_id": session_id,
            "message": result["message"],
            "files_affected": result.get("files_affected", []),
            "iterations": result.get("iterations", 0)
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/workspace/set")
async def set_workspace(req: WorkspaceRequest):
    """Set the workspace directory."""
    path = os.path.abspath(req.path)
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail="Directory does not exist")
    return JSONResponse({"path": path, "status": "ok"})


@app.get("/api/workspace/browse")
async def browse_workspace(path: str = ".", session_id: str = "default"):
    """Browse files in the workspace."""
    agent = get_or_create_session(session_id)
    try:
        files = await agent.file_manager.list_directory(path)
        return JSONResponse({
            "files": [
                {
                    "name": f.name,
                    "path": f.path,
                    "size": f.size,
                    "is_dir": f.is_dir,
                    "extension": f.extension,
                    "modified_at": f.modified_at.isoformat() if f.modified_at else None
                }
                for f in files
            ]
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/workspace/info")
async def workspace_info(session_id: str = "default"):
    """Get workspace overview."""
    agent = get_or_create_session(session_id)
    try:
        info = await agent.file_manager.get_workspace_info()
        return JSONResponse({
            "path": info.path,
            "total_files": info.total_files,
            "total_dirs": info.total_dirs,
            "total_size_mb": round(info.total_size / (1024 * 1024), 2),
            "file_types": info.file_types
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/reset")
async def reset_session(session_id: str = "default"):
    """Reset a chat session."""
    if session_id in sessions:
        sessions[session_id].reset_conversation()
    return JSONResponse({"status": "ok"})


# ─── WebSocket for real-time updates ────────────────────
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time agent events."""
    await websocket.accept()

    agent = get_or_create_session(session_id)

    async def send_event(event):
        try:
            await websocket.send_json(event)
        except Exception:
            pass

    agent.on_event(send_event)

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "chat":
                result = await agent.process_message(data["message"])
                await websocket.send_json({
                    "type": "response",
                    "data": {
                        "message": result["message"],
                        "files_affected": result.get("files_affected", []),
                        "iterations": result.get("iterations", 0)
                    }
                })
            elif data.get("type") == "workspace":
                ws_path = data.get("path", ".")
                files = await agent.file_manager.list_directory(ws_path)
                await websocket.send_json({
                    "type": "files",
                    "data": [
                        {"name": f.name, "path": f.path, "size": f.size,
                         "is_dir": f.is_dir, "extension": f.extension}
                        for f in files
                    ]
                })
    except WebSocketDisconnect:
        if session_id in sessions:
            sessions[session_id]._event_callbacks = [
                cb for cb in sessions[session_id]._event_callbacks if cb != send_event
            ]


# ─── Run ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    print(f"""
╔══════════════════════════════════════════════╗
║          🤖 COWORK CLONE v1.0              ║
║   AI-Powered File Management Agent          ║
╠══════════════════════════════════════════════╣
║  Server: http://{settings.host}:{settings.port}            ║
║  Provider: {settings.ai_provider.upper():<32} ║
╚══════════════════════════════════════════════╝
    """)
    uvicorn.run(
        "app:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info"
    )
