#!/usr/bin/env python3
"""
================================================================================
SISTEMA DE AGENTE IA - MÓDULO SANDBOX COMPLETO
================================================================================

Un entorno sandbox seguro y aislado para ejecutar código y comandos.

INSTRUCCIONES PARA REPLIT:
1. Crea un nuevo Repl con Python
2. Copia este archivo completo como main.py (o el nombre que prefieras)
3. Ejecuta: pip install aiofiles rich pydantic
4. Ejecuta el archivo

Autor: Sistema Agente IA
Versión: 1.0.0
================================================================================
"""

import os
import sys
import re
import json
import shutil
import hashlib
import asyncio
import tempfile
import subprocess
import mimetypes
import time
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple, Union, Callable
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod

# Intentar importar dependencias opcionales
try:
    import aiofiles
    AIOFILES_AVAILABLE = True
except ImportError:
    AIOFILES_AVAILABLE = False
    print("⚠️ Instalando aiofiles...")
    subprocess.run([sys.executable, "-m", "pip", "install", "aiofiles", "-q"])
    import aiofiles

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.progress import Progress
    RICH_AVAILABLE = True
    console = Console()
except ImportError:
    RICH_AVAILABLE = False
    console = None
    print("⚠️ Instalando rich para mejor visualización...")
    subprocess.run([sys.executable, "-m", "pip", "install", "rich", "-q"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    console = Console()
    RICH_AVAILABLE = True

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ================================================================================
# MÓDULO 1: SECURITY GUARD - Sistema de Seguridad
# ================================================================================

class ThreatLevel(Enum):
    """Niveles de amenaza para clasificación de comandos"""
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SecurityAction(Enum):
    """Acciones a tomar según el análisis de seguridad"""
    ALLOW = "allow"
    WARN = "warn"
    REQUIRE_CONFIRMATION = "require_confirmation"
    BLOCK = "block"
    LOG_AND_BLOCK = "log_and_block"


@dataclass
class SecurityAnalysis:
    """Resultado del análisis de seguridad"""
    command: str
    is_safe: bool
    threat_level: ThreatLevel
    action: SecurityAction
    matched_rules: List[str]
    warnings: List[str]
    sanitized_command: Optional[str] = None


@dataclass
class PathSecurityResult:
    """Resultado de validación de ruta"""
    path: str
    is_allowed: bool
    is_within_sandbox: bool
    resolved_path: Optional[str] = None
    reason: str = ""


class SecurityGuard:
    """
    Sistema de seguridad multicapa para el Sandbox.
    
    Detecta y bloquea comandos peligrosos, valida rutas de archivos,
    y proporciona sanitización de inputs.
    """
    
    # Comandos absolutamente prohibidos
    CRITICAL_BLOCKED_PATTERNS = [
        r"rm\s+(-[rfv]+\s+)*/?$",
        r"rm\s+(-[rfv]+\s+)*/\*",
        r"rm\s+(-[rfv]+\s+)*/home",
        r"rm\s+(-[rfv]+\s+)*/etc",
        r"rm\s+(-[rfv]+\s+)*/var",
        r"rm\s+(-[rfv]+\s+)*/usr",
        r":\(\)\s*\{\s*:\|:\s*&\s*\}\s*;",
        r"mkfs\.",
        r"dd\s+if=/dev/zero",
        r"dd\s+if=/dev/random\s+of=/dev/sd",
        r"wipefs",
        r"grub-install",
        r"update-grub",
        r"insmod",
        r"rmmod",
        r"modprobe\s+(-r\s+)?",
        r"chmod\s+(-R\s+)?777\s+/",
        r"chmod\s+(-R\s+)?000\s+/",
        r"chown\s+(-R\s+)?\w+:\w+\s+/",
        r"curl\s+.*\|\s*(bash|sh|python)",
        r"wget\s+.*\|\s*(bash|sh|python)",
        r"eval\s*\(",
        r"exec\s*\(",
        r"xmrig",
        r"minerd",
        r"stratum\+tcp://",
    ]
    
    # Comandos de riesgo medio
    MEDIUM_RISK_PATTERNS = [
        r"sudo\s+",
        r"su\s+-",
        r"passwd",
        r"useradd",
        r"userdel",
        r"shutdown",
        r"reboot",
        r"halt",
        r"poweroff",
        r"init\s+\d",
        r"systemctl\s+(stop|disable|mask)",
        r"kill\s+-9\s+-1",
        r"killall",
        r"pkill\s+-9",
    ]
    
    # Comandos seguros conocidos
    SAFE_COMMANDS = {
        'ls', 'pwd', 'cd', 'cat', 'head', 'tail', 'less', 'more',
        'echo', 'printf', 'date', 'cal', 'whoami', 'hostname',
        'uname', 'uptime', 'free', 'df', 'du', 'top', 'htop',
        'ps', 'pgrep', 'which', 'whereis', 'locate', 'find',
        'grep', 'egrep', 'fgrep', 'sed', 'awk', 'cut', 'sort',
        'uniq', 'wc', 'tr', 'tee', 'xargs',
        'mkdir', 'touch', 'cp', 'mv', 'file', 'stat',
        'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'bzip2',
        'python', 'python3', 'pip', 'pip3', 'node', 'npm', 'npx',
        'git', 'curl', 'wget', 'ssh', 'scp', 'rsync',
        'vim', 'nano', 'code', 'clear', 'history', 'alias',
        'export', 'env', 'printenv', 'source', 'man', 'help',
    }
    
    # Extensiones de archivo peligrosas
    DANGEROUS_EXTENSIONS = {
        '.exe', '.bat', '.cmd', '.com', '.msi',
        '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf',
        '.scr', '.pif', '.application', '.gadget',
        '.hta', '.cpl', '.msc', '.jar',
    }
    
    # Directorios protegidos
    PROTECTED_DIRECTORIES = {
        '/', '/bin', '/sbin', '/usr', '/lib', '/lib64',
        '/boot', '/etc', '/var', '/root', '/proc', '/sys',
        '/dev', '/run', '/snap', '/opt',
    }
    
    def __init__(self, sandbox_root: str = None):
        if sandbox_root is None:
            # Usar directorio actual o crear uno temporal
            sandbox_root = os.path.join(os.getcwd(), "sandbox_workspace")
        
        self.sandbox_root = Path(sandbox_root).resolve()
        self.sandbox_root.mkdir(parents=True, exist_ok=True)
        
        self._compile_patterns()
        self.blocked_history: List[Dict] = []
        self.stats = {'total_checks': 0, 'blocked': 0, 'warned': 0, 'allowed': 0}
    
    def _compile_patterns(self):
        """Compila los patrones regex"""
        self._critical_patterns = [re.compile(p, re.IGNORECASE) for p in self.CRITICAL_BLOCKED_PATTERNS]
        self._medium_patterns = [re.compile(p, re.IGNORECASE) for p in self.MEDIUM_RISK_PATTERNS]
    
    def analyze_command(self, command: str) -> SecurityAnalysis:
        """Analiza un comando y determina si es seguro ejecutarlo."""
        self.stats['total_checks'] += 1
        command = command.strip()
        
        if not command:
            return SecurityAnalysis(
                command=command, is_safe=True, threat_level=ThreatLevel.SAFE,
                action=SecurityAction.ALLOW, matched_rules=[], warnings=[]
            )
        
        matched_rules = []
        warnings = []
        
        # Verificar patrones críticos
        for i, pattern in enumerate(self._critical_patterns):
            if pattern.search(command):
                matched_rules.append(f"CRITICAL_{i}")
                self.stats['blocked'] += 1
                self._log_blocked(command, f"Matched critical pattern: {self.CRITICAL_BLOCKED_PATTERNS[i]}")
                return SecurityAnalysis(
                    command=command, is_safe=False, threat_level=ThreatLevel.CRITICAL,
                    action=SecurityAction.LOG_AND_BLOCK, matched_rules=matched_rules,
                    warnings=["⚠️ Comando bloqueado: potencialmente destructivo"]
                )
        
        # Verificar patrones de riesgo medio
        for i, pattern in enumerate(self._medium_patterns):
            if pattern.search(command):
                matched_rules.append(f"MEDIUM_{i}")
                warnings.append(f"⚠️ Precaución: {self.MEDIUM_RISK_PATTERNS[i]}")
        
        # Verificar si el comando base es seguro
        base_command = command.split()[0] if command.split() else ""
        if base_command in self.SAFE_COMMANDS and not matched_rules:
            self.stats['allowed'] += 1
            return SecurityAnalysis(
                command=command, is_safe=True, threat_level=ThreatLevel.SAFE,
                action=SecurityAction.ALLOW, matched_rules=[], warnings=[]
            )
        
        if matched_rules:
            self.stats['warned'] += 1
            return SecurityAnalysis(
                command=command, is_safe=False, threat_level=ThreatLevel.MEDIUM,
                action=SecurityAction.REQUIRE_CONFIRMATION, matched_rules=matched_rules,
                warnings=warnings
            )
        
        self.stats['allowed'] += 1
        return SecurityAnalysis(
            command=command, is_safe=True, threat_level=ThreatLevel.LOW,
            action=SecurityAction.ALLOW, matched_rules=[],
            warnings=["ℹ️ Comando no reconocido, ejecutando con precaución"]
        )
    
    def validate_path(self, path: str) -> PathSecurityResult:
        """Valida si una ruta de archivo es segura."""
        try:
            if not os.path.isabs(path):
                path = os.path.join(str(self.sandbox_root), path)
            
            resolved = Path(path).resolve()
            resolved_str = str(resolved)
            
            for protected in self.PROTECTED_DIRECTORIES:
                if resolved_str == protected or (
                    resolved_str.startswith(protected + '/') and 
                    not resolved_str.startswith(str(self.sandbox_root))
                ):
                    return PathSecurityResult(
                        path=path, is_allowed=False, is_within_sandbox=False,
                        resolved_path=resolved_str,
                        reason=f"Directorio protegido del sistema: {protected}"
                    )
            
            try:
                resolved.relative_to(self.sandbox_root)
                is_within = True
            except ValueError:
                is_within = False
            
            return PathSecurityResult(
                path=path, is_allowed=is_within, is_within_sandbox=is_within,
                resolved_path=resolved_str,
                reason="" if is_within else "Ruta fuera del sandbox permitido"
            )
        except Exception as e:
            return PathSecurityResult(
                path=path, is_allowed=False, is_within_sandbox=False,
                reason=f"Error al validar ruta: {str(e)}"
            )
    
    def sanitize_input(self, user_input: str) -> str:
        """Sanitiza input del usuario."""
        dangerous_chars = [';', '|', '&', '`', '$', '(', ')', '{', '}', '<', '>', '\\', '\n', '\r']
        sanitized = user_input
        for char in dangerous_chars:
            sanitized = sanitized.replace(char, f'\\{char}')
        return sanitized
    
    def check_file_extension(self, filename: str) -> Tuple[bool, str]:
        """Verifica si la extensión de archivo es segura."""
        ext = Path(filename).suffix.lower()
        if ext in self.DANGEROUS_EXTENSIONS:
            return False, f"Extensión de archivo peligrosa: {ext}"
        return True, ""
    
    def _log_blocked(self, command: str, reason: str):
        """Registra un comando bloqueado"""
        entry = {
            'command': command,
            'reason': reason,
            'timestamp': datetime.now().isoformat(),
            'command_hash': hashlib.sha256(command.encode()).hexdigest()[:16]
        }
        self.blocked_history.append(entry)
        logger.warning(f"Comando bloqueado: {entry}")
    
    def get_stats(self) -> Dict:
        """Retorna estadísticas de seguridad"""
        return {**self.stats, 'blocked_history_count': len(self.blocked_history), 'sandbox_root': str(self.sandbox_root)}


# ================================================================================
# MÓDULO 2: COMMAND EXECUTOR - Ejecutor de Comandos
# ================================================================================

class ExecutionStatus(Enum):
    """Estados de ejecución de comandos"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


@dataclass
class ExecutionResult:
    """Resultado de la ejecución de un comando"""
    command: str
    status: ExecutionStatus
    return_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    execution_time: float = 0.0
    error_message: str = ""
    security_analysis: Optional[SecurityAnalysis] = None
    
    @property
    def success(self) -> bool:
        return self.status == ExecutionStatus.COMPLETED and self.return_code == 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'command': self.command, 'status': self.status.value,
            'return_code': self.return_code, 'stdout': self.stdout,
            'stderr': self.stderr, 'execution_time': self.execution_time,
            'success': self.success, 'error_message': self.error_message
        }


@dataclass
class ExecutorConfig:
    """Configuración del ejecutor de comandos"""
    default_timeout: int = 30
    max_timeout: int = 300
    max_output_size: int = 10 * 1024 * 1024
    shell: str = "/bin/bash"
    working_directory: Optional[str] = None
    environment: Dict[str, str] = field(default_factory=dict)
    capture_output: bool = True
    enable_security: bool = True


class CommandExecutor:
    """Ejecutor de comandos shell con seguridad integrada."""
    
    def __init__(self, config: Optional[ExecutorConfig] = None, security_guard: Optional[SecurityGuard] = None):
        self.config = config or ExecutorConfig()
        self.security = security_guard or SecurityGuard()
        self.history: List[ExecutionResult] = []
        self.max_history = 1000
        self._active_processes: Dict[str, asyncio.subprocess.Process] = {}
        
        if self.config.working_directory:
            self.working_dir = Path(self.config.working_directory)
        else:
            self.working_dir = self.security.sandbox_root
        
        self.working_dir.mkdir(parents=True, exist_ok=True)
    
    async def execute(
        self, command: str, timeout: Optional[int] = None,
        working_dir: Optional[str] = None, env: Optional[Dict[str, str]] = None,
        stdin_input: Optional[str] = None
    ) -> ExecutionResult:
        """Ejecuta un comando de forma segura."""
        start_time = time.time()
        timeout = timeout or self.config.default_timeout
        timeout = min(timeout, self.config.max_timeout)
        
        # Análisis de seguridad
        if self.config.enable_security:
            security_result = self.security.analyze_command(command)
            if security_result.action == SecurityAction.LOG_AND_BLOCK:
                return self._create_blocked_result(command, security_result, start_time)
        else:
            security_result = None
        
        # Preparar entorno
        exec_env = os.environ.copy()
        exec_env.update(self.config.environment)
        if env:
            exec_env.update(env)
        
        work_path = Path(working_dir) if working_dir else self.working_dir
        
        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE if self.config.capture_output else None,
                stderr=asyncio.subprocess.PIPE if self.config.capture_output else None,
                stdin=asyncio.subprocess.PIPE if stdin_input else None,
                cwd=str(work_path),
                env=exec_env
            )
            
            process_id = f"{id(process)}_{time.time()}"
            self._active_processes[process_id] = process
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=stdin_input.encode() if stdin_input else None),
                    timeout=timeout
                )
                
                result = ExecutionResult(
                    command=command, status=ExecutionStatus.COMPLETED,
                    return_code=process.returncode,
                    stdout=stdout.decode('utf-8', errors='replace') if stdout else "",
                    stderr=stderr.decode('utf-8', errors='replace') if stderr else "",
                    execution_time=time.time() - start_time,
                    security_analysis=security_result
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                result = ExecutionResult(
                    command=command, status=ExecutionStatus.TIMEOUT,
                    error_message=f"Comando excedió el timeout de {timeout} segundos",
                    execution_time=time.time() - start_time,
                    security_analysis=security_result
                )
            finally:
                self._active_processes.pop(process_id, None)
        
        except Exception as e:
            result = ExecutionResult(
                command=command, status=ExecutionStatus.FAILED,
                error_message=str(e), execution_time=time.time() - start_time,
                security_analysis=security_result
            )
        
        self._add_to_history(result)
        return result
    
    async def execute_script(self, script_content: str, interpreter: str = "bash", timeout: Optional[int] = None) -> ExecutionResult:
        """Ejecuta un script completo."""
        ext_map = {'bash': '.sh', 'sh': '.sh', 'python': '.py', 'python3': '.py', 'node': '.js'}
        ext = ext_map.get(interpreter, '.txt')
        
        with tempfile.NamedTemporaryFile(mode='w', suffix=ext, dir=str(self.working_dir), delete=False) as f:
            f.write(script_content)
            script_path = f.name
        
        try:
            os.chmod(script_path, 0o755)
            command = f"{interpreter} {script_path}"
            result = await self.execute(command, timeout=timeout)
            return result
        finally:
            try:
                os.unlink(script_path)
            except:
                pass
    
    async def execute_multiple(self, commands: List[str], stop_on_error: bool = True) -> List[ExecutionResult]:
        """Ejecuta múltiples comandos secuencialmente."""
        results = []
        for cmd in commands:
            result = await self.execute(cmd)
            results.append(result)
            if stop_on_error and not result.success:
                break
        return results
    
    async def cancel_all(self):
        """Cancela todos los procesos activos"""
        for process_id, process in list(self._active_processes.items()):
            try:
                process.kill()
                await process.wait()
            except:
                pass
            self._active_processes.pop(process_id, None)
    
    def _create_blocked_result(self, command: str, security_result: SecurityAnalysis, start_time: float) -> ExecutionResult:
        return ExecutionResult(
            command=command, status=ExecutionStatus.BLOCKED,
            error_message=f"Comando bloqueado por seguridad: {security_result.warnings}",
            execution_time=time.time() - start_time,
            security_analysis=security_result
        )
    
    def _add_to_history(self, result: ExecutionResult):
        self.history.append(result)
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def get_history(self, limit: int = 50) -> List[ExecutionResult]:
        return self.history[-limit:]
    
    def get_stats(self) -> Dict[str, Any]:
        total = len(self.history)
        if total == 0:
            return {'total_executions': 0, 'success_rate': 0, 'avg_execution_time': 0}
        
        successful = sum(1 for r in self.history if r.success)
        total_time = sum(r.execution_time for r in self.history)
        
        return {
            'total_executions': total,
            'successful': successful,
            'success_rate': (successful / total) * 100,
            'avg_execution_time': total_time / total,
            'active_processes': len(self._active_processes)
        }


# ================================================================================
# MÓDULO 3: FILE MANAGER - Gestor de Archivos
# ================================================================================

@dataclass
class FileInfo:
    """Información de un archivo"""
    path: str
    name: str
    extension: str
    size: int
    is_file: bool
    is_dir: bool
    created: Optional[datetime]
    modified: Optional[datetime]
    permissions: str
    mime_type: Optional[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'path': self.path, 'name': self.name, 'extension': self.extension,
            'size': self.size, 'size_human': self._human_size(self.size),
            'is_file': self.is_file, 'is_dir': self.is_dir,
            'created': self.created.isoformat() if self.created else None,
            'modified': self.modified.isoformat() if self.modified else None,
            'permissions': self.permissions, 'mime_type': self.mime_type
        }
    
    @staticmethod
    def _human_size(size: int) -> str:
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} PB"


@dataclass
class FileOperationResult:
    """Resultado de una operación de archivo"""
    success: bool
    operation: str
    path: str
    message: str = ""
    data: Optional[Any] = None
    error: Optional[str] = None


class FileManager:
    """Gestor de archivos seguro para el sandbox."""
    
    def __init__(self, sandbox_root: str = None, security_guard: Optional[SecurityGuard] = None, max_file_size: int = 100 * 1024 * 1024):
        if sandbox_root is None:
            sandbox_root = os.path.join(os.getcwd(), "sandbox_workspace")
        
        self.sandbox_root = Path(sandbox_root).resolve()
        self.security = security_guard or SecurityGuard(sandbox_root=sandbox_root)
        self.max_file_size = max_file_size
        self.sandbox_root.mkdir(parents=True, exist_ok=True)
        self.stats = {'files_read': 0, 'files_written': 0, 'files_deleted': 0, 'bytes_read': 0, 'bytes_written': 0}
    
    def _resolve_path(self, path: str) -> Path:
        if os.path.isabs(path):
            return Path(path).resolve()
        return (self.sandbox_root / path).resolve()
    
    def _validate_path(self, path: str) -> PathSecurityResult:
        return self.security.validate_path(str(self._resolve_path(path)))
    
    async def read(self, path: str, encoding: str = 'utf-8') -> FileOperationResult:
        """Lee el contenido de un archivo."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='read', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        try:
            async with aiofiles.open(resolved, 'r', encoding=encoding) as f:
                content = await f.read()
            self.stats['files_read'] += 1
            self.stats['bytes_read'] += len(content)
            return FileOperationResult(success=True, operation='read', path=str(resolved), data=content, message=f"Archivo leído: {len(content)} bytes")
        except FileNotFoundError:
            return FileOperationResult(success=False, operation='read', path=path, error="Archivo no encontrado")
        except Exception as e:
            return FileOperationResult(success=False, operation='read', path=path, error=str(e))
    
    async def write(self, path: str, content: str, encoding: str = 'utf-8', create_dirs: bool = True) -> FileOperationResult:
        """Escribe contenido en un archivo."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='write', path=path, error=validation.reason)
        
        if len(content.encode(encoding)) > self.max_file_size:
            return FileOperationResult(success=False, operation='write', path=path, error=f"Archivo excede el tamaño máximo")
        
        resolved = self._resolve_path(path)
        try:
            if create_dirs:
                resolved.parent.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(resolved, 'w', encoding=encoding) as f:
                await f.write(content)
            self.stats['files_written'] += 1
            self.stats['bytes_written'] += len(content)
            return FileOperationResult(success=True, operation='write', path=str(resolved), message=f"Archivo escrito: {len(content)} bytes")
        except Exception as e:
            return FileOperationResult(success=False, operation='write', path=path, error=str(e))
    
    async def append(self, path: str, content: str, encoding: str = 'utf-8') -> FileOperationResult:
        """Añade contenido al final de un archivo."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='append', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        try:
            async with aiofiles.open(resolved, 'a', encoding=encoding) as f:
                await f.write(content)
            return FileOperationResult(success=True, operation='append', path=str(resolved), message=f"Contenido añadido: {len(content)} bytes")
        except Exception as e:
            return FileOperationResult(success=False, operation='append', path=path, error=str(e))
    
    async def delete(self, path: str, recursive: bool = False) -> FileOperationResult:
        """Elimina un archivo o directorio."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='delete', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        if not resolved.exists():
            return FileOperationResult(success=False, operation='delete', path=path, error="Archivo o directorio no existe")
        
        try:
            if resolved.is_file():
                resolved.unlink()
            elif resolved.is_dir():
                if recursive:
                    shutil.rmtree(resolved)
                else:
                    resolved.rmdir()
            self.stats['files_deleted'] += 1
            return FileOperationResult(success=True, operation='delete', path=str(resolved), message="Eliminado correctamente")
        except Exception as e:
            return FileOperationResult(success=False, operation='delete', path=path, error=str(e))
    
    async def mkdir(self, path: str, parents: bool = True) -> FileOperationResult:
        """Crea un directorio."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='mkdir', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        try:
            resolved.mkdir(parents=parents, exist_ok=True)
            return FileOperationResult(success=True, operation='mkdir', path=str(resolved), message="Directorio creado")
        except Exception as e:
            return FileOperationResult(success=False, operation='mkdir', path=path, error=str(e))
    
    async def list_dir(self, path: str = ".", pattern: Optional[str] = None, recursive: bool = False) -> FileOperationResult:
        """Lista el contenido de un directorio."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='list_dir', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        if not resolved.exists():
            return FileOperationResult(success=False, operation='list_dir', path=path, error="Directorio no existe")
        
        try:
            items = []
            iterator = resolved.rglob(pattern or '*') if recursive else resolved.glob(pattern or '*')
            
            for item in iterator:
                if item.name.startswith('.'):
                    continue
                info = await self.get_info(str(item))
                if info.success:
                    items.append(info.data)
            
            return FileOperationResult(success=True, operation='list_dir', path=str(resolved), data={'items': items, 'count': len(items), 'pattern': pattern})
        except Exception as e:
            return FileOperationResult(success=False, operation='list_dir', path=path, error=str(e))
    
    async def exists(self, path: str) -> FileOperationResult:
        """Verifica si un archivo o directorio existe."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=True, operation='exists', path=path, data={'exists': False}, message="Ruta fuera del sandbox")
        
        resolved = self._resolve_path(path)
        exists = resolved.exists()
        return FileOperationResult(
            success=True, operation='exists', path=str(resolved),
            data={'exists': exists, 'is_file': resolved.is_file() if exists else False, 'is_dir': resolved.is_dir() if exists else False}
        )
    
    async def get_info(self, path: str) -> FileOperationResult:
        """Obtiene información detallada de un archivo."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='get_info', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        if not resolved.exists():
            return FileOperationResult(success=False, operation='get_info', path=path, error="Archivo no existe")
        
        try:
            stat = resolved.stat()
            info = FileInfo(
                path=str(resolved), name=resolved.name, extension=resolved.suffix,
                size=stat.st_size, is_file=resolved.is_file(), is_dir=resolved.is_dir(),
                created=datetime.fromtimestamp(stat.st_ctime),
                modified=datetime.fromtimestamp(stat.st_mtime),
                permissions=oct(stat.st_mode)[-3:],
                mime_type=mimetypes.guess_type(str(resolved))[0]
            )
            return FileOperationResult(success=True, operation='get_info', path=str(resolved), data=info.to_dict())
        except Exception as e:
            return FileOperationResult(success=False, operation='get_info', path=path, error=str(e))
    
    async def copy(self, src: str, dst: str) -> FileOperationResult:
        """Copia un archivo o directorio."""
        src_validation = self._validate_path(src)
        dst_validation = self._validate_path(dst)
        
        if not src_validation.is_allowed or not dst_validation.is_allowed:
            return FileOperationResult(success=False, operation='copy', path=src, error="Ruta origen o destino no permitida")
        
        src_resolved = self._resolve_path(src)
        dst_resolved = self._resolve_path(dst)
        
        try:
            if src_resolved.is_file():
                dst_resolved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_resolved, dst_resolved)
            else:
                shutil.copytree(src_resolved, dst_resolved)
            return FileOperationResult(success=True, operation='copy', path=str(dst_resolved), message=f"Copiado de {src} a {dst}")
        except Exception as e:
            return FileOperationResult(success=False, operation='copy', path=src, error=str(e))
    
    async def move(self, src: str, dst: str) -> FileOperationResult:
        """Mueve un archivo o directorio."""
        src_validation = self._validate_path(src)
        dst_validation = self._validate_path(dst)
        
        if not src_validation.is_allowed or not dst_validation.is_allowed:
            return FileOperationResult(success=False, operation='move', path=src, error="Ruta origen o destino no permitida")
        
        src_resolved = self._resolve_path(src)
        dst_resolved = self._resolve_path(dst)
        
        try:
            dst_resolved.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(src_resolved, dst_resolved)
            return FileOperationResult(success=True, operation='move', path=str(dst_resolved), message=f"Movido de {src} a {dst}")
        except Exception as e:
            return FileOperationResult(success=False, operation='move', path=src, error=str(e))
    
    async def read_json(self, path: str) -> FileOperationResult:
        """Lee y parsea un archivo JSON."""
        result = await self.read(path)
        if not result.success:
            return result
        try:
            data = json.loads(result.data)
            return FileOperationResult(success=True, operation='read_json', path=path, data=data)
        except json.JSONDecodeError as e:
            return FileOperationResult(success=False, operation='read_json', path=path, error=f"Error parsing JSON: {e}")
    
    async def write_json(self, path: str, data: Any, indent: int = 2) -> FileOperationResult:
        """Escribe datos como JSON."""
        try:
            content = json.dumps(data, indent=indent, ensure_ascii=False, default=str)
            return await self.write(path, content)
        except Exception as e:
            return FileOperationResult(success=False, operation='write_json', path=path, error=f"Error serializando JSON: {e}")
    
    async def search(self, pattern: str, path: str = ".", content_search: Optional[str] = None, max_results: int = 100) -> FileOperationResult:
        """Busca archivos por nombre y/o contenido."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='search', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        results = []
        
        try:
            for item in resolved.rglob(pattern):
                if len(results) >= max_results:
                    break
                if item.is_file():
                    match = True
                    if content_search:
                        try:
                            async with aiofiles.open(item, 'r', errors='ignore') as f:
                                content = await f.read()
                            match = content_search.lower() in content.lower()
                        except:
                            match = False
                    if match:
                        info = await self.get_info(str(item))
                        if info.success:
                            results.append(info.data)
            
            return FileOperationResult(success=True, operation='search', path=str(resolved), data={'results': results, 'count': len(results), 'pattern': pattern})
        except Exception as e:
            return FileOperationResult(success=False, operation='search', path=path, error=str(e))
    
    async def get_disk_usage(self, path: str = ".") -> FileOperationResult:
        """Obtiene uso de disco de un directorio."""
        validation = self._validate_path(path)
        if not validation.is_allowed:
            return FileOperationResult(success=False, operation='get_disk_usage', path=path, error=validation.reason)
        
        resolved = self._resolve_path(path)
        try:
            total_size = 0
            file_count = 0
            dir_count = 0
            
            for item in resolved.rglob('*'):
                if item.is_file():
                    total_size += item.stat().st_size
                    file_count += 1
                elif item.is_dir():
                    dir_count += 1
            
            return FileOperationResult(
                success=True, operation='get_disk_usage', path=str(resolved),
                data={'total_size': total_size, 'total_size_human': FileInfo._human_size(total_size), 'file_count': file_count, 'dir_count': dir_count}
            )
        except Exception as e:
            return FileOperationResult(success=False, operation='get_disk_usage', path=path, error=str(e))
    
    def get_stats(self) -> Dict[str, Any]:
        return {**self.stats, 'sandbox_root': str(self.sandbox_root), 'max_file_size': self.max_file_size}


# ================================================================================
# MÓDULO 4: STATE MANAGER - Gestor de Estado
# ================================================================================

@dataclass
class SessionState:
    """Estado de una sesión individual"""
    session_id: str
    created_at: datetime
    last_active: datetime
    working_directory: str
    environment_vars: Dict[str, str]
    installed_packages: List[str]
    custom_data: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'session_id': self.session_id,
            'created_at': self.created_at.isoformat(),
            'last_active': self.last_active.isoformat(),
            'working_directory': self.working_directory,
            'environment_vars': self.environment_vars,
            'installed_packages': self.installed_packages,
            'custom_data': self.custom_data
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SessionState':
        return cls(
            session_id=data['session_id'],
            created_at=datetime.fromisoformat(data['created_at']),
            last_active=datetime.fromisoformat(data['last_active']),
            working_directory=data['working_directory'],
            environment_vars=data.get('environment_vars', {}),
            installed_packages=data.get('installed_packages', []),
            custom_data=data.get('custom_data', {})
        )


@dataclass
class OperationLog:
    """Registro de una operación"""
    timestamp: datetime
    operation_type: str
    operation_name: str
    parameters: Dict[str, Any]
    result: str
    duration_ms: float
    success: bool
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'timestamp': self.timestamp.isoformat(),
            'operation_type': self.operation_type,
            'operation_name': self.operation_name,
            'parameters': self.parameters,
            'result': self.result,
            'duration_ms': self.duration_ms,
            'success': self.success
        }


class StateManager:
    """Gestor de estado persistente para el sandbox."""
    
    STATE_FILE = "sandbox_state.json"
    HISTORY_FILE = "operation_history.json"
    CONFIG_FILE = "sandbox_config.json"
    PACKAGES_FILE = "installed_packages.json"
    
    def __init__(self, state_directory: str = None, auto_save: bool = True, save_interval: int = 60, max_history_entries: int = 10000):
        if state_directory is None:
            state_directory = os.path.join(os.getcwd(), "sandbox_workspace", ".state")
        
        self.state_dir = Path(state_directory)
        self.auto_save = auto_save
        self.save_interval = save_interval
        self.max_history_entries = max_history_entries
        
        self.state_dir.mkdir(parents=True, exist_ok=True)
        
        self.current_session: Optional[SessionState] = None
        self.operation_history: List[OperationLog] = []
        self.config: Dict[str, Any] = {}
        self.installed_packages: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()
        self._auto_save_task: Optional[asyncio.Task] = None
    
    async def initialize(self) -> bool:
        """Inicializa el StateManager."""
        try:
            await self._load_config()
            await self._load_history()
            await self._load_packages()
            self.current_session = await self._create_session()
            
            if self.auto_save:
                self._start_auto_save()
            
            return True
        except Exception as e:
            logger.error(f"Error inicializando StateManager: {e}")
            return False
    
    async def shutdown(self):
        """Guarda el estado y cierra el StateManager."""
        if self._auto_save_task:
            self._auto_save_task.cancel()
            try:
                await self._auto_save_task
            except asyncio.CancelledError:
                pass
        await self.save_all()
    
    async def _create_session(self) -> SessionState:
        session_id = hashlib.sha256(f"{datetime.now().isoformat()}_{os.getpid()}".encode()).hexdigest()[:16]
        return SessionState(
            session_id=session_id,
            created_at=datetime.now(),
            last_active=datetime.now(),
            working_directory=str(self.state_dir.parent),
            environment_vars=dict(os.environ),
            installed_packages=list(self.installed_packages.keys())
        )
    
    async def get_session_info(self) -> Optional[Dict[str, Any]]:
        if self.current_session:
            return self.current_session.to_dict()
        return None
    
    async def get_config(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)
    
    async def set_config(self, key: str, value: Any):
        async with self._lock:
            self.config[key] = value
            await self._save_config()
    
    async def get_all_config(self) -> Dict[str, Any]:
        return dict(self.config)
    
    async def _load_config(self):
        config_file = self.state_dir / self.CONFIG_FILE
        if config_file.exists():
            try:
                async with aiofiles.open(config_file, 'r') as f:
                    self.config = json.loads(await f.read())
            except:
                self.config = {}
        else:
            self.config = {
                'default_shell': '/bin/bash',
                'default_timeout': 30,
                'max_file_size': 100 * 1024 * 1024,
                'enable_history': True,
                'enable_security': True
            }
            await self._save_config()
    
    async def _save_config(self):
        config_file = self.state_dir / self.CONFIG_FILE
        try:
            async with aiofiles.open(config_file, 'w') as f:
                await f.write(json.dumps(self.config, indent=2))
        except Exception as e:
            logger.error(f"Error guardando configuración: {e}")
    
    async def log_operation(self, operation_type: str, operation_name: str, parameters: Dict[str, Any], result: str, duration_ms: float, success: bool):
        if not self.config.get('enable_history', True):
            return
        
        log = OperationLog(
            timestamp=datetime.now(),
            operation_type=operation_type,
            operation_name=operation_name,
            parameters=parameters,
            result=result[:500],
            duration_ms=duration_ms,
            success=success
        )
        
        async with self._lock:
            self.operation_history.append(log)
            if len(self.operation_history) > self.max_history_entries:
                self.operation_history = self.operation_history[-self.max_history_entries:]
    
    async def get_history(self, limit: int = 100, operation_type: Optional[str] = None, success_only: bool = False) -> List[Dict[str, Any]]:
        history = self.operation_history
        if operation_type:
            history = [h for h in history if h.operation_type == operation_type]
        if success_only:
            history = [h for h in history if h.success]
        return [h.to_dict() for h in history[-limit:]]
    
    async def clear_history(self):
        async with self._lock:
            self.operation_history = []
            await self._save_history()
    
    async def _load_history(self):
        history_file = self.state_dir / self.HISTORY_FILE
        if history_file.exists():
            try:
                async with aiofiles.open(history_file, 'r') as f:
                    data = json.loads(await f.read())
                self.operation_history = [
                    OperationLog(
                        timestamp=datetime.fromisoformat(h['timestamp']),
                        operation_type=h['operation_type'],
                        operation_name=h['operation_name'],
                        parameters=h['parameters'],
                        result=h['result'],
                        duration_ms=h['duration_ms'],
                        success=h['success']
                    )
                    for h in data
                ]
            except:
                self.operation_history = []
    
    async def _save_history(self):
        history_file = self.state_dir / self.HISTORY_FILE
        try:
            data = [h.to_dict() for h in self.operation_history[-self.max_history_entries:]]
            async with aiofiles.open(history_file, 'w') as f:
                await f.write(json.dumps(data, indent=2))
        except Exception as e:
            logger.error(f"Error guardando historial: {e}")
    
    async def register_package(self, name: str, version: str, package_manager: str, installed_at: Optional[datetime] = None):
        async with self._lock:
            self.installed_packages[name] = {
                'version': version,
                'package_manager': package_manager,
                'installed_at': (installed_at or datetime.now()).isoformat()
            }
            await self._save_packages()
    
    async def unregister_package(self, name: str):
        async with self._lock:
            self.installed_packages.pop(name, None)
            await self._save_packages()
    
    async def get_installed_packages(self, package_manager: Optional[str] = None) -> Dict[str, Dict]:
        packages = self.installed_packages
        if package_manager:
            packages = {k: v for k, v in packages.items() if v.get('package_manager') == package_manager}
        return packages
    
    async def is_package_installed(self, name: str) -> bool:
        return name in self.installed_packages
    
    async def _load_packages(self):
        packages_file = self.state_dir / self.PACKAGES_FILE
        if packages_file.exists():
            try:
                async with aiofiles.open(packages_file, 'r') as f:
                    self.installed_packages = json.loads(await f.read())
            except:
                self.installed_packages = {}
    
    async def _save_packages(self):
        packages_file = self.state_dir / self.PACKAGES_FILE
        try:
            async with aiofiles.open(packages_file, 'w') as f:
                await f.write(json.dumps(self.installed_packages, indent=2))
        except Exception as e:
            logger.error(f"Error guardando paquetes: {e}")
    
    async def set_data(self, key: str, value: Any):
        if self.current_session:
            self.current_session.custom_data[key] = value
    
    async def get_data(self, key: str, default: Any = None) -> Any:
        if self.current_session:
            return self.current_session.custom_data.get(key, default)
        return default
    
    async def delete_data(self, key: str):
        if self.current_session and key in self.current_session.custom_data:
            del self.current_session.custom_data[key]
    
    def _start_auto_save(self):
        async def auto_save_loop():
            while True:
                await asyncio.sleep(self.save_interval)
                await self.save_all()
        self._auto_save_task = asyncio.create_task(auto_save_loop())
    
    async def save_all(self):
        async with self._lock:
            await self._save_config()
            await self._save_history()
            await self._save_packages()
            await self._save_session()
    
    async def _save_session(self):
        if not self.current_session:
            return
        session_file = self.state_dir / f"session_{self.current_session.session_id}.json"
        try:
            async with aiofiles.open(session_file, 'w') as f:
                await f.write(json.dumps(self.current_session.to_dict(), indent=2))
        except Exception as e:
            logger.error(f"Error guardando sesión: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        return {
            'state_directory': str(self.state_dir),
            'current_session': self.current_session.session_id if self.current_session else None,
            'history_entries': len(self.operation_history),
            'installed_packages': len(self.installed_packages),
            'config_keys': len(self.config),
            'auto_save_enabled': self.auto_save
        }


# ================================================================================
# MÓDULO 5: SANDBOX ENVIRONMENT - Entorno Principal
# ================================================================================

@dataclass
class EnvironmentConfig:
    """Configuración del entorno sandbox"""
    workspace_root: str = None
    state_directory: str = ".state"
    temp_directory: str = ".tmp"
    enable_security: bool = True
    default_timeout: int = 30
    max_timeout: int = 300
    max_file_size: int = 100 * 1024 * 1024
    auto_save: bool = True
    save_interval: int = 60
    max_history: int = 10000
    required_tools: List[str] = field(default_factory=lambda: ['python3', 'pip3', 'node', 'npm', 'git', 'curl', 'wget'])
    
    def __post_init__(self):
        if self.workspace_root is None:
            self.workspace_root = os.path.join(os.getcwd(), "sandbox_workspace")


@dataclass
class ToolInfo:
    """Información de una herramienta instalada"""
    name: str
    version: str
    path: str
    available: bool
    
    def to_dict(self) -> Dict[str, Any]:
        return {'name': self.name, 'version': self.version, 'path': self.path, 'available': self.available}


@dataclass 
class EnvironmentStatus:
    """Estado actual del entorno"""
    is_initialized: bool
    is_healthy: bool
    workspace_path: str
    session_id: Optional[str]
    uptime_seconds: float
    tools_available: Dict[str, ToolInfo]
    disk_usage: Dict[str, Any]
    active_processes: int
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'is_initialized': self.is_initialized,
            'is_healthy': self.is_healthy,
            'workspace_path': self.workspace_path,
            'session_id': self.session_id,
            'uptime_seconds': self.uptime_seconds,
            'tools_available': {k: v.to_dict() for k, v in self.tools_available.items()},
            'disk_usage': self.disk_usage,
            'active_processes': self.active_processes
        }


