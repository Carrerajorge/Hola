from __future__ import annotations

import os
import tempfile
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from docsheets.excel_renderer import render_excel
from docsheets.word_renderer import render_word
from docsheets.validators import (
    parse_doc_spec,
    parse_excel_spec,
    validate_docx_file,
    validate_excel_file,
)
from docsheets.orchestrator import DummyLLM, generate_doc_spec, generate_excel_spec


app = FastAPI(title="docsheets-agent", version="0.1.0")


@app.post("/v1/render/excel")
def render_excel_endpoint(payload: Dict[str, Any]):
    spec = parse_excel_spec(payload)

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)

    render_excel(spec, path)
    errs = validate_excel_file(path)
    if errs:
        raise HTTPException(status_code=500, detail={"errors": errs})

    return FileResponse(
        path,
        filename=f"{spec.workbook_title or 'report'}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/v1/render/word")
def render_word_endpoint(payload: Dict[str, Any]):
    spec = parse_doc_spec(payload)

    fd, path = tempfile.mkstemp(suffix=".docx")
    os.close(fd)

    render_word(spec, path)
    errs = validate_docx_file(path)
    if errs:
        raise HTTPException(status_code=500, detail={"errors": errs})

    return FileResponse(
        path,
        filename=f"{spec.title or 'document'}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


# --- Optional "agent" endpoints ---
# For production you should implement a real LLM client, add auth, rate limits, logging, etc.

@app.post("/v1/generate/excel")
def generate_excel_endpoint(payload: Dict[str, Any]):
    prompt = payload.get("prompt")
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing 'prompt'.")

    # Demo only:
    llm = DummyLLM()
    spec = generate_excel_spec(prompt, llm=llm)

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)

    render_excel(spec, path)
    return FileResponse(
        path,
        filename=f"{spec.workbook_title or 'report'}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/v1/generate/word")
def generate_word_endpoint(payload: Dict[str, Any]):
    prompt = payload.get("prompt")
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing 'prompt'.")

    # Demo only:
    llm = DummyLLM()
    spec = generate_doc_spec(prompt, llm=llm)

    fd, path = tempfile.mkstemp(suffix=".docx")
    os.close(fd)

    render_word(spec, path)
    return FileResponse(
        path,
        filename=f"{spec.title or 'document'}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
