from typing import Optional, List, Tuple, Dict
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import asyncio
import shlex
import os
import re

class ShellInput(ToolInput):
    command: str = Field(..., description="Command to execute", max_length=1000)
    timeout: int = Field(30, ge=1, le=300)
    working_dir: Optional[str] = Field(None, max_length=500)

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
    
    ALLOWED_COMMANDS: Dict[str, str] = {
        "ls": "/bin/ls",
        "cat": "/bin/cat",
        "grep": "/bin/grep",
        "find": "/usr/bin/find",
        "echo": "/bin/echo",
        "pwd": "/bin/pwd",
        "head": "/usr/bin/head",
        "tail": "/usr/bin/tail",
        "wc": "/usr/bin/wc",
    }
    FORBIDDEN_PATTERNS = re.compile(r'[;&|`$<>\\]|\.\.')
    ALLOWED_WORKING_DIRS: Tuple[str, ...] = ("/tmp", "/home", "/var/log")
    MAX_ARG_LENGTH: int = 500
    
    def _resolve_command(self, cmd_name: str) -> Optional[str]:
        """Resolve command name to a safe, absolute path from whitelist."""
        base_cmd = os.path.basename(cmd_name)
        safe_path = self.ALLOWED_COMMANDS.get(base_cmd)
        if safe_path and os.path.isfile(safe_path) and os.access(safe_path, os.X_OK):
            return safe_path
        return None
    
    def _validate_command(self, cmd_parts: List[str]) -> Optional[str]:
        if not cmd_parts:
            return "Empty command"
        
        if self._resolve_command(cmd_parts[0]) is None:
            base_cmd = os.path.basename(cmd_parts[0])
            return f"Command not allowed: {base_cmd}"
        
        for arg in cmd_parts[1:]:
            if len(arg) > self.MAX_ARG_LENGTH:
                return f"Argument too long: {len(arg)} chars"
            if self.FORBIDDEN_PATTERNS.search(arg):
                return f"Forbidden characters in argument: {arg[:20]}"
        
        return None
    
    def _validate_working_dir(self, working_dir: Optional[str]) -> Optional[str]:
        if working_dir is None:
            return None
        
        try:
            normalized = os.path.normpath(os.path.abspath(working_dir))
        except (ValueError, TypeError):
            return "Invalid working directory path"
        
        if not any(normalized.startswith(allowed) for allowed in self.ALLOWED_WORKING_DIRS):
            return f"Working directory not allowed: {normalized}"
        
        if not os.path.isdir(normalized):
            return f"Working directory does not exist: {normalized}"
        
        return None
    
    async def execute(self, input: ShellInput) -> ShellOutput:
        self.logger.info("shell_execute", command=input.command[:50])
        
        try:
            cmd_parts = shlex.split(input.command)
        except ValueError as e:
            return ShellOutput(success=False, error=f"Invalid command syntax: {e}")
        
        cmd_error = self._validate_command(cmd_parts)
        if cmd_error:
            return ShellOutput(success=False, error=cmd_error)
        
        dir_error = self._validate_working_dir(input.working_dir)
        if dir_error:
            return ShellOutput(success=False, error=dir_error)
        
        safe_cwd = os.path.normpath(os.path.abspath(input.working_dir)) if input.working_dir else None
        
        safe_cmd_path = self._resolve_command(cmd_parts[0])
        if safe_cmd_path is None:
            return ShellOutput(success=False, error="Command resolution failed")
        
        try:
            proc = await asyncio.create_subprocess_exec(
                safe_cmd_path,
                *cmd_parts[1:],
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=safe_cwd
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=input.timeout)
            return ShellOutput(
                success=proc.returncode == 0,
                stdout=stdout.decode(errors='replace') if stdout else None,
                stderr=stderr.decode(errors='replace') if stderr else None,
                return_code=proc.returncode
            )
        except asyncio.TimeoutError:
            return ShellOutput(success=False, error="Command timed out")
        except FileNotFoundError:
            return ShellOutput(success=False, error=f"Command not found: {cmd_parts[0]}")
        except PermissionError:
            return ShellOutput(success=False, error="Permission denied")
        except Exception as e:
            self.logger.error("shell_execute_error", error=str(e))
            return ShellOutput(success=False, error="Execution failed")
