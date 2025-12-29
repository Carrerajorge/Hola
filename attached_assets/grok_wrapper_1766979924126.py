"""
xAI Grok Wrapper para Producción
=================================
Clase lista para integrar en tu software con todas las funcionalidades.
"""

import os
import json
import time
import logging
from typing import Optional, List, Dict, Any, Generator, Union
from dataclasses import dataclass
from enum import Enum

try:
    from openai import OpenAI
except ImportError:
    raise ImportError("Instala openai: pip install openai")

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GrokModels:
    """Constantes de modelos disponibles"""
    # Rápidos y económicos
    MINI = "grok-3-mini"
    FAST = "grok-4-fast-non-reasoning"
    FAST_REASONING = "grok-4-fast-reasoning"
    
    # Especializados
    CODE = "grok-code-fast-1"
    VISION = "grok-2-vision-1212"
    
    # Premium
    PREMIUM = "grok-4-0709"
    STANDARD = "grok-3"
    
    # Nuevos modelos 4.1
    V4_1_FAST = "grok-4-1-fast-non-reasoning"
    V4_1_REASONING = "grok-4-1-fast-reasoning"


@dataclass
class GrokResponse:
    """Respuesta estructurada de Grok"""
    content: str
    model: str
    finish_reason: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    raw_response: Optional[Dict] = None
    
    @property
    def cost(self) -> float:
        """Calcula el costo aproximado"""
        # Precios aproximados por millón de tokens
        prices = {
            "grok-3-mini": (0.30, 0.50),
            "grok-3": (3.00, 15.00),
            "grok-4-0709": (3.00, 15.00),
            "grok-code-fast-1": (0.20, 1.50),
            "grok-2-vision-1212": (2.00, 10.00),
        }
        default = (0.20, 0.50)  # Para modelos fast
        
        input_price, output_price = prices.get(self.model, default)
        return (self.input_tokens * input_price + self.output_tokens * output_price) / 1_000_000


