"""Image generation tools for OpenAI DALL-E."""

from typing import Optional, Literal
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import os
import aiohttp

class ImageGenInput(ToolInput):
    """Input for image generation tool."""
    prompt: str = Field(..., description="Prompt to generate the image")
    size: Literal["256x256", "512x512", "1024x1024"] = Field("1024x1024", description="Image resolution")
    model: Literal["dall-e-2", "dall-e-3"] = Field("dall-e-3", description="Model to use")
    n: int = Field(1, description="Number of images to generate (must be 1 for dall-e-3)")
    api_key: Optional[str] = Field(None, description="OpenAI API key. If not provided, uses environment variable.")

class ImageGenOutput(ToolOutput):
    """Output from image generation tool."""
    pass

@ToolRegistry.register
class ImageGenTool(BaseTool[ImageGenInput, ImageGenOutput]):
    """Tool for generating images using OpenAI's DALL-E models."""
    
    name = "openai-image-gen"
    description = "Generates images from text prompts using OpenAI DALL-E."
    category = ToolCategory.GENERATION
    priority = Priority.MEDIUM
    
    async def execute(self, input: ImageGenInput) -> ImageGenOutput:
        api_key = input.api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return ImageGenOutput(success=False, error="OpenAI API key is missing.")
            
        url = "https://api.openai.com/v1/images/generations"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "prompt": input.prompt,
            "n": input.n if input.model != "dall-e-3" else 1,
            "size": input.size,
            "model": input.model
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload) as response:
                    data = await response.json()
                    
                    if response.status != 200:
                        error_msg = data.get("error", {}).get("message", "Unknown API error")
                        return ImageGenOutput(success=False, error=f"OpenAI API Error: {error_msg}")
                        
                    images = [item["url"] for item in data.get("data", [])]
                    return ImageGenOutput(
                        success=True,
                        data={"image_urls": images}
                    )
        except Exception as e:
            self.logger.error("image_gen_error", error=str(e))
            return ImageGenOutput(success=False, error=str(e))