class SandboxEnvironment:
    """
    Entorno Sandbox completo para ejecución segura.
    
    Ejemplo de uso:
        async with SandboxEnvironment() as sandbox:
            result = await sandbox.execute("ls -la")
            print(result.stdout)
    """
    
    def __init__(self, config: Optional[EnvironmentConfig] = None):
        self.config = config or EnvironmentConfig()
        self.workspace = Path(self.config.workspace_root).resolve()
        self.state_dir = self.workspace / self.config.state_directory
        self.temp_dir = self.workspace / self.config.temp_directory
        
        self.security: Optional[SecurityGuard] = None
        self.executor: Optional[CommandExecutor] = None
        self.files: Optional[FileManager] = None
        self.state: Optional[StateManager] = None
        
        self._initialized = False
        self._start_time: Optional[datetime] = None
        self._tools_cache: Dict[str, ToolInfo] = {}
    
    async def __aenter__(self) -> 'SandboxEnvironment':
        await self.initialize()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.shutdown()
    
    async def initialize(self) -> bool:
        """Inicializa el entorno sandbox completo."""
        if self._initialized:
            return True
        
        try:
            self._start_time = datetime.now()
            await self._create_directory_structure()
            
            self.security = SecurityGuard(sandbox_root=str(self.workspace))
            
            executor_config = ExecutorConfig(
                default_timeout=self.config.default_timeout,
                max_timeout=self.config.max_timeout,
                working_directory=str(self.workspace),
                enable_security=self.config.enable_security
            )
            self.executor = CommandExecutor(config=executor_config, security_guard=self.security)
            
            self.files = FileManager(
                sandbox_root=str(self.workspace),
                security_guard=self.security,
                max_file_size=self.config.max_file_size
            )
            
            self.state = StateManager(
                state_directory=str(self.state_dir),
                auto_save=self.config.auto_save,
                save_interval=self.config.save_interval,
                max_history_entries=self.config.max_history
            )
            await self.state.initialize()
            
            await self._check_tools()
            await self._setup_environment()
            
            self._initialized = True
            return True
        except Exception as e:
            logger.error(f"Error inicializando SandboxEnvironment: {e}")
            return False
    
    async def shutdown(self):
        """Cierra el entorno de forma ordenada."""
        if self.executor:
            await self.executor.cancel_all()
        if self.state:
            await self.state.shutdown()
        self._initialized = False
    
    async def _create_directory_structure(self):
        directories = [
            self.workspace, self.state_dir, self.temp_dir,
            self.workspace / "projects", self.workspace / "downloads",
            self.workspace / "scripts", self.workspace / "data"
        ]
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
    
    async def _check_tools(self):
        for tool in self.config.required_tools:
            info = await self._get_tool_info(tool)
            self._tools_cache[tool] = info
    
    async def _get_tool_info(self, tool: str) -> ToolInfo:
        path = shutil.which(tool)
        if not path:
            return ToolInfo(name=tool, version="N/A", path="", available=False)
        
        version = "unknown"
        version_commands = {
            'python3': ['python3', '--version'],
            'pip3': ['pip3', '--version'],
            'node': ['node', '--version'],
            'npm': ['npm', '--version'],
            'git': ['git', '--version'],
            'curl': ['curl', '--version'],
            'wget': ['wget', '--version'],
        }
        cmd = version_commands.get(tool, [tool, '--version'])
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                version = result.stdout.strip().split('\n')[0]
        except:
            pass
        
        return ToolInfo(name=tool, version=version, path=path, available=True)
    
    async def _setup_environment(self):
        env_vars = {
            'SANDBOX_ROOT': str(self.workspace),
            'SANDBOX_TEMP': str(self.temp_dir),
            'PYTHONPATH': str(self.workspace)
        }
        for key, value in env_vars.items():
            os.environ[key] = value
    
    async def execute(self, command: str, timeout: Optional[int] = None, working_dir: Optional[str] = None) -> ExecutionResult:
        """Ejecuta un comando en el sandbox."""
        self._ensure_initialized()
        start_time = datetime.now()
        result = await self.executor.execute(command=command, timeout=timeout, working_dir=working_dir)
        duration = (datetime.now() - start_time).total_seconds() * 1000
        await self.state.log_operation(
            operation_type='shell', operation_name='execute',
            parameters={'command': command},
            result=result.stdout[:200] if result.stdout else result.error_message,
            duration_ms=duration, success=result.success
        )
        return result
    
    async def execute_script(self, script_content: str, interpreter: str = "bash", timeout: Optional[int] = None) -> ExecutionResult:
        """Ejecuta un script completo."""
        self._ensure_initialized()
        return await self.executor.execute_script(script_content=script_content, interpreter=interpreter, timeout=timeout)
    
    async def execute_python(self, code: str, timeout: Optional[int] = None) -> ExecutionResult:
        """Ejecuta código Python."""
        return await self.execute_script(code, 'python3', timeout)
    
    async def execute_node(self, code: str, timeout: Optional[int] = None) -> ExecutionResult:
        """Ejecuta código Node.js."""
        return await self.execute_script(code, 'node', timeout)
    
    async def read_file(self, path: str) -> FileOperationResult:
        """Lee un archivo."""
        self._ensure_initialized()
        return await self.files.read(path)
    
    async def write_file(self, path: str, content: str, create_dirs: bool = True) -> FileOperationResult:
        """Escribe un archivo."""
        self._ensure_initialized()
        return await self.files.write(path, content, create_dirs=create_dirs)
    
    async def delete_file(self, path: str) -> FileOperationResult:
        """Elimina un archivo."""
        self._ensure_initialized()
        return await self.files.delete(path)
    
    async def list_files(self, path: str = ".", pattern: str = "*") -> FileOperationResult:
        """Lista archivos en un directorio."""
        self._ensure_initialized()
        return await self.files.list_dir(path, pattern)
    
    async def file_exists(self, path: str) -> bool:
        """Verifica si un archivo existe."""
        self._ensure_initialized()
        result = await self.files.exists(path)
        return result.data.get('exists', False) if result.success else False
    
    async def install_pip_package(self, package: str, version: Optional[str] = None) -> ExecutionResult:
        """Instala un paquete de pip."""
        self._ensure_initialized()
        pkg_spec = f"{package}=={version}" if version else package
        result = await self.execute(f"pip3 install {pkg_spec} --break-system-packages -q", timeout=120)
        if result.success:
            await self.state.register_package(name=package, version=version or "latest", package_manager="pip")
        return result
    
    async def install_npm_package(self, package: str, version: Optional[str] = None, global_install: bool = False) -> ExecutionResult:
        """Instala un paquete de npm."""
        self._ensure_initialized()
        pkg_spec = f"{package}@{version}" if version else package
        global_flag = "-g" if global_install else ""
        result = await self.execute(f"npm install {global_flag} {pkg_spec}", timeout=120)
        if result.success:
            await self.state.register_package(name=package, version=version or "latest", package_manager="npm")
        return result
    
    async def get_installed_packages(self) -> Dict[str, Dict]:
        """Obtiene los paquetes instalados."""
        self._ensure_initialized()
        return await self.state.get_installed_packages()
    
    async def get_status(self) -> EnvironmentStatus:
        """Obtiene el estado actual del entorno."""
        uptime = 0.0
        if self._start_time:
            uptime = (datetime.now() - self._start_time).total_seconds()
        
        disk_usage = {}
        try:
            du_result = await self.files.get_disk_usage(".")
            if du_result.success:
                disk_usage = du_result.data
        except:
            pass
        
        active_processes = len(self.executor._active_processes) if self.executor else 0
        
        return EnvironmentStatus(
            is_initialized=self._initialized,
            is_healthy=await self._check_health(),
            workspace_path=str(self.workspace),
            session_id=self.state.current_session.session_id if self.state and self.state.current_session else None,
            uptime_seconds=uptime,
            tools_available=self._tools_cache,
            disk_usage=disk_usage,
            active_processes=active_processes
        )
    
    async def _check_health(self) -> bool:
        checks = [
            self._initialized, self.workspace.exists(),
            self.security is not None, self.executor is not None,
            self.files is not None, self.state is not None
        ]
        return all(checks)
    
    async def get_history(self, limit: int = 50) -> List[Dict]:
        """Obtiene el historial de operaciones."""
        self._ensure_initialized()
        return await self.state.get_history(limit=limit)
    
    def _ensure_initialized(self):
        if not self._initialized:
            raise RuntimeError("SandboxEnvironment no está inicializado. Llama a initialize() primero.")
    
    async def clean_temp(self):
        """Limpia el directorio temporal."""
        self._ensure_initialized()
        for item in self.temp_dir.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
            except:
                pass
    
    def get_workspace_path(self, *parts: str) -> Path:
        """Obtiene una ruta dentro del workspace."""
        return self.workspace.joinpath(*parts)


