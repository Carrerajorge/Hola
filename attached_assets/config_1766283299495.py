from __future__ import annotations
from dataclasses import dataclass
import os

@dataclass(frozen=True)
class Settings:
    api_title: str = "Office Agent Pro"
    api_version: str = "0.1.0"

    max_sheets: int = 20
    max_total_cells: int = 2_000_000
    max_total_rows: int = 200_000
    max_block_count: int = 2_000
    max_text_len: int = 50_000
    max_table_cells: int = 200_000

    excel_escape_formula_like_text: bool = True
    excel_col_min_width: float = 8.0
    excel_col_max_width: float = 60.0

    log_level: str = os.getenv("OFFICE_AGENT_LOG_LEVEL", "INFO")
    log_json: bool = os.getenv("OFFICE_AGENT_LOG_JSON", "0") == "1"

def get_settings() -> Settings:
    return Settings()
