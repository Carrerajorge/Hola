# server/agent/python_agent/safe_exec.py
"""
SafeExecutor - Ejecución segura de comandos sin shell injection.

Este módulo centraliza TODA la ejecución de procesos con:
- Prohibición de shell=True
- Allowlist de programas permitidos (rutas absolutas canónicas)
- Dispatcher con literales estáticos para satisfacer SAST
- Validación de argumentos por programa
- Sanitización de variables de entorno
- Timeout obligatorio
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import subprocess
import shlex
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence, Optional, Tuple, Literal


# =========================
# CONFIG (LOCKDOWN) - RUTAS ABSOLUTAS CANÓNICAS
# =========================
def _resolve_executable_path(name: str) -> str | None:
    """Resuelve un ejecutable a su ruta absoluta canónica."""
    path = shutil.which(name)
    if path:
        return os.path.realpath(path)
    return None

# Rutas absolutas canónicas resueltas al cargar el módulo
_PYTHON_PATH: str = os.path.realpath(sys.executable)
_BASH_PATH: str | None = _resolve_executable_path("bash")
_NODE_PATH: str | None = _resolve_executable_path("node")
_NPM_PATH: str | None = _resolve_executable_path("npm")

# Alias a rutas canónicas (para validación)
_EXECUTABLE_ALIASES: dict[str, str | None] = {
    "python": _PYTHON_PATH,
    "python3": _PYTHON_PATH,
    "pip": _PYTHON_PATH,  # pip se ejecuta via python -m pip
    "pip3": _PYTHON_PATH,
    "playwright": _PYTHON_PATH,  # playwright via python -m playwright
    "bash": _BASH_PATH,
    "node": _NODE_PATH,
    "npm": _NPM_PATH,
}

# Tipos de programa para el dispatcher
ProgramType = Literal["python", "bash", "node", "npm"]

# Paquetes permitidos (PINEADOS). Agrega SOLO lo necesario.
_ALLOWED_PIP_SPECS: dict[str, str] = {
    "rich": "rich==13.9.4",
    "aiofiles": "aiofiles==24.1.0",
    "httpx": "httpx==0.27.0",
    "aiohttp": "aiohttp==3.9.5",
    "beautifulsoup4": "beautifulsoup4==4.12.3",
    "lxml": "lxml==5.2.2",
    "python-pptx": "python-pptx==0.6.23",
    "python-docx": "python-docx==1.1.2",
    "openpyxl": "openpyxl==3.1.5",
    "playwright": "playwright==1.45.0",
    "Pillow": "Pillow==10.4.0",
    "pypdf": "pypdf==4.3.1",
    "mammoth": "mammoth==1.8.0",
    "striprtf": "striprtf==0.0.26",
}

# Flags de pip que bloqueamos porque amplían superficie de supply-chain/injection.
_BLOCKED_PIP_FLAGS: set[str] = {
    "-r", "--requirement",
    "--extra-index-url", "--index-url",
    "--trusted-host",
    "--no-index",
    "-e", "--editable",
    "--pre",
}

# Patrones de argumentos peligrosos
_DANGEROUS_ARG_PATTERNS: list[re.Pattern] = [
    re.compile(r"[;&|`$]"),  # Shell metacharacters
    re.compile(r"\$\("),     # Command substitution
    re.compile(r"\n|\r"),    # Newlines
    re.compile(r"\x00"),     # Null bytes
]

# Flags que permiten ejecución de código inline (RCE via -c/-e)
_BLOCKED_INLINE_CODE_FLAGS: set[str] = {
    "-c", "--command",       # python -c, bash -c
    "-e", "--eval",          # node -e, perl -e
    "--exec",                # algunas herramientas
}

_PIP_SPEC_RE = re.compile(r"^[A-Za-z0-9_.-]+(==[A-Za-z0-9_.-]+)?$")

# Subcomandos/flags permitidos por programa (defensa en profundidad)
_ALLOWED_PYTHON_FIRST_ARGS: set[str] = {
    "-m",           # módulos permitidos (pip, playwright)
}
_ALLOWED_PYTHON_MODULES: set[str] = {
    "pip",
    "playwright",
}


def _get_program_type(program: str) -> ProgramType | None:
    """Determina el tipo de programa basado en el alias o ruta."""
    program_real = os.path.realpath(program) if os.path.isabs(program) else None
    
    if program in {"python", "python3"} or program == sys.executable:
        return "python"
    if program_real == _PYTHON_PATH:
        return "python"
    
    if program == "bash" or program_real == _BASH_PATH:
        return "bash"
    
    if program == "node" or program_real == _NODE_PATH:
        return "node"
    
    if program in {"npm", "pip", "pip3", "playwright"}:
        return "python"  # Estos se ejecutan via python -m
    
    return None


def _canonicalize_program(program: str) -> tuple[ProgramType, str]:
    """
    Canoniza el programa y retorna su tipo y ruta absoluta.
    Raises ValueError si el programa no está permitido.
    """
    prog_type = _get_program_type(program)
    if prog_type is None:
        raise ValueError(f"Blocked program: {program}")
    
    # Verificar que la ruta canónica coincide con nuestra allowlist
    if prog_type == "python":
        return ("python", _PYTHON_PATH)
    elif prog_type == "bash":
        if _BASH_PATH is None:
            raise ValueError("bash not available on this system")
        return ("bash", _BASH_PATH)
    elif prog_type == "node":
        if _NODE_PATH is None:
            raise ValueError("node not available on this system")
        return ("node", _NODE_PATH)
    elif prog_type == "npm":
        if _NPM_PATH is None:
            raise ValueError("npm not available on this system")
        return ("npm", _NPM_PATH)
    
    raise ValueError(f"Blocked program: {program}")


def _clean_env(env: Mapping[str, str] | None) -> dict[str, str]:
    """Creates a minimal, safe environment for child processes.
    
    Instead of inheriting the entire environment and removing secrets,
    we explicitly allowlist only the necessary environment variables.
    This prevents leaking any secrets that might be in the parent environment.
    """
    ALLOWED_ENV_VARS = {
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "SHELL",
        "PYTHONPATH",
        "PYTHONIOENCODING",
        "NODE_PATH",
        "NODE_ENV",
        "TMPDIR",
        "TMP",
        "TEMP",
    }
    
    source = env if env is not None else os.environ
    return {k: v for k, v in source.items() if k in ALLOWED_ENV_VARS}


def _deny_dangerous_chars(s: str) -> None:
    """Bloquea caracteres peligrosos en argumentos."""
    for pattern in _DANGEROUS_ARG_PATTERNS:
        if pattern.search(s):
            raise ValueError(f"Blocked dangerous characters in argument: {repr(s)}")


def _validate_args(args: Sequence[str]) -> None:
    """Valida todos los argumentos."""
    for a in args:
        if not isinstance(a, str):
            raise ValueError(f"Argument must be string, got {type(a)}")
        if a.strip() == "":
            raise ValueError("Blocked empty argument")
        _deny_dangerous_chars(a)


def _is_pip(program: str, args: Sequence[str]) -> bool:
    """Detecta si es un comando pip."""
    if program in {"pip", "pip3"}:
        return True
    if program in {sys.executable, "python", "python3"} and list(args)[:2] == ["-m", "pip"]:
        return True
    return False


def _validate_pip_args(args: Sequence[str]) -> None:
    """Valida argumentos de pip, bloqueando flags peligrosos."""
    for a in args:
        if a in _BLOCKED_PIP_FLAGS:
            raise ValueError(f"Blocked pip flag: {a}")


def _validate_no_inline_code_flags(args: Sequence[str]) -> None:
    """Bloquea flags que permiten ejecución de código inline (-c, -e, etc.)."""
    for a in args:
        if a in _BLOCKED_INLINE_CODE_FLAGS:
            raise ValueError(f"Blocked inline code execution flag: {a}")


@dataclass(frozen=True)
class Command:
    """Comando inmutable para ejecución segura."""
    program: str
    args: tuple[str, ...]
    cwd: str | None = None
    timeout: int = 120


@dataclass
class ExecutionResult:
    """Resultado de ejecución."""
    returncode: int
    stdout: str
    stderr: str
    success: bool = True
    error: str | None = None


class SafeExecutor:
    """
    Ejecutor seguro de comandos:
    - No usa shell
    - Valida programas y args
    - Bloquea pip peligroso
    - Permite operaciones del catálogo
    """

    def __init__(self, workdir: str | None = None, env: Mapping[str, str] | None = None):
        self.workdir = workdir
        self.env = env

    # ---- Catálogo de operaciones seguras ----
    def cmd_playwright_install_chromium(self) -> Command:
        """Comando para instalar Chromium via Playwright."""
        return Command(
            program=sys.executable,
            args=("-m", "playwright", "install", "chromium"),
            cwd=self.workdir,
            timeout=300,
        )

    def cmd_pip_install_allowlisted(self, package_key: str) -> Command:
        """Comando para instalar paquete de la allowlist."""
        if package_key not in _ALLOWED_PIP_SPECS:
            raise ValueError(f"Blocked pip package key: {package_key}. Allowed: {list(_ALLOWED_PIP_SPECS.keys())}")
        spec = _ALLOWED_PIP_SPECS[package_key]
        return Command(
            program=sys.executable,
            args=("-m", "pip", "install", spec, "-q", "--disable-pip-version-check"),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_python_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Python."""
        resolved_script = Path(script_path).resolve()
        if self.workdir:
            wd = Path(self.workdir).resolve()
            if wd not in resolved_script.parents and wd != resolved_script.parent:
                raise ValueError(f"Blocked script path outside workdir: {script_path}")
        if not resolved_script.suffix == ".py":
            raise ValueError(f"Only .py scripts allowed: {script_path}")
        return Command(
            program=sys.executable,
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_bash_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Bash."""
        resolved_script = Path(script_path).resolve()
        if self.workdir:
            wd = Path(self.workdir).resolve()
            if wd not in resolved_script.parents and wd != resolved_script.parent:
                raise ValueError(f"Blocked script path outside workdir: {script_path}")
        if not resolved_script.suffix == ".sh":
            raise ValueError(f"Only .sh scripts allowed: {script_path}")
        if _BASH_PATH is None:
            raise ValueError("bash not available on this system")
        return Command(
            program="bash",  # Se canoniza a _BASH_PATH en run()/arun()
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_node_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Node.js."""
        resolved_script = Path(script_path).resolve()
        if self.workdir:
            wd = Path(self.workdir).resolve()
            if wd not in resolved_script.parents and wd != resolved_script.parent:
                raise ValueError(f"Blocked script path outside workdir: {script_path}")
        if resolved_script.suffix not in {".js", ".mjs"}:
            raise ValueError(f"Only .js/.mjs scripts allowed: {script_path}")
        return Command(
            program="node",
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    # ---- Dispatcher sync con literales estáticos ----
    def _dispatch_sync(
        self,
        prog_type: ProgramType,
        args: Sequence[str],
        cwd: str | None,
        timeout: int,
        env: dict[str, str],
    ) -> subprocess.CompletedProcess:
        """
        Dispatcher que ejecuta procesos con rutas LITERALES estáticas.
        Esto satisface SAST al no pasar variables al primer argumento.
        """
        args_list = list(args)
        
        if prog_type == "python":
            return subprocess.run(
                [_PYTHON_PATH, *args_list],  # Literal estático
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "bash":
            if _BASH_PATH is None:
                raise ValueError("bash not available")
            return subprocess.run(
                [_BASH_PATH, *args_list],  # Literal estático
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "node":
            if _NODE_PATH is None:
                raise ValueError("node not available")
            return subprocess.run(
                [_NODE_PATH, *args_list],  # Literal estático
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "npm":
            if _NPM_PATH is None:
                raise ValueError("npm not available")
            return subprocess.run(
                [_NPM_PATH, *args_list],  # Literal estático
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        
        raise ValueError(f"Unsupported program type: {prog_type}")

    # ---- Dispatcher async con literales estáticos ----
    async def _dispatch_async(
        self,
        prog_type: ProgramType,
        args: Sequence[str],
        cwd: str | None,
        env: dict[str, str],
    ) -> asyncio.subprocess.Process:
        """
        Dispatcher async que ejecuta procesos con rutas LITERALES estáticas.
        Esto satisface SAST al no pasar variables al primer argumento de create_subprocess_exec.
        """
        args_list = list(args)
        
        if prog_type == "python":
            return await asyncio.create_subprocess_exec(
                _PYTHON_PATH, *args_list,  # Literal estático
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "bash":
            if _BASH_PATH is None:
                raise ValueError("bash not available")
            return await asyncio.create_subprocess_exec(
                _BASH_PATH, *args_list,  # Literal estático
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "node":
            if _NODE_PATH is None:
                raise ValueError("node not available")
            return await asyncio.create_subprocess_exec(
                _NODE_PATH, *args_list,  # Literal estático
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "npm":
            if _NPM_PATH is None:
                raise ValueError("npm not available")
            return await asyncio.create_subprocess_exec(
                _NPM_PATH, *args_list,  # Literal estático
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        
        raise ValueError(f"Unsupported program type: {prog_type}")

    # ---- Ejecución sync ----
    def run(self, cmd: Command) -> ExecutionResult:
        """Ejecuta comando de forma síncrona usando dispatcher con literales."""
        prog_type, _ = _canonicalize_program(cmd.program)

        _validate_args(cmd.args)
        _validate_no_inline_code_flags(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        try:
            result = self._dispatch_sync(
                prog_type,
                cmd.args,
                cmd.cwd,
                cmd.timeout,
                _clean_env(self.env),
            )
            return ExecutionResult(
                returncode=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                success=result.returncode == 0,
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=f"Command timed out after {cmd.timeout}s",
            )
        except Exception as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=str(e),
            )

    # ---- Ejecución async ----
    async def arun(self, cmd: Command) -> ExecutionResult:
        """Ejecuta comando de forma asíncrona usando dispatcher con literales."""
        prog_type, _ = _canonicalize_program(cmd.program)

        _validate_args(cmd.args)
        _validate_no_inline_code_flags(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        try:
            proc = await self._dispatch_async(
                prog_type,
                cmd.args,
                cmd.cwd,
                _clean_env(self.env),
            )
            try:
                out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=cmd.timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return ExecutionResult(
                    returncode=-1,
                    stdout="",
                    stderr="",
                    success=False,
                    error=f"Command timed out after {cmd.timeout}s",
                )
            
            return ExecutionResult(
                returncode=proc.returncode or 0,
                stdout=(out_b or b"").decode("utf-8", "replace"),
                stderr=(err_b or b"").decode("utf-8", "replace"),
                success=(proc.returncode or 0) == 0,
            )
        except Exception as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=str(e),
            )


# Singleton para uso global
_default_executor: SafeExecutor | None = None


def get_executor(workdir: str | None = None) -> SafeExecutor:
    """Obtiene o crea el executor por defecto."""
    global _default_executor
    if _default_executor is None or workdir is not None:
        _default_executor = SafeExecutor(workdir=workdir)
    return _default_executor
