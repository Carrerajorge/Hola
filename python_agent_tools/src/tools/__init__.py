"""Tools module providing base classes and utilities for tool implementations."""

from .base import (
    BaseTool,
    ToolCategory,
    Priority,
    ToolInput,
    ToolOutput,
    InputT,
    OutputT,
)

from .shell import ShellTool, ShellInput, ShellOutput
from .code_execute import CodeExecuteTool, CodeExecuteInput, CodeExecuteOutput
from .file_tools import (
    FileReadTool,
    FileReadInput,
    FileReadOutput,
    FileWriteTool,
    FileWriteInput,
    FileWriteOutput,
)
from .pdf_tools import PdfTool, PdfInput, PdfOutput
from .image_gen import ImageGenTool, ImageGenInput, ImageGenOutput
from .tts_tools import TTSTool, TTSInput, TTSOutput
from . import dynamic_skills  # Automatically registers 95+ data tools

__all__ = [
    "BaseTool",
    "ToolCategory",
    "Priority",
    "ToolInput",
    "ToolOutput",
    "InputT",
    "OutputT",
    "ShellTool",
    "ShellInput",
    "ShellOutput",
    "CodeExecuteTool",
    "CodeExecuteInput",
    "CodeExecuteOutput",
    "FileReadTool",
    "FileReadInput",
    "FileReadOutput",
    "FileWriteTool",
    "FileWriteInput",
    "FileWriteOutput",
]