# ================================================================================
# FUNCIONES DE UTILIDAD
# ================================================================================

async def create_sandbox(config: Optional[EnvironmentConfig] = None) -> SandboxEnvironment:
    """Crea e inicializa un nuevo sandbox."""
    env = SandboxEnvironment(config)
    await env.initialize()
    return env


async def quick_execute(command: str) -> ExecutionResult:
    """Ejecuta un comando rápido en un sandbox temporal."""
    async with SandboxEnvironment() as env:
        return await env.execute(command)


# ================================================================================
# INTERFAZ DE USUARIO
# ================================================================================

def print_header(title: str):
    if console:
        console.print(Panel.fit(f"[bold blue]{title}[/bold blue]", border_style="blue"))
    else:
        print(f"\n{'='*60}\n{title}\n{'='*60}")


def print_success(msg: str):
    if console:
        console.print(f"[green]✓[/green] {msg}")
    else:
        print(f"✓ {msg}")


def print_error(msg: str):
    if console:
        console.print(f"[red]✗[/red] {msg}")
    else:
        print(f"✗ {msg}")


def print_info(msg: str):
    if console:
        console.print(f"[cyan]ℹ[/cyan] {msg}")
    else:
        print(f"ℹ {msg}")


async def demo_full():
    """Demo completa del sandbox."""
    print_header("🏠 Demo del Sistema Sandbox Completo")
    
    async with SandboxEnvironment() as sandbox:
        # Estado
        status = await sandbox.get_status()
        print_success(f"Sandbox inicializado")
        print_info(f"Workspace: {status.workspace_path}")
        print_info(f"Session ID: {status.session_id}")
        
        # Herramientas
        if console:
            table = Table(title="🛠️ Herramientas Disponibles")
            table.add_column("Herramienta", style="cyan")
            table.add_column("Versión", style="green")
            table.add_column("Estado", style="yellow")
            
            for name, tool in status.tools_available.items():
                estado = "✓" if tool.available else "✗"
                version = tool.version[:35] if tool.version else "N/A"
                table.add_row(name, version, estado)
            console.print(table)
        else:
            print("\n🛠️ Herramientas:")
            for name, tool in status.tools_available.items():
                icon = "✓" if tool.available else "✗"
                print(f"  {icon} {name}: {tool.version}")
        
        # Ejecutar comandos
        print_info("\n💻 Ejecutando comandos:")
        
        result = await sandbox.execute("echo '¡Hola desde el sandbox!'")
        print_success(f"echo: {result.stdout.strip()}")
        
        result = await sandbox.execute("python3 --version")
        print_success(f"python: {result.stdout.strip()}")
        
        result = await sandbox.execute("pwd")
        print_success(f"pwd: {result.stdout.strip()}")
        
        # Test de seguridad
        print_info("\n🔒 Test de seguridad:")
        result = await sandbox.execute("rm -rf /")
        if result.status == ExecutionStatus.BLOCKED:
            print_success("Comando peligroso bloqueado correctamente")
        
        # Operaciones de archivos
        print_info("\n📁 Operaciones de archivos:")
        await sandbox.write_file("test.txt", "¡Hola desde el FileManager!")
        print_success("Archivo creado: test.txt")
        
        content = await sandbox.read_file("test.txt")
        if content.success:
            print_success(f"Contenido leído: {content.data}")
        
        files = await sandbox.list_files()
        if files.success:
            print_success(f"Archivos en workspace: {files.data['count']}")
        
        # Código Python
        print_info("\n🐍 Ejecutando código Python:")
        python_code = """
import sys
import platform
print(f"Python: {sys.version_info.major}.{sys.version_info.minor}")
print(f"Sistema: {platform.system()}")
print(f"Resultado: {sum(range(10))}")
"""
        result = await sandbox.execute_python(python_code)
        if result.success:
            for line in result.stdout.strip().split('\n'):
                print_success(line)
        
        # Estadísticas
        print_info("\n📈 Estadísticas:")
        stats = sandbox.executor.get_stats()
        print_info(f"Comandos ejecutados: {stats['total_executions']}")
        print_info(f"Tasa de éxito: {stats['success_rate']:.1f}%")


