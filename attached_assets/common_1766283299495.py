from __future__ import annotations
import re
from typing import Any
_CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")
def is_cell_ref(value: str) -> bool: return bool(_CELL_RE.match(value or ""))
def assert_cell_ref(value: str) -> str:
    if not is_cell_ref(value):
        raise ValueError(f"Invalid cell reference: {value!r} (expected like 'A1')")
    return value
def safe_str(value: Any) -> str:
    try: return "" if value is None else str(value)
    except Exception: return ""
