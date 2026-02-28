"""
Application settings and configuration.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os


class Settings(BaseSettings):
    # AI Provider
    ai_provider: str = Field(default="anthropic", description="AI provider: anthropic or openai")

    # API Keys
    anthropic_api_key: Optional[str] = Field(default=None)
    openai_api_key: Optional[str] = Field(default=None)

    # Models
    anthropic_model: str = Field(default="claude-sonnet-4-5-20250929")
    openai_model: str = Field(default="gpt-4o")

    # Server
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8000)

    # Security
    max_file_size_mb: int = Field(default=50)
    allowed_extensions: str = Field(default="*")

    # Workspace
    workspace_path: Optional[str] = Field(default=None)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


def get_settings() -> Settings:
    return Settings()
