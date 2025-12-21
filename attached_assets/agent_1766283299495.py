from __future__ import annotations
from typing import Dict, List, Tuple
from pydantic import ValidationError as PydanticValidationError
from ..llm.base import LLMClient
from ..schemas.excel import ExcelSpec
from ..schemas.word import DocSpec
from ..quality.rules_excel import run_quality_gates_excel
from ..quality.rules_word import run_quality_gates_word
from ..errors import SchemaValidationError, QualityGateError
from .prompts import EXCEL_SYSTEM, WORD_SYSTEM
from .repair import repair_json

def generate_excel_spec(prompt: str, llm: LLMClient, *, max_attempts: int = 3) -> Tuple[ExcelSpec, dict]:
    raw = _first(llm, EXCEL_SYSTEM, prompt)
    spec = _validate_excel(prompt, llm, raw, max_attempts)
    q = run_quality_gates_excel(spec)
    if q.errors: raise QualityGateError(str(q.to_dict()))
    return spec, q.to_dict()

def generate_word_spec(prompt: str, llm: LLMClient, *, max_attempts: int = 3) -> Tuple[DocSpec, dict]:
    raw = _first(llm, WORD_SYSTEM, prompt)
    spec = _validate_word(prompt, llm, raw, max_attempts)
    q = run_quality_gates_word(spec)
    if q.errors: raise QualityGateError(str(q.to_dict()))
    return spec, q.to_dict()

def _first(llm: LLMClient, system: str, prompt: str) -> str:
    return llm.chat([{"role":"system","content":system},{"role":"user","content":prompt}], temperature=0.0)

def _validate_excel(prompt: str, llm: LLMClient, raw: str, max_attempts: int) -> ExcelSpec:
    cur = raw; last = None
    for _ in range(max_attempts):
        try: return ExcelSpec.model_validate_json(cur)
        except PydanticValidationError as e:
            last = str(e)
            cur = repair_json(llm, bad_json=cur, validation_error=last, target="excel", user_prompt=prompt)
    raise SchemaValidationError(f"ExcelSpec invalid after {max_attempts}: {last}")

def _validate_word(prompt: str, llm: LLMClient, raw: str, max_attempts: int) -> DocSpec:
    cur = raw; last = None
    for _ in range(max_attempts):
        try: return DocSpec.model_validate_json(cur)
        except PydanticValidationError as e:
            last = str(e)
            cur = repair_json(llm, bad_json=cur, validation_error=last, target="word", user_prompt=prompt)
    raise SchemaValidationError(f"DocSpec invalid after {max_attempts}: {last}")
