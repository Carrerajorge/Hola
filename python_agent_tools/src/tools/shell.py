from typing import Optional, List
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import asyncio
import shlex

class ShellInput(ToolInput):
    command: str = Field(..., description="Command to execute")
    timeout: int = Field(30, ge=1, le=300)
    working_dir: Optional[str] = None

class ShellOutput(ToolOutput):
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    return_code: Optional[int] = None

@ToolRegistry.register
class ShellTool(BaseTool[ShellInput, ShellOutput]):
    name = "shell"
    description = "Executes shell commands safely"
    category = ToolCategory.SYSTEM
    priority = Priority.CRITICAL
    dependencies = []
    
    ALLOWED_COMMANDS = ["ls", "cat", "grep", "find", "echo", "pwd", "head", "tail", "wc"]
    
    async def execute(self, input: ShellInput) -> ShellOutput:
        self.logger.info("shell_execute", command=input.command[:50])
        
        cmd_parts = shlex.split(input.command)
        if not cmd_parts or cmd_parts[0] not in self.ALLOWED_COMMANDS:
            return ShellOutput(success=False, error=f"Command not allowed: {cmd_parts[0] if cmd_parts else 'empty'}")
        
        try:
            proc = await asyncio.create_subprocess_shell(
                input.command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=input.working_dir
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=input.timeout)
            return ShellOutput(
                success=proc.returncode == 0,
                stdout=stdout.decode() if stdout else None,
                stderr=stderr.decode() if stderr else None,
                return_code=proc.returncode
            )
        except asyncio.TimeoutError:
            return ShellOutput(success=False, error="Command timed out")
        except Exception as e:
            return ShellOutput(success=False, error=str(e))