async def interactive_mode():
    """Modo interactivo del sandbox."""
    print_header("🎮 Modo Interactivo")
    
    async with SandboxEnvironment() as sandbox:
        print_info("Sandbox listo. Comandos especiales:")
        print("  'exit'    - Salir")
        print("  'status'  - Ver estado")
        print("  'history' - Ver historial")
        print("  'py:'     - Ejecutar código Python (ej: py:print('hola'))")
        print()
        
        while True:
            try:
                cmd = input("sandbox> ").strip()
                
                if not cmd:
                    continue
                
                if cmd.lower() == 'exit':
                    print_info("¡Hasta luego!")
                    break
                
                elif cmd.lower() == 'status':
                    status = await sandbox.get_status()
                    print_info(f"Uptime: {status.uptime_seconds:.1f}s")
                    print_info(f"Procesos activos: {status.active_processes}")
                
                elif cmd.lower() == 'history':
                    history = await sandbox.get_history(limit=5)
                    for h in history:
                        print_info(f"{h['operation_name']}: {h['result'][:50]}")
                
                elif cmd.startswith('py:'):
                    code = cmd[3:].strip()
                    result = await sandbox.execute_python(code)
                    if result.success:
                        if result.stdout:
                            print(result.stdout.rstrip())
                    else:
                        print_error(result.error_message)
                
                else:
                    result = await sandbox.execute(cmd)
                    if result.success:
                        if result.stdout:
                            print(result.stdout.rstrip())
                        if result.stderr:
                            print_error(result.stderr.rstrip())
                    else:
                        print_error(result.error_message)
            
            except KeyboardInterrupt:
                print("\n")
                continue
            except EOFError:
                break


