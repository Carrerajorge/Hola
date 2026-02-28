"""
AI Provider abstraction layer.
Supports Anthropic (Claude) and OpenAI (GPT-4) as backends.
"""
import json
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, AsyncGenerator
from config.settings import get_settings


# ─── Tool Definitions ────────────────────────────────────
AGENT_TOOLS = [
    {
        "name": "list_files",
        "description": "List files and directories in a given path within the workspace. Use '.' for the root workspace directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path within workspace (use '.' for root)"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file. Returns the text content.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the file within workspace"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path for the file within workspace"
                },
                "content": {
                    "type": "string",
                    "description": "Content to write to the file"
                }
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "create_directory",
        "description": "Create a new directory (and any parent directories).",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path for the new directory"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "move_file",
        "description": "Move or rename a file or directory from one location to another.",
        "parameters": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "description": "Current relative path"
                },
                "destination": {
                    "type": "string",
                    "description": "New relative path"
                }
            },
            "required": ["source", "destination"]
        }
    },
    {
        "name": "copy_file",
        "description": "Copy a file or directory to a new location.",
        "parameters": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "description": "Source relative path"
                },
                "destination": {
                    "type": "string",
                    "description": "Destination relative path"
                }
            },
            "required": ["source", "destination"]
        }
    },
    {
        "name": "delete_file",
        "description": "Delete a file or directory. USE WITH CAUTION - this is permanent!",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to delete"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "search_files",
        "description": "Search for files by name pattern.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "File name pattern to search for"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in (default: root)",
                    "default": "."
                }
            },
            "required": ["pattern"]
        }
    },
    {
        "name": "search_content",
        "description": "Search within file contents for a text query.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Text to search for in file contents"
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in (default: root)",
                    "default": "."
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "organize_files",
        "description": "Automatically organize files in a directory into categorized folders.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory to organize (default: root)",
                    "default": "."
                },
                "method": {
                    "type": "string",
                    "description": "Organization method: 'extension' (by file type) or 'date' (by modification date)",
                    "enum": ["extension", "date"],
                    "default": "extension"
                }
            },
            "required": []
        }
    },
    {
        "name": "workspace_info",
        "description": "Get an overview of the workspace: total files, directories, size, and file type distribution.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": []
        }
    }
]

SYSTEM_PROMPT = """You are Cowork AI, an intelligent file management assistant. You help users manage, organize, and work with files on their computer.

You have access to a workspace folder and can perform various file operations. You are thorough, careful, and always explain what you're doing.

Key behaviors:
1. ALWAYS create a plan before executing multi-step tasks
2. Show progress as you work through tasks
3. Ask for confirmation before destructive operations (delete, overwrite)
4. Explain what you're doing and why
5. Handle errors gracefully and suggest alternatives
6. Be proactive - suggest improvements and better organization

When the user asks you to do something:
1. Analyze the request
2. Create a step-by-step plan
3. Execute each step, reporting progress
4. Summarize what was accomplished

You can read, write, create, move, copy, delete, search, and organize files. Use the tools available to you."""


class AIProvider(ABC):
    """Abstract base for AI providers."""

    @abstractmethod
    async def chat(self, messages: List[Dict], tools: List[Dict] = None) -> Dict:
        pass

    @abstractmethod
    async def stream_chat(self, messages: List[Dict], tools: List[Dict] = None) -> AsyncGenerator:
        pass


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider."""

    def __init__(self):
        import anthropic
        settings = get_settings()
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model

    def _convert_tools(self, tools: List[Dict]) -> List[Dict]:
        """Convert tools to Anthropic format."""
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"]
            }
            for t in tools
        ]

    async def chat(self, messages: List[Dict], tools: List[Dict] = None) -> Dict:
        kwargs = {
            "model": self.model,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        response = await self.client.messages.create(**kwargs)

        result = {"content": "", "tool_calls": []}
        for block in response.content:
            if block.type == "text":
                result["content"] += block.text
            elif block.type == "tool_use":
                result["tool_calls"].append({
                    "id": block.id,
                    "name": block.name,
                    "arguments": block.input
                })
        result["stop_reason"] = response.stop_reason
        return result

    async def stream_chat(self, messages: List[Dict], tools: List[Dict] = None) -> AsyncGenerator:
        kwargs = {
            "model": self.model,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        async with self.client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield {"type": "text", "content": text}


class OpenAIProvider(AIProvider):
    """OpenAI GPT provider."""

    def __init__(self):
        from openai import AsyncOpenAI
        settings = get_settings()
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    def _convert_tools(self, tools: List[Dict]) -> List[Dict]:
        """Convert tools to OpenAI format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"]
                }
            }
            for t in tools
        ]

    async def chat(self, messages: List[Dict], tools: List[Dict] = None) -> Dict:
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
        kwargs = {
            "model": self.model,
            "messages": msgs,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        response = await self.client.chat.completions.create(**kwargs)
        choice = response.choices[0]

        result = {"content": choice.message.content or "", "tool_calls": []}
        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                result["tool_calls"].append({
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": json.loads(tc.function.arguments)
                })
        result["stop_reason"] = choice.finish_reason
        return result

    async def stream_chat(self, messages: List[Dict], tools: List[Dict] = None) -> AsyncGenerator:
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=msgs,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield {"type": "text", "content": chunk.choices[0].delta.content}


def get_provider() -> AIProvider:
    """Factory function to get the configured AI provider."""
    settings = get_settings()
    if settings.ai_provider == "anthropic":
        return AnthropicProvider()
    elif settings.ai_provider == "openai":
        return OpenAIProvider()
    else:
        raise ValueError(f"Unknown AI provider: {settings.ai_provider}")
