from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, Tuple, Type

from pydantic import BaseModel

from .schemas import ExcelSpec, DocSpec


class LLMClient(ABC):
    """Abstracción del proveedor LLM (OpenAI/Anthropic/local).

    Debe devolver un dict JSON que cumpla el schema solicitado.
    """

    @abstractmethod
    def complete_json(self, *, system: str, user: str, json_schema: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


def _generate_with_repair(
    model: Type[BaseModel],
    *,
    llm: LLMClient,
    system: str,
    user: str,
    max_attempts: int = 3,
) -> BaseModel:
    schema = model.model_json_schema()

    last_err: Optional[str] = None
    current_user = user

    for attempt in range(1, max_attempts + 1):
        payload = llm.complete_json(system=system, user=current_user, json_schema=schema)

        try:
            return model.model_validate(payload)
        except Exception as e:
            last_err = str(e)
            # feed back the validation error to repair
            current_user = (
                user
                + "\n\n"
                + "IMPORTANTE: El JSON anterior NO pasó validación.\n"
                + f"Error de validación: {last_err}\n"
                + "Devuelve SOLO un JSON corregido que cumpla el schema.\n"
            )

    raise ValueError(f"LLM could not produce a valid {model.__name__} after {max_attempts} attempts. Last error: {last_err}")


def generate_excel_spec(prompt: str, *, llm: LLMClient) -> ExcelSpec:
    system = (
        "Eres un agente que diseña un Excel profesional. "
        "Devuelve SOLO JSON válido que cumpla el schema. "
        "Evita celdas combinadas salvo necesidad. "
        "Incluye formatos numéricos correctos y congela encabezados."
    )
    user = (
        "Necesito un Excel (.xlsx) siguiendo estas instrucciones:\n"
        f"{prompt}\n\n"
        "Devuelve un ExcelSpec."
    )
    return _generate_with_repair(ExcelSpec, llm=llm, system=system, user=user)


def generate_doc_spec(prompt: str, *, llm: LLMClient) -> DocSpec:
    system = (
        "Eres un agente que diseña un documento Word profesional. "
        "Devuelve SOLO JSON válido que cumpla el schema. "
        "Usa headings jerárquicos, tablas cuando aplique y listas."
    )
    user = (
        "Necesito un documento Word (.docx) siguiendo estas instrucciones:\n"
        f"{prompt}\n\n"
        "Devuelve un DocSpec."
    )
    return _generate_with_repair(DocSpec, llm=llm, system=system, user=user)


# ---------
# Demo stub
# ---------
class DummyLLM(LLMClient):
    """LLM de mentira para pruebas (POC). Sustituye en producción."""

    def complete_json(self, *, system: str, user: str, json_schema: Dict[str, Any]) -> Dict[str, Any]:
        # Very small deterministic example that matches the schemas.
        if "ExcelSpec" in json.dumps(json_schema):
            return {
                "workbook_title": "Demo",
                "sheets": [
                    {
                        "name": "Resumen",
                        "tables": [
                            {
                                "anchor": "A1",
                                "headers": ["Mes", "Ingresos", "Crecimiento"],
                                "rows": [
                                    ["2025-01-01", 120000, 0.12],
                                    ["2025-02-01", 135000, 0.125],
                                ],
                                "column_formats": {"Ingresos": "$#,##0", "Crecimiento": "0.0%"},
                                "table_style": "TableStyleMedium9",
                                "autofilter": True,
                                "freeze_header": True,
                            }
                        ],
                        "charts": [
                            {
                                "type": "line",
                                "title": "Ingresos",
                                "categories_range": "A2:A3",
                                "values_range": "B2:B3",
                                "position": "E2",
                            }
                        ],
                        "layout": {"auto_fit_columns": True, "show_gridlines": True},
                    }
                ],
            }
        else:
            return {
                "title": "Demo",
                "author": "docsheets-agent",
                "add_toc": False,
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Resumen"},
                    {"type": "paragraph", "text": "Documento generado desde un spec JSON."},
                    {"type": "bullets", "items": ["Punto 1", "Punto 2"]},
                    {
                        "type": "table",
                        "columns": ["Producto", "Precio"],
                        "rows": [["A", 10], ["B", 20]],
                        "style": "Light Shading",
                    },
                ],
            }