async def run_tests():
    """Ejecuta tests básicos."""
    print_header("🧪 Ejecutando Tests")
    
    tests_passed = 0
    tests_failed = 0
    
    async with SandboxEnvironment() as sandbox:
        # Test 1: Inicialización
        print_info("Test 1: Inicialización...")
        status = await sandbox.get_status()
        if status.is_initialized and status.is_healthy:
            print_success("Inicialización OK")
            tests_passed += 1
        else:
            print_error("Inicialización FALLÓ")
            tests_failed += 1
        
        # Test 2: Ejecución de comandos
        print_info("Test 2: Ejecución de comandos...")
        result = await sandbox.execute("echo 'test'")
        if result.success and "test" in result.stdout:
            print_success("Ejecución de comandos OK")
            tests_passed += 1
        else:
            print_error("Ejecución de comandos FALLÓ")
            tests_failed += 1
        
        # Test 3: Bloqueo de comandos peligrosos
        print_info("Test 3: Bloqueo de comandos peligrosos...")
        result = await sandbox.execute("rm -rf /")
        if result.status == ExecutionStatus.BLOCKED:
            print_success("Bloqueo de seguridad OK")
            tests_passed += 1
        else:
            print_error("Bloqueo de seguridad FALLÓ")
            tests_failed += 1
        
        # Test 4: Operaciones de archivos
        print_info("Test 4: Operaciones de archivos...")
        await sandbox.write_file("test_file.txt", "contenido de prueba")
        content = await sandbox.read_file("test_file.txt")
        if content.success and content.data == "contenido de prueba":
            print_success("Operaciones de archivos OK")
            tests_passed += 1
        else:
            print_error("Operaciones de archivos FALLÓ")
            tests_failed += 1
        
        # Test 5: Ejecución de Python
        print_info("Test 5: Ejecución de Python...")
        result = await sandbox.execute_python("print(2 + 2)")
        if result.success and "4" in result.stdout:
            print_success("Ejecución de Python OK")
            tests_passed += 1
        else:
            print_error("Ejecución de Python FALLÓ")
            tests_failed += 1
    
    print()
    print_info(f"Resultados: {tests_passed} pasados, {tests_failed} fallidos")
    
    if tests_failed == 0:
        print_success("¡Todos los tests pasaron!")
    else:
        print_error(f"{tests_failed} tests fallaron")


