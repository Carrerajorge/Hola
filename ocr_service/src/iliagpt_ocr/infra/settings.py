from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="OCR_",
        env_file=".env",
        extra="ignore",
    )

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000, ge=1, le=65535)

    # Engine selection
    prefer_engine: str = Field(default="auto")  # auto|paddle|tesseract
    default_lang: str = Field(default="eng")

    # Limits
    max_pages: int = Field(default=10, ge=1, le=100)
    max_file_size_mb: int = Field(default=15, ge=1, le=200)
    dpi: int = Field(default=300, ge=72, le=600)

    # Preprocessing toggles
    enable_deskew: bool = Field(default=True)
    enable_denoise: bool = Field(default=True)
    enable_region_detect: bool = Field(default=True)

    # Tesseract
    tesseract_oem: int = Field(default=1)  # 1 = LSTM only
    tesseract_psm: int = Field(default=3)  # automatic page segmentation

    # Paddle
    paddle_use_angle_cls: bool = Field(default=True)


def get_settings() -> Settings:
    # Kept as a function to make it easy to override in tests.
    return Settings()

