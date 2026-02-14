from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ResolvedLanguage:
    requested: str
    tesseract: str
    paddle: str


def _norm(lang: str | None) -> str:
    return (lang or "").strip().lower()


def resolve_language(lang: str | None) -> ResolvedLanguage:
    """
    Best-effort mapping to keep a stable API while satisfying engine-specific language codes.

    - Tesseract typically uses ISO 639-2/3 codes (e.g. eng, spa) and supports multi-lang `eng+spa`.
    - PaddleOCR uses its own language identifiers (e.g. en, french, german, latin, ch, japan, korean).
    """

    requested = _norm(lang) or "eng"

    # Split multi-language requests (Tesseract style: eng+spa).
    parts = [p for p in requested.split("+") if p]
    if not parts:
        parts = ["eng"]

    def map_part(p: str) -> tuple[str, str]:
        p = _norm(p)
        # English
        if p in ("eng", "en"):
            return ("eng", "en")
        # Spanish
        if p in ("spa", "es"):
            return ("spa", "latin")
        # French
        if p in ("fra", "fre", "fr"):
            return ("fra", "french")
        # German
        if p in ("deu", "ger", "de"):
            return ("deu", "german")
        # Portuguese
        if p in ("por", "pt"):
            return ("por", "latin")
        # Italian
        if p in ("ita", "it"):
            return ("ita", "latin")
        # Default: pass through
        return (p, p)

    mapped = [map_part(p) for p in parts]

    # Tesseract: preserve multi-language expression if present.
    tess = "+".join([t for (t, _) in mapped])

    # PaddleOCR: it does not support Tesseract-style multi-lang; choose a best-effort script.
    paddle_candidates = [p for (_, p) in mapped]
    paddle = paddle_candidates[0]
    if len(paddle_candidates) > 1:
        # If any non-English latin-like language is requested, default to latin script model.
        if any(p in ("latin", "french", "german") for p in paddle_candidates):
            paddle = "latin"
        # If English is the only/first, keep "en".
        elif "en" in paddle_candidates:
            paddle = "en"

    return ResolvedLanguage(requested=requested, tesseract=tess, paddle=paddle)

