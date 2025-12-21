from __future__ import annotations
import os, uuid, logging
from typing import Any, Dict
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from ..logging import setup_logging
from ..schemas.excel import ExcelSpec
from ..schemas.word import DocSpec
from ..renderers.excel import render_excel_bytes
from ..renderers.word import render_word_bytes
from ..validators.excel import validate_xlsx_bytes
from ..validators.word import validate_docx_bytes
from ..quality.rules_excel import run_quality_gates_excel
from ..quality.rules_word import run_quality_gates_word
from ..llm.dummy import DummyLLM
from ..llm.openai_compat import OpenAICompatibleChatLLM
from ..orchestrator.agent import generate_excel_spec, generate_word_spec
from ..config import get_settings

setup_logging()
log = logging.getLogger("office_agent.api")

s = get_settings()
app = FastAPI(title=s.api_title, version=s.api_version)

@app.middleware("http")
async def request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = rid
    resp = await call_next(request)
    resp.headers["x-request-id"] = rid
    return resp

@app.get("/health")
def health() -> Dict[str,str]:
    return {"status":"ok"}

def _llm_from_env():
    provider = os.getenv("OFFICE_AGENT_LLM_PROVIDER","dummy").lower()
    if provider in ("oa","openai_compat","openai-compatible"):
        return OpenAICompatibleChatLLM.from_env()
    return DummyLLM()

@app.post("/v1/render/excel")
async def render_excel(spec: ExcelSpec) -> Response:
    q = run_quality_gates_excel(spec)
    if q.errors:
        return JSONResponse(status_code=422, content={"error":"quality_gate","report": q.to_dict()})
    data = render_excel_bytes(spec)
    validate_xlsx_bytes(data)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="document.xlsx"'})

@app.post("/v1/render/word")
async def render_word(spec: DocSpec) -> Response:
    q = run_quality_gates_word(spec)
    if q.errors:
        return JSONResponse(status_code=422, content={"error":"quality_gate","report": q.to_dict()})
    data = render_word_bytes(spec)
    validate_docx_bytes(data)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": 'attachment; filename="document.docx"'})

@app.post("/v1/generate/excel")
async def generate_excel(payload: Dict[str, Any]) -> Response:
    prompt = str(payload.get("prompt","")).strip()
    if not prompt:
        return JSONResponse(status_code=422, content={"error":"missing_prompt"})
    llm = _llm_from_env()
    spec, _ = generate_excel_spec(prompt, llm)
    data = render_excel_bytes(spec); validate_xlsx_bytes(data)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="generated.xlsx"'})

@app.post("/v1/generate/word")
async def generate_word(payload: Dict[str, Any]) -> Response:
    prompt = str(payload.get("prompt","")).strip()
    if not prompt:
        return JSONResponse(status_code=422, content={"error":"missing_prompt"})
    llm = _llm_from_env()
    spec, _ = generate_word_spec(prompt, llm)
    data = render_word_bytes(spec); validate_docx_bytes(data)
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": 'attachment; filename="generated.docx"'})
