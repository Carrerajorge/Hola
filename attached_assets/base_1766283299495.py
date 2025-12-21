from __future__ import annotations
from abc import ABC, abstractmethod
from typing import List, Dict

class LLMClient(ABC):
    @abstractmethod
    def chat(self, messages: List[Dict[str,str]], *, temperature: float = 0.0) -> str:
        raise NotImplementedError
