# server/agent/python_agent/safe_exec.py
"""
SafeExecutor - Ejecución segura de comandos sin shell injection.

Este módulo centraliza TODA la ejecución de procesos con:
- Prohibición de shell=True
- Allowlist de programas permitidos
- Validación de argumentos
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
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence, Optional, Tuple


# =========================
# CONFIG (LOCKDOWN)
# =========================
_ALLOWED_PROGRAMS: set[str] = {
    sys.executable,
    "python", "python3",
    "pip", "pip3",
    "playwright",
    "node",
    "npm",
    "bash",
}

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

_PIP_SPEC_RE = re.compile(r"^[A-Za-z0-9_.-]+(==[A-Za-z0-9_.-]+)?$")


def _clean_env(env: Mapping[str, str] | None) -> dict[str, str]:
    """Limpia variables de entorno, removiendo secretos."""
    base = dict(env or os.environ)
    sensitive_patterns = ("SECRET", "API_KEY", "TOKEN", "PASSWORD", "PRIVATE", "CREDENTIAL")
    for k in list(base.keys()):
        if any(p in k.upper() for p in sensitive_patterns):
            base.pop(k, None)
    return base


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


def _resolve_program(program: str) -> str:
    """Resuelve el programa a una ruta segura."""
    if program == "python" or program == "python3":
        return sys.executable
    return program


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
        return Command(
            program="/bin/bash",
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

    # ---- Ejecución sync ----
    def run(self, cmd: Command) -> ExecutionResult:
        """Ejecuta comando de forma síncrona."""
        resolved_program = _resolve_program(cmd.program)
        if resolved_program not in _ALLOWED_PROGRAMS and cmd.program not in _ALLOWED_PROGRAMS:
            raise ValueError(f"Blocked program: {cmd.program}")

        _validate_args(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        try:
            result = subprocess.run(
                [resolved_program, *cmd.args],
                capture_output=True,
                text=True,
                timeout=cmd.timeout,
                cwd=cmd.cwd,
                env=_clean_env(self.env),
                check=False,
                shell=False,
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
        """Ejecuta comando de forma asíncrona."""
        resolved_program = _resolve_program(cmd.program)
        if resolved_program not in _ALLOWED_PROGRAMS and cmd.program not in _ALLOWED_PROGRAMS:
            raise ValueError(f"Blocked program: {cmd.program}")

        _validate_args(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        try:
            proc = await asyncio.create_subprocess_exec(
                resolved_program, *cmd.args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cmd.cwd,
                env=_clean_env(self.env),
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
