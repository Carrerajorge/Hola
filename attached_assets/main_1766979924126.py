"""
xAI Grok API Integration para Replit
=====================================
Este módulo proporciona integración completa con todos los modelos de xAI Grok.

Modelos soportados:
- grok-4-1-fast-reasoning
- grok-4-1-fast-non-reasoning  
- grok-code-fast-1
- grok-4-fast-reasoning
- grok-4-fast-non-reasoning
- grok-4-0709
- grok-3-mini
- grok-3
- grok-2-vision-1212

Autor: Claude AI
Versión: 1.0.0
"""

import os
import json
import time
import base64
import random
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Generator
from enum import Enum


# ============================================================================
# CONFIGURACIÓN DE MODELOS
# ============================================================================

class GrokModel(Enum):
    """Todos los modelos de xAI Grok disponibles"""
    
    # Modelos de razonamiento rápido
    GROK_4_1_FAST_REASONING = "grok-4-1-fast-reasoning"
    GROK_4_1_FAST_NON_REASONING = "grok-4-1-fast-non-reasoning"
    GROK_4_FAST_REASONING = "grok-4-fast-reasoning"
    GROK_4_FAST_NON_REASONING = "grok-4-fast-non-reasoning"
    
    # Modelo de código
    GROK_CODE_FAST_1 = "grok-code-fast-1"
    
    # Modelo premium
    GROK_4_0709 = "grok-4-0709"
    
    # Modelos Grok 3
    GROK_3_MINI = "grok-3-mini"
    GROK_3 = "grok-3"
    
    # Modelo con visión
    GROK_2_VISION_1212 = "grok-2-vision-1212"


@dataclass
class ModelInfo:
    """Información de cada modelo"""
    name: str
    context_window: int
    input_price: float  # por millón de tokens
    output_price: float  # por millón de tokens
    supports_vision: bool = False
    supports_reasoning: bool = False
    rpm_limit: int = 480  # requests per minute


# Información detallada de cada modelo
MODEL_CONFIGS: Dict[str, ModelInfo] = {
    "grok-4-1-fast-reasoning": ModelInfo(
        name="Grok 4.1 Fast Reasoning",
        context_window=2_000_000,
        input_price=0.20,
        output_price=0.50,
        supports_reasoning=True
    ),
    "grok-4-1-fast-non-reasoning": ModelInfo(
        name="Grok 4.1 Fast Non-Reasoning",
        context_window=2_000_000,
        input_price=0.20,
        output_price=0.50
    ),
    "grok-code-fast-1": ModelInfo(
        name="Grok Code Fast 1",
        context_window=256_000,
        input_price=0.20,
        output_price=1.50
    ),
    "grok-4-fast-reasoning": ModelInfo(
        name="Grok 4 Fast Reasoning",
        context_window=2_000_000,
        input_price=0.20,
        output_price=0.50,
        supports_reasoning=True
    ),
    "grok-4-fast-non-reasoning": ModelInfo(
        name="Grok 4 Fast Non-Reasoning",
        context_window=2_000_000,
        input_price=0.20,
        output_price=0.50
    ),
    "grok-4-0709": ModelInfo(
        name="Grok 4 (Premium)",
        context_window=256_000,
        input_price=3.00,
        output_price=15.00
    ),
    "grok-3-mini": ModelInfo(
        name="Grok 3 Mini",
        context_window=131_072,
        input_price=0.30,
        output_price=0.50
    ),
    "grok-3": ModelInfo(
        name="Grok 3",
        context_window=131_072,
        input_price=3.00,
        output_price=15.00,
        rpm_limit=600
    ),
    "grok-2-vision-1212": ModelInfo(
        name="Grok 2 Vision",
        context_window=131_072,
        input_price=2.00,
        output_price=10.00,
        supports_vision=True
    ),
}


# ============================================================================
# CLIENTE XAI USANDO OPENAI SDK (Compatibilidad)
# ============================================================================

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False


