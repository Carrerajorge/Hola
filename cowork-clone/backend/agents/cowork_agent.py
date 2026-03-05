"""
Cowork Agent - The main AI agent that orchestrates file management tasks.
Implements a tool-use loop similar to Claude's Cowork mode.
"""
import json
import uuid
import asyncio
from typing import List, Dict, Any, Optional, Callable
from datetime import datetime

from backend.agents.ai_provider import get_provider, AGENT_TOOLS, AIProvider
from backend.services.file_manager import FileManager
from backend.models.schemas import TaskItem, TaskPlan, TaskStatus


class CoworkAgent:
    """Main agent that processes user requests using AI + file management tools."""

    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.file_manager = FileManager(workspace_path)
        self.provider: AIProvider = None
        self.conversation_history: List[Dict] = []
        self.current_plan: Optional[TaskPlan] = None
        self.tasks: List[Dict] = []
        self._event_callbacks: List[Callable] = []
        self.max_tool_iterations = 15  # Safety limit

    def _init_provider(self):
        """Lazy-initialize the AI provider."""
        if self.provider is None:
            self.provider = get_provider()

    def on_event(self, callback: Callable):
        """Register an event callback for real-time updates."""
        self._event_callbacks.append(callback)

    async def _emit(self, event_type: str, data: Any):
        """Emit an event to all registered callbacks."""
        event = {"type": event_type, "data": data, "timestamp": datetime.now().isoformat()}
        for cb in self._event_callbacks:
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(event)
                else:
                    cb(event)
            except Exception as e:
                print(f"Event callback error: {e}")

    # ─── Tool Execution ──────────────────────────────────
    async def _execute_tool(self, name: str, arguments: Dict) -> str:
        """Execute a tool call and return the result as a string."""
        try:
            await self._emit("tool_start", {"tool": name, "args": arguments})

            if name == "list_files":
                result = await self.file_manager.list_directory(arguments.get("path", "."))
                output = json.dumps([{
                    "name": f.name, "path": f.path, "size": f.size,
                    "is_dir": f.is_dir, "extension": f.extension
                } for f in result], indent=2)

            elif name == "read_file":
                content = await self.file_manager.read_file(arguments["path"])
                # Truncate very long files
                if len(content) > 10000:
                    output = content[:10000] + f"\n... [truncated, total {len(content)} characters]"
                else:
                    output = content

            elif name == "write_file":
                result = await self.file_manager.write_file(arguments["path"], arguments["content"])
                output = f"File written successfully: {result.path} ({result.size} bytes)"

            elif name == "create_directory":
                result = await self.file_manager.create_directory(arguments["path"])
                output = f"Directory created: {result.path}"

            elif name == "move_file":
                result = await self.file_manager.move(arguments["source"], arguments["destination"])
                output = f"Moved to: {result.path}"

            elif name == "copy_file":
                result = await self.file_manager.copy(arguments["source"], arguments["destination"])
                output = f"Copied to: {result.path}"

            elif name == "delete_file":
                await self.file_manager.delete(arguments["path"])
                output = f"Deleted: {arguments['path']}"

            elif name == "search_files":
                results = await self.file_manager.search_files(
                    arguments["pattern"],
                    arguments.get("path", ".")
                )
                output = json.dumps([{
                    "name": f.name, "path": f.path, "size": f.size
                } for f in results], indent=2)

            elif name == "search_content":
                results = await self.file_manager.search_content(
                    arguments["query"],
                    arguments.get("path", ".")
                )
                output = json.dumps(results, indent=2)

            elif name == "organize_files":
                method = arguments.get("method", "extension")
                path = arguments.get("path", ".")
                if method == "date":
                    result = await self.file_manager.organize_by_date(path)
                else:
                    result = await self.file_manager.organize_by_extension(path)
                output = json.dumps(result, indent=2)

            elif name == "workspace_info":
                info = await self.file_manager.get_workspace_info()
                output = json.dumps({
                    "path": info.path,
                    "total_files": info.total_files,
                    "total_dirs": info.total_dirs,
                    "total_size_mb": round(info.total_size / (1024 * 1024), 2),
                    "file_types": info.file_types
                }, indent=2)

            else:
                output = f"Unknown tool: {name}"

            await self._emit("tool_result", {"tool": name, "result": output[:500]})
            return output

        except Exception as e:
            error_msg = f"Error executing {name}: {str(e)}"
            await self._emit("tool_error", {"tool": name, "error": str(e)})
            return error_msg

    # ─── Main Chat Loop ──────────────────────────────────
    async def process_message(self, user_message: str) -> Dict:
        """
        Process a user message through the AI agent loop.
        Implements the tool-use loop: AI responds → tool calls → results → AI responds...
        """
        self._init_provider()

        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        await self._emit("thinking", {"message": "Processing your request..."})

        all_text = ""
        all_files_affected = []
        iteration = 0

        while iteration < self.max_tool_iterations:
            iteration += 1

            # Get AI response
            response = await self.provider.chat(
                messages=self.conversation_history,
                tools=AGENT_TOOLS
            )

            text_content = response.get("content", "")
            tool_calls = response.get("tool_calls", [])

            if text_content:
                all_text += text_content
                await self._emit("text", {"content": text_content})

            # If no tool calls, we're done
            if not tool_calls:
                break

            # Process tool calls
            # Add assistant message with tool use to history
            if response.get("stop_reason") == "tool_use" or tool_calls:
                # For Anthropic format
                assistant_content = []
                if text_content:
                    assistant_content.append({"type": "text", "text": text_content})
                for tc in tool_calls:
                    assistant_content.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc["arguments"]
                    })
                self.conversation_history.append({
                    "role": "assistant",
                    "content": assistant_content
                })

                # Execute tools and add results
                tool_results = []
                for tc in tool_calls:
                    await self._emit("task_update", {
                        "action": tc["name"],
                        "status": "in_progress",
                        "detail": json.dumps(tc["arguments"])
                    })

                    result = await self._execute_tool(tc["name"], tc["arguments"])

                    # Track affected files
                    for key in ["path", "source", "destination"]:
                        if key in tc["arguments"]:
                            all_files_affected.append(tc["arguments"][key])

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tc["id"],
                        "content": result
                    })

                    await self._emit("task_update", {
                        "action": tc["name"],
                        "status": "completed",
                        "result": result[:200]
                    })

                self.conversation_history.append({
                    "role": "user",
                    "content": tool_results
                })
            else:
                # Simple text response - add to history and break
                self.conversation_history.append({
                    "role": "assistant",
                    "content": text_content
                })
                break

        # Final response
        if iteration >= self.max_tool_iterations:
            all_text += "\n\n⚠️ Reached maximum number of operations. Some tasks may be incomplete."

        # Clean up conversation history to keep it manageable
        if len(self.conversation_history) > 40:
            # Keep system context and recent messages
            self.conversation_history = self.conversation_history[-30:]

        return {
            "message": all_text,
            "files_affected": list(set(all_files_affected)),
            "iterations": iteration
        }

    def reset_conversation(self):
        """Clear conversation history."""
        self.conversation_history = []
        self.tasks = []
        self.current_plan = None