class GrokAI:
    """
    Cliente principal de xAI Grok para producción.
    
    Ejemplo:
        grok = GrokAI()
        response = grok.chat("Hola, ¿cómo estás?")
        print(response.content)
    """
    
    BASE_URL = "https://api.x.ai/v1"
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: str = GrokModels.MINI,
        max_retries: int = 3,
        timeout: int = 300
    ):
        """
        Inicializa el cliente Grok.
        
        Args:
            api_key: API key de xAI. Si no se proporciona, usa XAI_API_KEY
            default_model: Modelo por defecto para las requests
            max_retries: Número máximo de reintentos
            timeout: Timeout en segundos
        """
        self.api_key = api_key or os.getenv("XAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key requerida. Configura XAI_API_KEY o pasa api_key"
            )
        
        self.default_model = default_model
        self.max_retries = max_retries
        self.timeout = timeout
        
        self._client = OpenAI(
            api_key=self.api_key,
            base_url=self.BASE_URL,
            timeout=timeout
        )
        
        logger.info(f"GrokAI inicializado con modelo: {default_model}")
    
    def chat(
        self,
        message: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> GrokResponse:
        """
        Envía un mensaje simple y obtiene respuesta.
        
        Args:
            message: Mensaje del usuario
            system: Prompt de sistema opcional
            model: Modelo a usar
            temperature: Creatividad (0.0 - 2.0)
            max_tokens: Máximo de tokens en respuesta
            
        Returns:
            GrokResponse con la respuesta
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": message})
        
        return self.complete(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs
        )
    
    def complete(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        **kwargs
    ) -> GrokResponse:
        """
        Genera una respuesta de chat completa.
        
        Args:
            messages: Lista de mensajes en formato OpenAI
            model: Modelo a usar
            temperature: Creatividad
            max_tokens: Máximo de tokens
            
        Returns:
            GrokResponse
        """
        model = model or self.default_model
        
        for attempt in range(self.max_retries):
            try:
                response = self._client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs
                )
                
                return GrokResponse(
                    content=response.choices[0].message.content or "",
                    model=response.model,
                    finish_reason=response.choices[0].finish_reason or "unknown",
                    input_tokens=response.usage.prompt_tokens if response.usage else 0,
                    output_tokens=response.usage.completion_tokens if response.usage else 0,
                    total_tokens=response.usage.total_tokens if response.usage else 0,
                    raw_response=response.model_dump() if hasattr(response, 'model_dump') else None
                )
                
            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "rate" in error_str:
                    wait_time = (2 ** attempt) + 0.5
                    logger.warning(f"Rate limit. Esperando {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    raise
        
        raise Exception(f"Máximo de reintentos ({self.max_retries}) alcanzado")
    
    def stream(
        self,
        message: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs
    ) -> Generator[str, None, None]:
        """
        Genera respuesta en streaming.
        
        Args:
            message: Mensaje del usuario
            system: Prompt de sistema
            model: Modelo a usar
            
        Yields:
            Fragmentos de texto
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": message})
        
        model = model or self.default_model
        
        response = self._client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            **kwargs
        )
        
        for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    def code(
        self,
        prompt: str,
        language: str = "python",
        model: str = GrokModels.CODE,
        **kwargs
    ) -> GrokResponse:
        """
        Genera código.
        
        Args:
            prompt: Descripción del código
            language: Lenguaje de programación
            model: Modelo a usar
            
        Returns:
            GrokResponse con código
        """
        system = f"""Eres un experto programador en {language}.
Genera código limpio, eficiente y bien documentado.
Solo responde con código, sin explicaciones adicionales a menos que se pidan."""
        
        return self.chat(
            message=prompt,
            system=system,
            model=model,
            temperature=0.3,
            **kwargs
        )
    
    def vision(
        self,
        prompt: str,
        image_url: Optional[str] = None,
        image_base64: Optional[str] = None,
        model: str = GrokModels.VISION,
        **kwargs
    ) -> GrokResponse:
        """
        Analiza una imagen.
        
        Args:
            prompt: Pregunta sobre la imagen
            image_url: URL de la imagen
            image_base64: Imagen codificada en base64
            model: Modelo de visión
            
        Returns:
            GrokResponse con análisis
        """
        content = [{"type": "text", "text": prompt}]
        
        if image_url:
            content.append({
                "type": "image_url",
                "image_url": {"url": image_url}
            })
        elif image_base64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
            })
        else:
            raise ValueError("Proporciona image_url o image_base64")
        
        messages = [{"role": "user", "content": content}]
        return self.complete(messages=messages, model=model, **kwargs)
    
    def reason(
        self,
        problem: str,
        model: str = GrokModels.FAST_REASONING,
        **kwargs
    ) -> GrokResponse:
        """
        Resuelve problemas con razonamiento paso a paso.
        
        Args:
            problem: Problema a resolver
            model: Modelo de razonamiento
            
        Returns:
            GrokResponse con razonamiento
        """
        system = """Eres un experto en resolución de problemas.
Piensa paso a paso y muestra tu razonamiento antes de dar la respuesta final.
Estructura tu respuesta así:
1. Análisis del problema
2. Pasos de solución
3. Respuesta final"""
        
        return self.chat(
            message=problem,
            system=system,
            model=model,
            **kwargs
        )
    
    def json(
        self,
        prompt: str,
        schema: Dict[str, Any],
        model: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Obtiene respuesta estructurada en JSON.
        
        Args:
            prompt: Prompt para generar JSON
            schema: Esquema JSON esperado
            model: Modelo a usar
            
        Returns:
            Diccionario con la respuesta
        """
        model = model or self.default_model
        
        response = self._client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "response",
                    "schema": schema,
                    "strict": True
                }
            },
            **kwargs
        )
        
        return json.loads(response.choices[0].message.content)
    
    def batch(
        self,
        prompts: List[str],
        model: Optional[str] = None,
        delay: float = 0.1,
        **kwargs
    ) -> List[GrokResponse]:
        """
        Procesa múltiples prompts en lote.
        
        Args:
            prompts: Lista de prompts
            model: Modelo a usar
            delay: Delay entre requests
            
        Returns:
            Lista de GrokResponse
        """
        results = []
        total = len(prompts)
        
        for i, prompt in enumerate(prompts, 1):
            logger.info(f"Procesando {i}/{total}...")
            result = self.chat(prompt, model=model, **kwargs)
            results.append(result)
            
            if i < total:
                time.sleep(delay)
        
        return results


class GrokConversation:
    """
    Maneja conversaciones con historial.
    
    Ejemplo:
        conv = GrokConversation(system="Eres un chef experto")
        print(conv.send("¿Cómo hago pasta?"))
        print(conv.send("¿Y la salsa?"))
    """
    
    def __init__(
        self,
        client: Optional[GrokAI] = None,
        system: Optional[str] = None,
        model: str = GrokModels.MINI
    ):
        self.client = client or GrokAI()
        self.model = model
        self.messages: List[Dict[str, str]] = []
        
        if system:
            self.messages.append({"role": "system", "content": system})
    
    def send(self, message: str, **kwargs) -> str:
        """Envía un mensaje y obtiene respuesta"""
        self.messages.append({"role": "user", "content": message})
        
        response = self.client.complete(
            messages=self.messages,
            model=self.model,
            **kwargs
        )
        
        self.messages.append({
            "role": "assistant",
            "content": response.content
        })
        
        return response.content
    
    def stream_send(self, message: str, **kwargs) -> Generator[str, None, None]:
        """Envía mensaje y obtiene respuesta en streaming"""
        self.messages.append({"role": "user", "content": message})
        
        full_response = ""
        for chunk in self.client._client.chat.completions.create(
            model=self.model,
            messages=self.messages,
            stream=True,
            **kwargs
        ):
            if chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                full_response += text
                yield text
        
        self.messages.append({
            "role": "assistant",
            "content": full_response
        })
    
    def clear(self):
        """Limpia el historial manteniendo el system prompt"""
        system = [m for m in self.messages if m["role"] == "system"]
        self.messages = system
    
    @property
    def history(self) -> List[Dict[str, str]]:
        """Retorna el historial de mensajes"""
        return self.messages.copy()


# ============================================================
# FUNCIONES DE UTILIDAD
# ============================================================

def quick_chat(message: str, model: str = GrokModels.MINI) -> str:
    """Función rápida para chat simple"""
    grok = GrokAI()
    return grok.chat(message, model=model).content


def quick_code(prompt: str) -> str:
    """Función rápida para generar código"""
    grok = GrokAI()
    return grok.code(prompt).content


def quick_vision(prompt: str, image_url: str) -> str:
    """Función rápida para análisis de imagen"""
    grok = GrokAI()
    return grok.vision(prompt, image_url=image_url).content


# ============================================================
# EJEMPLO DE USO
# ============================================================

if __name__ == "__main__":
    print("="*60)
    print("🚀 GrokAI - Cliente de Producción")
    print("="*60)
    
    if not os.getenv("XAI_API_KEY"):
        print("\n❌ Configura XAI_API_KEY para ejecutar ejemplos")
        print("\nEjemplo de uso:")
        print("""
from grok_wrapper import GrokAI, GrokModels, GrokConversation

# Chat simple
grok = GrokAI()
response = grok.chat("Hola, ¿cómo estás?")
print(response.content)

# Generar código
code = grok.code("Función para calcular fibonacci")
print(code.content)

# Conversación
conv = GrokConversation(system="Eres un profesor de matemáticas")
print(conv.send("¿Qué es una integral?"))
print(conv.send("Dame un ejemplo"))

# Streaming
for chunk in grok.stream("Cuenta una historia corta"):
    print(chunk, end="")
        """)
        exit(0)
    
    # Ejecutar ejemplo
    grok = GrokAI()
    
    print("\n📝 Chat simple:")
    response = grok.chat("¿Cuál es la velocidad de la luz?")
    print(f"   {response.content[:200]}...")
    print(f"   Tokens: {response.total_tokens}, Costo: ${response.cost:.6f}")
    
    print("\n💻 Generación de código:")
    code = grok.code("Función que verifica si un número es primo")
    print(f"   {code.content[:300]}...")
    
    print("\n🌊 Streaming:")
    print("   ", end="")
    for chunk in grok.stream("Cuenta hasta 5 con emojis"):
        print(chunk, end="", flush=True)
    print()
    
    print("\n✅ ¡Cliente listo para usar!")