class XAIClient:
    """Cliente principal para interactuar con la API de xAI"""
    
    BASE_URL = "https://api.x.ai/v1"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Inicializa el cliente xAI.
        
        Args:
            api_key: La API key de xAI. Si no se proporciona, 
                    se busca en la variable de entorno XAI_API_KEY
        """
        self.api_key = api_key or os.getenv("XAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "API key no encontrada. Proporciona una API key o "
                "configura la variable de entorno XAI_API_KEY"
            )
        
        if OPENAI_AVAILABLE:
            self.client = OpenAI(
                api_key=self.api_key,
                base_url=self.BASE_URL
            )
        else:
            self.client = None
            print("⚠️ OpenAI SDK no disponible. Usando requests HTTP directamente.")
    
    def get_model_info(self, model: str) -> ModelInfo:
        """Obtiene información de un modelo específico"""
        if model not in MODEL_CONFIGS:
            raise ValueError(f"Modelo '{model}' no reconocido. Modelos disponibles: {list(MODEL_CONFIGS.keys())}")
        return MODEL_CONFIGS[model]
    
    def list_models(self) -> List[str]:
        """Lista todos los modelos disponibles"""
        return [m.value for m in GrokModel]
    
    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: str = "grok-3-mini",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stream: bool = False,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Genera una respuesta de chat.
        
        Args:
            messages: Lista de mensajes en formato OpenAI
            model: Modelo a usar (default: grok-3-mini)
            temperature: Creatividad de la respuesta (0.0 - 2.0)
            max_tokens: Máximo de tokens en la respuesta
            stream: Si es True, retorna un generador para streaming
            **kwargs: Parámetros adicionales
            
        Returns:
            Respuesta del modelo
        """
        if OPENAI_AVAILABLE and self.client:
            response = self.client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=stream,
                **kwargs
            )
            
            if stream:
                return self._stream_response(response)
            
            return {
                "id": response.id,
                "model": response.model,
                "content": response.choices[0].message.content,
                "role": response.choices[0].message.role,
                "finish_reason": response.choices[0].finish_reason,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                } if response.usage else None
            }
        else:
            return self._http_chat_completion(messages, model, temperature, max_tokens, **kwargs)
    
    def _stream_response(self, response) -> Generator[str, None, None]:
        """Genera respuestas en streaming"""
        for chunk in response:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    
    def _http_chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        temperature: float,
        max_tokens: int,
        **kwargs
    ) -> Dict[str, Any]:
        """Fallback usando requests HTTP"""
        import requests
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            **kwargs
        }
        
        response = requests.post(
            f"{self.BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=300
        )
        
        response.raise_for_status()
        data = response.json()
        
        return {
            "id": data.get("id"),
            "model": data.get("model"),
            "content": data["choices"][0]["message"]["content"],
            "role": data["choices"][0]["message"]["role"],
            "finish_reason": data["choices"][0]["finish_reason"],
            "usage": data.get("usage")
        }
    
    def vision_completion(
        self,
        prompt: str,
        image_url: Optional[str] = None,
        image_base64: Optional[str] = None,
        model: str = "grok-2-vision-1212",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Genera una respuesta con análisis de imagen.
        
        Args:
            prompt: Texto del prompt
            image_url: URL de la imagen
            image_base64: Imagen en base64
            model: Modelo de visión a usar
            **kwargs: Parámetros adicionales
            
        Returns:
            Respuesta del modelo
        """
        model_info = self.get_model_info(model)
        if not model_info.supports_vision:
            raise ValueError(f"El modelo '{model}' no soporta visión. Usa 'grok-2-vision-1212'")
        
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
        
        messages = [{"role": "user", "content": content}]
        return self.chat_completion(messages, model=model, **kwargs)
    
    def code_completion(
        self,
        prompt: str,
        language: str = "python",
        model: str = "grok-code-fast-1",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Genera código usando el modelo optimizado para código.
        
        Args:
            prompt: Descripción del código a generar
            language: Lenguaje de programación
            model: Modelo a usar (default: grok-code-fast-1)
            **kwargs: Parámetros adicionales
            
        Returns:
            Respuesta con código generado
        """
        system_prompt = f"""Eres un experto programador en {language}. 
Genera código limpio, bien documentado y eficiente.
Siempre incluye comentarios explicativos."""
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
        
        return self.chat_completion(messages, model=model, **kwargs)
    
    def reasoning_completion(
        self,
        prompt: str,
        model: str = "grok-4-fast-reasoning",
        reasoning_effort: str = "medium",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Genera respuestas con razonamiento paso a paso.
        
        Args:
            prompt: Pregunta o problema
            model: Modelo de razonamiento a usar
            reasoning_effort: Nivel de esfuerzo (low, medium, high)
            **kwargs: Parámetros adicionales
            
        Returns:
            Respuesta con razonamiento
        """
        model_info = self.get_model_info(model)
        if not model_info.supports_reasoning:
            raise ValueError(f"El modelo '{model}' no soporta razonamiento explícito")
        
        system_prompt = """Eres un asistente que razona paso a paso.
Analiza el problema cuidadosamente antes de responder.
Muestra tu proceso de pensamiento."""
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
        
        return self.chat_completion(messages, model=model, **kwargs)


# ============================================================================
# CLIENTE AVANZADO CON RATE LIMITING Y RETRY
# ============================================================================

class XAIAdvancedClient(XAIClient):
    """Cliente avanzado con manejo de rate limiting y reintentos"""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        max_retries: int = 3,
        base_delay: float = 1.0
    ):
        super().__init__(api_key)
        self.max_retries = max_retries
        self.base_delay = base_delay
    
    def chat_completion_with_retry(
        self,
        messages: List[Dict[str, Any]],
        model: str = "grok-3-mini",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Chat completion con reintentos automáticos para rate limiting.
        """
        for attempt in range(self.max_retries):
            try:
                return self.chat_completion(messages, model=model, **kwargs)
            except Exception as e:
                error_str = str(e)
                if "429" in error_str or "rate" in error_str.lower():
                    delay = (self.base_delay * 2 ** attempt) + random.uniform(0, 0.5)
                    print(f"⏳ Rate limit alcanzado. Reintentando en {delay:.2f}s... (intento {attempt + 1}/{self.max_retries})")
                    time.sleep(delay)
                else:
                    raise
        
        raise Exception(f"Máximo de reintentos ({self.max_retries}) alcanzado")
    
    def batch_completion(
        self,
        prompts: List[str],
        model: str = "grok-3-mini",
        delay_between_requests: float = 0.1,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        Procesa múltiples prompts en lote.
        
        Args:
            prompts: Lista de prompts
            model: Modelo a usar
            delay_between_requests: Delay entre requests para evitar rate limiting
            **kwargs: Parámetros adicionales
            
        Returns:
            Lista de respuestas
        """
        results = []
        for i, prompt in enumerate(prompts):
            print(f"📝 Procesando {i + 1}/{len(prompts)}...")
            
            messages = [{"role": "user", "content": prompt}]
            result = self.chat_completion_with_retry(messages, model=model, **kwargs)
            results.append(result)
            
            if i < len(prompts) - 1:
                time.sleep(delay_between_requests)
        
        return results


# ============================================================================
# UTILIDADES
# ============================================================================

def encode_image_to_base64(image_path: str) -> str:
    """Convierte una imagen local a base64"""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def estimate_tokens(text: str) -> int:
    """Estima el número de tokens en un texto (aproximado)"""
    # Aproximación: ~4 caracteres por token
    return len(text) // 4


def calculate_cost(
    input_tokens: int,
    output_tokens: int,
    model: str
) -> float:
    """Calcula el costo estimado de una request"""
    if model not in MODEL_CONFIGS:
        return 0.0
    
    config = MODEL_CONFIGS[model]
    input_cost = (input_tokens / 1_000_000) * config.input_price
    output_cost = (output_tokens / 1_000_000) * config.output_price
    
    return input_cost + output_cost


# ============================================================================
# EJEMPLOS DE USO
# ============================================================================

def ejemplo_basico():
    """Ejemplo básico de uso"""
    print("\n" + "="*60)
    print("🚀 EJEMPLO BÁSICO")
    print("="*60)
    
    client = XAIClient()
    
    response = client.chat_completion(
        messages=[
            {"role": "system", "content": "Eres un asistente útil."},
            {"role": "user", "content": "Explica qué es Python en una oración."}
        ],
        model="grok-3-mini",
        temperature=0.7
    )
    
    print(f"\n📤 Respuesta: {response['content']}")
    if response.get('usage'):
        print(f"📊 Tokens usados: {response['usage']['total_tokens']}")


def ejemplo_codigo():
    """Ejemplo de generación de código"""
    print("\n" + "="*60)
    print("💻 EJEMPLO DE CÓDIGO")
    print("="*60)
    
    client = XAIClient()
    
    response = client.code_completion(
        prompt="Crea una función que calcule el factorial de un número de forma recursiva",
        language="python",
        model="grok-code-fast-1"
    )
    
    print(f"\n📤 Código generado:\n{response['content']}")


def ejemplo_vision():
    """Ejemplo de análisis de imagen"""
    print("\n" + "="*60)
    print("👁️ EJEMPLO DE VISIÓN")
    print("="*60)
    
    client = XAIClient()
    
    # Ejemplo con URL de imagen
    response = client.vision_completion(
        prompt="Describe qué ves en esta imagen",
        image_url="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/640px-Camponotus_flavomarginatus_ant.jpg",
        model="grok-2-vision-1212"
    )
    
    print(f"\n📤 Descripción: {response['content']}")


def ejemplo_razonamiento():
    """Ejemplo de razonamiento"""
    print("\n" + "="*60)
    print("🧠 EJEMPLO DE RAZONAMIENTO")
    print("="*60)
    
    client = XAIClient()
    
    response = client.reasoning_completion(
        prompt="Si un tren viaja a 120 km/h y otro a 80 km/h en direcciones opuestas, ¿cuánto tiempo tardarán en estar a 400 km de distancia si empiezan en el mismo punto?",
        model="grok-4-fast-reasoning"
    )
    
    print(f"\n📤 Razonamiento:\n{response['content']}")


def ejemplo_streaming():
    """Ejemplo de streaming"""
    print("\n" + "="*60)
    print("🌊 EJEMPLO DE STREAMING")
    print("="*60)
    
    client = XAIClient()
    
    print("\n📤 Respuesta (streaming): ", end="", flush=True)
    
    response = client.chat_completion(
        messages=[
            {"role": "user", "content": "Cuenta hasta 10 con emojis"}
        ],
        model="grok-3-mini",
        stream=True
    )
    
    for chunk in response:
        print(chunk, end="", flush=True)
    print()


def ejemplo_batch():
    """Ejemplo de procesamiento en lote"""
    print("\n" + "="*60)
    print("📦 EJEMPLO DE BATCH")
    print("="*60)
    
    client = XAIAdvancedClient()
    
    prompts = [
        "¿Cuál es la capital de Francia?",
        "¿Cuál es el planeta más grande?",
        "¿Quién escribió Don Quijote?"
    ]
    
    responses = client.batch_completion(
        prompts=prompts,
        model="grok-3-mini"
    )
    
    for prompt, response in zip(prompts, responses):
        print(f"\n❓ {prompt}")
        print(f"✅ {response['content']}")


def listar_modelos():
    """Lista todos los modelos disponibles con su información"""
    print("\n" + "="*60)
    print("📋 MODELOS DISPONIBLES")
    print("="*60)
    
    for model_id, info in MODEL_CONFIGS.items():
        print(f"\n🤖 {info.name}")
        print(f"   ID: {model_id}")
        print(f"   Contexto: {info.context_window:,} tokens")
        print(f"   Precio: ${info.input_price}/M input, ${info.output_price}/M output")
        print(f"   Visión: {'✅' if info.supports_vision else '❌'}")
        print(f"   Razonamiento: {'✅' if info.supports_reasoning else '❌'}")
        print(f"   RPM: {info.rpm_limit}")


# ============================================================================
# PUNTO DE ENTRADA
# ============================================================================

if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════╗
║         xAI GROK API INTEGRATION PARA REPLIT                ║
║                                                              ║
║  Configura tu API key como variable de entorno:             ║
║  export XAI_API_KEY="tu-api-key"                            ║
║                                                              ║
║  O en Replit Secrets como: XAI_API_KEY                      ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    # Listar modelos disponibles
    listar_modelos()
    
    # Verificar si hay API key configurada
    if os.getenv("XAI_API_KEY"):
        print("\n✅ API key detectada!")
        print("\n¿Deseas ejecutar los ejemplos? (s/n): ", end="")
        
        # En Replit, ejecutar ejemplos automáticamente
        try:
            ejemplo_basico()
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("Verifica tu API key y conexión a internet.")
    else:
        print("\n⚠️ No se detectó API key.")
        print("Configura XAI_API_KEY en los Secrets de Replit.")