async def main():
    """Función principal."""
    if console:
        console.print(Panel.fit(
            "[bold blue]🤖 Sistema de Agente IA - Módulo Sandbox[/bold blue]\n"
            "Entorno de ejecución seguro y aislado\n\n"
            "[dim]Versión 1.0.0[/dim]",
            border_style="blue"
        ))
    else:
        print("\n" + "="*60)
        print("🤖 Sistema de Agente IA - Módulo Sandbox")
        print("Entorno de ejecución seguro y aislado")
        print("="*60)
    
    print("\n¿Qué deseas hacer?")
    print("  1. Demo completa")
    print("  2. Modo interactivo")
    print("  3. Ejecutar tests")
    print("  0. Salir")
    
    try:
        choice = input("\nSelección [1]: ").strip() or "1"
        
        if choice == "1":
            await demo_full()
        elif choice == "2":
            await interactive_mode()
        elif choice == "3":
            await run_tests()
        elif choice == "0":
            print_info("¡Hasta luego!")
            return
        else:
            print_error("Opción no válida")
    
    except KeyboardInterrupt:
        print("\n")
        print_info("Operación cancelada")
    
    print()
    print_success("✅ Proceso completado")


# ================================================================================
# PUNTO DE ENTRADA
# ================================================================================

if __name__ == "__main__":
    asyncio.run(main())


