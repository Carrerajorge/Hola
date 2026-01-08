"""Secure package installation with strict validation."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import FrozenSet, Optional

try:
    from packaging.requirements import Requirement
except ImportError:
    Requirement = None  # type: ignore

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", Path.cwd())).resolve()

# Strict allowlist of permitted packages (case-insensitive matching)
ALLOWED_PACKAGES: FrozenSet[str] = frozenset([
    "aiofiles", "rich", "httpx", "aiohttp", "beautifulsoup4", "lxml",
    "python-pptx", "python-docx", "openpyxl", "Pillow", "fake-useragent",
    "diskcache", "playwright", "selenium", "webdriver-manager",
    "pandas", "matplotlib", "numpy", "fastapi", "uvicorn", "pydantic"
])

# Strict regex patterns
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_PIN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.*+!-]*$")


def _resolve_cwd(cwd: Optional[str] = None) -> str:
    """Restrict cwd to workspace root."""
    target = (WORKSPACE_ROOT / cwd).resolve() if cwd else WORKSPACE_ROOT
    if target != WORKSPACE_ROOT and WORKSPACE_ROOT not in target.parents:
        raise PermissionError("cwd outside WORKSPACE_ROOT not allowed")
    return str(target)


def _clean_env() -> dict[str, str]:
    """Create hardened environment for pip."""
    env = dict(os.environ)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PIP_CONFIG_FILE"] = os.devnull
    return {k: v for k, v in env.items() if isinstance(k, str) and isinstance(v, str)}


def _normalize_and_validate_pkg(pkg: str, *, require_pin: bool = False) -> str:
    """
    Validate and normalize package specification.
    
    Blocks:
    - Flags (starting with -)
    - URLs/VCS/paths (git+, @, ://, etc.)
    - Extras and markers (for security)
    - Packages not in allowlist
    """
    if not isinstance(pkg, str):
        raise TypeError("pkg must be a string")
    
    pkg = pkg.strip()
    
    if not pkg or len(pkg) > 200:
        raise ValueError("pkg invalid (empty or too long)")
    
    # Block pip flags and whitespace
    if pkg.startswith("-") or any(ch.isspace() for ch in pkg):
        raise ValueError("pkg invalid (looks like flag or contains spaces)")
    
    # Block URLs/VCS/paths that pip would accept
    blocked_tokens = ("@", "://", "git+", "hg+", "svn+", "bzr+", "../", "/.", "\\", ":")
    if any(t in pkg for t in blocked_tokens) or pkg.startswith((".", "/")):
        raise ValueError("pkg invalid (URL/VCS/path not allowed)")
    
    if Requirement is not None:
        try:
            r = Requirement(pkg)
        except Exception as e:
            raise ValueError(f"Invalid package specification: {e}")
        
        # Block extras, markers, URLs for security
        if r.url is not None or r.marker is not None or r.extras:
            raise ValueError("pkg invalid (extras/marker/url not allowed)")
        
        name = r.name
        if not _NAME_RE.match(name):
            raise ValueError("Invalid package name")
        
        if require_pin:
            if not r.specifier or str(r.specifier).count("==") != 1:
                raise ValueError("Exact pin required: package==version")
        
        normalized = f"{name}{r.specifier}" if r.specifier else name
    else:
        # Fallback without packaging library
        if require_pin:
            if not _PIN_RE.match(pkg):
                raise ValueError("Exact pin required: package==version")
            normalized = pkg
        else:
            base_name = pkg.split("=")[0].split("<")[0].split(">")[0].split("!")[0].split("[")[0]
            if not _NAME_RE.match(base_name):
                raise ValueError("Invalid package name format")
            normalized = pkg
            name = base_name
    
    # Check against allowlist (case-insensitive)
    base_for_allowlist = normalized.split("=")[0].split("<")[0].split(">")[0]
    if base_for_allowlist.lower() not in {p.lower() for p in ALLOWED_PACKAGES}:
        raise PermissionError(f"Package not in allowlist: {base_for_allowlist}")
    
    return normalized


def validate_package_name(pkg: str) -> bool:
    """Validate package name against allowlist and pattern."""
    try:
        _normalize_and_validate_pkg(pkg, require_pin=False)
        return True
    except (ValueError, TypeError, PermissionError):
        return False


def safe_pip_install(pkg: str, quiet: bool = True, timeout: int = 120) -> bool:
    """
    Securely install a package using pip.
    
    Security measures:
    - Package validated against allowlist
    - Blocks flags, URLs, VCS, paths
    - Hardened pip environment (no input, no config)
    - cwd restricted to workspace
    - shell=False prevents shell injection
    """
    try:
        safe_pkg = _normalize_and_validate_pkg(pkg, require_pin=False)
    except (ValueError, TypeError, PermissionError) as e:
        print(f"⚠️ Package validation failed: {e}")
        return False
    
    cmd = [sys.executable, "-m", "pip", "install", safe_pkg]
    if quiet:
        cmd.extend(["-q", "--disable-pip-version-check", "--no-input", "--no-cache-dir"])
    
    try:
        # Validation above ensures safe_pkg is from allowlist and properly formatted.
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use.dangerous-subprocess-use
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
            cwd=_resolve_cwd(),
            env=_clean_env(),
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"⚠️ Timeout installing: {safe_pkg}")
        return False
    except Exception as e:
        print(f"⚠️ Error installing {safe_pkg}: {e}")
        return False
