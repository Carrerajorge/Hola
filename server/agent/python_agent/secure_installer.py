"""Secure package installation with strict validation."""
import re
import subprocess
import sys
from typing import FrozenSet

# Strict allowlist of permitted packages
ALLOWED_PACKAGES: FrozenSet[str] = frozenset([
    "aiofiles", "rich", "httpx", "aiohttp", "beautifulsoup4", "lxml",
    "python-pptx", "python-docx", "openpyxl", "Pillow", "fake-useragent",
    "diskcache", "playwright", "selenium", "webdriver-manager",
    "pandas", "matplotlib", "numpy", "fastapi", "uvicorn", "pydantic"
])

# Strict regex: only alphanumeric, hyphens, underscores, dots
PACKAGE_NAME_PATTERN = re.compile(r'^[a-zA-Z][a-zA-Z0-9._-]*$')

def validate_package_name(pkg: str) -> bool:
    """Validate package name against allowlist and pattern."""
    if not pkg or len(pkg) > 100:
        return False
    if not PACKAGE_NAME_PATTERN.match(pkg):
        return False
    # Extract base package name (remove version specifiers, extras)
    base_name = pkg.split('[')[0].split('<')[0].split('>')[0].split('=')[0].split('!')[0]
    return base_name.lower() in {p.lower() for p in ALLOWED_PACKAGES}

def safe_pip_install(pkg: str, quiet: bool = True, timeout: int = 120) -> bool:
    """Securely install a package using pip."""
    if not validate_package_name(pkg):
        print(f"⚠️ Package not in allowlist: {pkg}")
        return False
    
    try:
        args = [sys.executable, "-m", "pip", "install", pkg]
        if quiet:
            args.extend(["-q", "--disable-pip-version-check"])
        
        result = subprocess.run(
            args,
            capture_output=True,
            timeout=timeout,
            check=False  # Don't raise on non-zero exit
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"⚠️ Timeout installing: {pkg}")
        return False
    except Exception as e:
        print(f"⚠️ Error installing {pkg}: {e}")
        return False
