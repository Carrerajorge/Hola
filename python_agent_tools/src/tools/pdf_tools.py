"""PDF processing tools for manipulating and extracting data from PDFs."""

from typing import Optional, List, Literal
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import base64
import io

class PdfInput(ToolInput):
    """Input for PDF manipulation tool."""
    action: Literal["extract_text", "merge", "info"] = Field(..., description="Action to perform on the PDF")
    pdf_base64: Optional[str] = Field(None, description="Base64 encoded PDF file (Primary file)")
    pdf_base64_list: Optional[List[str]] = Field(None, description="List of Base64 encoded PDF files (For merge action)")
    start_page: Optional[int] = Field(None, description="Start page for text extraction (0-indexed)")
    end_page: Optional[int] = Field(None, description="End page for text extraction (0-indexed)")

class PdfOutput(ToolOutput):
    """Output from PDF manipulation tool."""
    pass

@ToolRegistry.register
class PdfTool(BaseTool[PdfInput, PdfOutput]):
    """Tool for manipulating and extracting information from PDF documents."""
    
    name = "nano-pdf"
    description = "PDF operations: extract text, retrieve metadata, or merge multiple PDFs."
    category = ToolCategory.PROCESSING
    priority = Priority.MEDIUM
    
    async def execute(self, input: PdfInput) -> PdfOutput:
        try:
            import PyPDF2
        except ImportError:
            return PdfOutput(
                success=False,
                error="PyPDF2 is not installed. Please install it to use this tool."
            )
            
        try:
            if input.action == "extract_text":
                return await self._extract_text(input, PyPDF2)
            elif input.action == "info":
                return await self._get_info(input, PyPDF2)
            elif input.action == "merge":
                return await self._merge_pdfs(input, PyPDF2)
            else:
                return PdfOutput(success=False, error=f"Unknown action: {input.action}")
        except Exception as e:
            self.logger.error("pdf_tool_error", error=str(e))
            return PdfOutput(success=False, error=str(e))

    async def _extract_text(self, input: PdfInput, pypdf) -> PdfOutput:
        if not input.pdf_base64:
            return PdfOutput(success=False, error="pdf_base64 is required for extract_text action")
            
        pdf_bytes = base64.b64decode(input.pdf_base64)
        pdf_file = io.BytesIO(pdf_bytes)
        reader = pypdf.PdfReader(pdf_file)
        
        text = ""
        start = input.start_page or 0
        end = input.end_page or len(reader.pages)
        
        for i in range(start, min(end, len(reader.pages))):
            page = reader.pages[i]
            text += page.extract_text() + "\n"
            
        return PdfOutput(
            success=True,
            data={"text": text.strip(), "pages_extracted": min(end, len(reader.pages)) - start}
        )

    async def _get_info(self, input: PdfInput, pypdf) -> PdfOutput:
        if not input.pdf_base64:
            return PdfOutput(success=False, error="pdf_base64 is required for info action")
            
        pdf_bytes = base64.b64decode(input.pdf_base64)
        pdf_file = io.BytesIO(pdf_bytes)
        reader = pypdf.PdfReader(pdf_file)
        
        meta = reader.metadata
        return PdfOutput(
            success=True,
            data={
                "num_pages": len(reader.pages),
                "author": meta.author if meta else None,
                "creator": meta.creator if meta else None,
                "producer": meta.producer if meta else None,
                "subject": meta.subject if meta else None,
                "title": meta.title if meta else None
            }
        )

    async def _merge_pdfs(self, input: PdfInput, pypdf) -> PdfOutput:
        if not input.pdf_base64_list or len(input.pdf_base64_list) < 2:
            return PdfOutput(success=False, error="pdf_base64_list containing at least 2 PDFs is required for merge action")
            
        merger = pypdf.PdfMerger()
        for b64 in input.pdf_base64_list:
            pdf_bytes = base64.b64decode(b64)
            merger.append(io.BytesIO(pdf_bytes))
            
        output = io.BytesIO()
        merger.write(output)
        merger.close()
        
        merged_b64 = base64.b64encode(output.getvalue()).decode('utf-8')
        return PdfOutput(
            success=True,
            data={"merged_pdf_base64": merged_b64},
            metadata={"files_merged": len(input.pdf_base64_list)}
        )
