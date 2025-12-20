from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator


# -------------------------
# Excel (XLSX) specification
# -------------------------

JsonScalar = Union[str, int, float, bool, None]


class TableSpec(BaseModel):
    """A rectangular table starting at `anchor` (e.g., 'A1')."""

    anchor: str = Field(..., description="Top-left cell, e.g. 'A1'")
    headers: List[str] = Field(..., min_length=1)
    rows: List[List[Any]] = Field(default_factory=list)
    table_style: str = Field(
        default="TableStyleMedium9",
        description="Excel table style name (OpenXML), e.g. TableStyleMedium9",
    )
    column_formats: Dict[str, str] = Field(
        default_factory=dict,
        description="Map header -> Excel number format (e.g. '0.0%', '$#,##0')",
    )
    autofilter: bool = True
    freeze_header: bool = True

    @model_validator(mode="after")
    def _validate_rectangular(self) -> "TableSpec":
        # All rows should have len == len(headers)
        n = len(self.headers)
        for i, r in enumerate(self.rows):
            if len(r) != n:
                raise ValueError(
                    f"Row {i} has {len(r)} cells but headers has {n}. "
                    "Make rows rectangular."
                )
        return self


class ChartSpec(BaseModel):
    """Minimal chart spec."""

    type: Literal["bar", "line", "pie"] = "bar"
    title: str = ""
    categories_range: str = Field(
        ...,
        description="Excel A1 range for categories (labels). Example: 'A2:A10'",
    )
    values_range: str = Field(
        ...,
        description="Excel A1 range for values. Example: 'B2:B10'",
    )
    position: str = Field(
        "H2",
        description="Top-left position of the chart, e.g. 'H2'",
    )


class SheetLayoutSpec(BaseModel):
    freeze_panes: Optional[str] = Field(
        None, description="Cell reference for freeze panes, e.g. 'A2'"
    )
    auto_fit_columns: bool = True
    column_widths: Dict[str, float] = Field(
        default_factory=dict, description="Map column letter -> width"
    )
    show_gridlines: bool = True


class SheetSpec(BaseModel):
    name: str = Field(..., min_length=1, max_length=31)
    tables: List[TableSpec] = Field(default_factory=list)
    charts: List[ChartSpec] = Field(default_factory=list)
    layout: SheetLayoutSpec = Field(default_factory=SheetLayoutSpec)


class ExcelSpec(BaseModel):
    """Full workbook spec."""

    workbook_title: str = "Report"
    sheets: List[SheetSpec] = Field(..., min_length=1)


# ------------------------
# Word (DOCX) specification
# ------------------------

class HeadingBlock(BaseModel):
    type: Literal["heading"] = "heading"
    level: int = Field(1, ge=1, le=6)
    text: str


class ParagraphBlock(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    text: str


class BulletsBlock(BaseModel):
    type: Literal["bullets"] = "bullets"
    items: List[str] = Field(..., min_length=1)


class TableBlock(BaseModel):
    type: Literal["table"] = "table"
    columns: List[str] = Field(..., min_length=1)
    rows: List[List[Any]] = Field(default_factory=list)
    style: str = Field("Light Shading", description="Word table style name")

    @model_validator(mode="after")
    def _validate_rectangular(self) -> "TableBlock":
        n = len(self.columns)
        for i, r in enumerate(self.rows):
            if len(r) != n:
                raise ValueError(
                    f"Row {i} has {len(r)} cells but columns has {n}. "
                    "Make rows rectangular."
                )
        return self


class PageBreakBlock(BaseModel):
    type: Literal["page_break"] = "page_break"


DocBlock = Union[HeadingBlock, ParagraphBlock, BulletsBlock, TableBlock, PageBreakBlock]


class DocSpec(BaseModel):
    title: str = "Document"
    author: Optional[str] = None
    add_toc: bool = False
    blocks: List[DocBlock] = Field(default_factory=list, description="Ordered content blocks")