# ================================================================================
# CÓMO INTEGRAR CON TU PROYECTO EN REPLIT
# ================================================================================
"""
INSTRUCCIONES DE INTEGRACIÓN:

1. IMPORTAR EL MÓDULO:
   
   from sandbox_complete import SandboxEnvironment, EnvironmentConfig
   
   # O importar componentes específicos:
   from sandbox_complete import (
       SecurityGuard,
       CommandExecutor,
       FileManager,
       StateManager,
       SandboxEnvironment
   )

2. USO BÁSICO:

   import asyncio
   
   async def mi_funcion():
       async with SandboxEnvironment() as sandbox:
           # Ejecutar comando
           result = await sandbox.execute("ls -la")
           print(result.stdout)
           
           # Ejecutar Python
           result = await sandbox.execute_python("print('Hola!')")
           
           # Operaciones de archivo
           await sandbox.write_file("data.txt", "contenido")
           content = await sandbox.read_file("data.txt")
   
   asyncio.run(mi_funcion())

3. CONFIGURACIÓN PERSONALIZADA:

   config = EnvironmentConfig(
       workspace_root="/ruta/a/tu/workspace",
       default_timeout=60,
       enable_security=True,
       auto_save=True
   )
   
   async with SandboxEnvironment(config) as sandbox:
       # ...

4. USO CON EL AGENTE:

   class MiAgente:
       def __init__(self):
           self.sandbox = None
       
       async def iniciar(self):
           self.sandbox = await create_sandbox()
       
       async def ejecutar_tarea(self, comando):
           result = await self.sandbox.execute(comando)
           return result
       
       async def cerrar(self):
           await self.sandbox.shutdown()

5. FUNCIONES DISPONIBLES:

   sandbox.execute(command)         - Ejecutar comando shell
   sandbox.execute_python(code)     - Ejecutar código Python
   sandbox.execute_node(code)       - Ejecutar código Node.js
   sandbox.write_file(path, content) - Escribir archivo
   sandbox.read_file(path)          - Leer archivo
   sandbox.delete_file(path)        - Eliminar archivo
   sandbox.list_files(path)         - Listar directorio
   sandbox.file_exists(path)        - Verificar existencia
   sandbox.get_status()             - Obtener estado
   sandbox.get_history()            - Obtener historial
   sandbox.install_pip_package(pkg) - Instalar paquete pip
   sandbox.install_npm_package(pkg) - Instalar paquete npm
"""
