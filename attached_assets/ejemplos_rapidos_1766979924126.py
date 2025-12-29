"""
Ejemplos Rápidos de xAI Grok API
================================
Copia y pega estos ejemplos en tu proyecto.
"""

import os
from openai import OpenAI

# ============================================================
# CONFIGURACIÓN INICIAL
# ============================================================

# Configura tu API key (en Replit, usa Secrets)
XAI_API_KEY = os.getenv("XAI_API_KEY")

# Cliente compatible con OpenAI SDK
client = OpenAI(
    api_key=XAI_API_KEY,
    base_url="https://api.x.ai/v1"
)


# ============================================================
# EJEMPLO 1: Chat básico con Grok-3-mini (más económico)
# ============================================================

def chat_basico(mensaje: str) -> str:
    """Chat simple y económico"""
    response = client.chat.completions.create(
        model="grok-3-mini",
        messages=[
            {"role": "user", "content": mensaje}
        ]
    )
    return response.choices[0].message.content


# ============================================================
# EJEMPLO 2: Generación de código con Grok Code
# ============================================================

def generar_codigo(descripcion: str, lenguaje: str = "python") -> str:
    """Genera código usando el modelo especializado"""
    response = client.chat.completions.create(
        model="grok-code-fast-1",
        messages=[
            {
                "role": "system",
                "content": f"Eres un experto programador en {lenguaje}. "
                          "Genera código limpio y bien documentado."
            },
            {"role": "user", "content": descripcion}
        ],
        temperature=0.3  # Menos creatividad para código más preciso
    )
    return response.choices[0].message.content


# ============================================================
# EJEMPLO 3: Análisis de imagen con Grok Vision
# ============================================================

def analizar_imagen(prompt: str, imagen_url: str) -> str:
    """Analiza una imagen usando Grok Vision"""
    response = client.chat.completions.create(
        model="grok-2-vision-1212",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": imagen_url}
                    }
                ]
            }
        ]
    )
    return response.choices[0].message.content


# ============================================================
# EJEMPLO 4: Razonamiento avanzado con Grok 4
# ============================================================

def razonamiento(problema: str) -> str:
    """Resuelve problemas complejos con razonamiento"""
    response = client.chat.completions.create(
        model="grok-4-fast-reasoning",
        messages=[
            {
                "role": "system",
                "content": "Razona paso a paso antes de dar tu respuesta final."
            },
            {"role": "user", "content": problema}
        ],
        max_tokens=4096
    )
    return response.choices[0].message.content


# ============================================================
# EJEMPLO 5: Streaming (respuesta en tiempo real)
# ============================================================

def chat_streaming(mensaje: str):
    """Obtiene respuesta en tiempo real"""
    stream = client.chat.completions.create(
        model="grok-3-mini",
        messages=[
            {"role": "user", "content": mensaje}
        ],
        stream=True
    )
    
    for chunk in stream:
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)
    print()


# ============================================================
# EJEMPLO 6: Conversación con historial
# ============================================================

class Conversacion:
    """Mantiene el historial de una conversación"""
    
    def __init__(self, modelo: str = "grok-3-mini", system_prompt: str = None):
        self.modelo = modelo
        self.historial = []
        if system_prompt:
            self.historial.append({
                "role": "system",
                "content": system_prompt
            })
    
    def enviar(self, mensaje: str) -> str:
        """Envía un mensaje y obtiene respuesta"""
        self.historial.append({
            "role": "user",
            "content": mensaje
        })
        
        response = client.chat.completions.create(
            model=self.modelo,
            messages=self.historial
        )
        
        respuesta = response.choices[0].message.content
        self.historial.append({
            "role": "assistant",
            "content": respuesta
        })
        
        return respuesta
    
    def limpiar(self):
        """Limpia el historial"""
        system = [m for m in self.historial if m["role"] == "system"]
        self.historial = system


# ============================================================
# EJEMPLO 7: Function Calling (herramientas)
# ============================================================

def chat_con_funciones(mensaje: str) -> dict:
    """Ejemplo de function calling"""
    
    # Define las funciones que Grok puede llamar
    tools = [
        {
            "type": "function",
            "function": {
                "name": "obtener_clima",
                "description": "Obtiene el clima actual de una ciudad",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ciudad": {
                            "type": "string",
                            "description": "Nombre de la ciudad"
                        }
                    },
                    "required": ["ciudad"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "calcular",
                "description": "Realiza cálculos matemáticos",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expresion": {
                            "type": "string",
                            "description": "Expresión matemática a evaluar"
                        }
                    },
                    "required": ["expresion"]
                }
            }
        }
    ]
    
    response = client.chat.completions.create(
        model="grok-3-mini",
        messages=[
            {"role": "user", "content": mensaje}
        ],
        tools=tools,
        tool_choice="auto"
    )
    
    # Procesar la respuesta
    message = response.choices[0].message
    
    if message.tool_calls:
        return {
            "tipo": "function_call",
            "funciones": [
                {
                    "nombre": tc.function.name,
                    "argumentos": tc.function.arguments
                }
                for tc in message.tool_calls
            ]
        }
    else:
        return {
            "tipo": "texto",
            "contenido": message.content
        }


# ============================================================
# EJEMPLO 8: Estructurar salida como JSON
# ============================================================

def obtener_json(prompt: str, schema: dict) -> dict:
    """Obtiene respuesta estructurada en JSON"""
    import json
    
    response = client.chat.completions.create(
        model="grok-3-mini",
        messages=[
            {"role": "user", "content": prompt}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "respuesta",
                "schema": schema,
                "strict": True
            }
        }
    )
    
    return json.loads(response.choices[0].message.content)


# ============================================================
# EJECUTAR EJEMPLOS
# ============================================================

if __name__ == "__main__":
    if not XAI_API_KEY:
        print("❌ Configura XAI_API_KEY en los Secrets de Replit")
        exit(1)
    
    print("="*60)
    print("🚀 EJEMPLOS DE xAI GROK API")
    print("="*60)
    
    # Ejemplo 1: Chat básico
    print("\n📝 Chat básico:")
    respuesta = chat_basico("¿Cuál es la capital de España?")
    print(f"   {respuesta}")
    
    # Ejemplo 5: Streaming
    print("\n🌊 Streaming:")
    print("   ", end="")
    chat_streaming("Cuenta del 1 al 5")
    
    # Ejemplo 6: Conversación
    print("\n💬 Conversación:")
    conv = Conversacion(system_prompt="Eres un chef experto.")
    print(f"   User: ¿Qué necesito para hacer una tortilla?")
    print(f"   Grok: {conv.enviar('¿Qué necesito para hacer una tortilla?')[:200]}...")
    
    print("\n✅ ¡Ejemplos completados!")
