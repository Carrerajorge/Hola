from __future__ import annotations


class OcrError(Exception):
    """Base class for all OCR-domain errors."""


class UnsupportedFileTypeError(OcrError):
    pass


class FileTooLargeError(OcrError):
    pass


class TooManyPagesError(OcrError):
    pass


class EngineUnavailableError(OcrError):
    pass


class OcrFailedError(OcrError):
    pass

