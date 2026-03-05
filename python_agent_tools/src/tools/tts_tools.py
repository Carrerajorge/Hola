"""Text to speech tools using ElevenLabs API."""

from typing import Optional
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import os
import aiohttp
import base64

class TTSInput(ToolInput):
    """Input for ElevenLabs TTS tool."""
    text: str = Field(..., description="Text to convert to speech")
    voice_id: str = Field("21m00Tcm4TlvDq8ikWAM", description="ElevenLabs Voice ID (default is Rachel)")
    model_id: str = Field("eleven_multilingual_v2", description="Model to use")
    api_key: Optional[str] = Field(None, description="ElevenLabs API key. If not provided, uses environment variable.")

class TTSOutput(ToolOutput):
    """Output from TTS tool."""
    pass

@ToolRegistry.register
class TTSTool(BaseTool[TTSInput, TTSOutput]):
    """Tool for converting text to speech using ElevenLabs."""
    
    name = "sag"
    description = "Generates high-quality speech audio from text using ElevenLabs API."
    category = ToolCategory.GENERATION
    priority = Priority.MEDIUM
    
    async def execute(self, input: TTSInput) -> TTSOutput:
        api_key = input.api_key or os.environ.get("ELEVENLABS_API_KEY")
        if not api_key:
            return TTSOutput(success=False, error="ElevenLabs API key is missing.")
            
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{input.voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        }
        
        payload = {
            "text": input.text,
            "model_id": input.model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload) as response:
                    if response.status != 200:
                        try:
                            error_data = await response.json()
                            error_msg = error_data.get("detail", {}).get("message", "Unknown API error")
                        except:
                            error_msg = await response.text()
                        return TTSOutput(success=False, error=f"ElevenLabs API Error: {error_msg}")
                        
                    audio_bytes = await response.read()
                    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
                    
                    return TTSOutput(
                        success=True,
                        data={
                            "audio_base64": audio_b64,
                            "format": "mp3",
                            "size_bytes": len(audio_bytes)
                        }
                    )
        except Exception as e:
            self.logger.error("tts_tool_error", error=str(e))
            return TTSOutput(success=False, error=str(e))
