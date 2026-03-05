# 🤖 Cowork Clone - Agente de Gestión de Archivos con IA

Una aplicación de escritorio inspirada en el modo **Cowork de Claude** de Anthropic. Este software te permite trabajar con un agente de IA que puede leer, crear, editar, organizar y gestionar archivos en tu computadora.

---

## ✨ Características

- **Chat con IA**: Conversa con un agente inteligente que entiende tus necesidades
- **Gestión de Archivos**: Lee, crea, edita, mueve, copia y elimina archivos
- **Organización Automática**: Organiza archivos por tipo o fecha automáticamente
- **Búsqueda Inteligente**: Busca archivos por nombre o contenido
- **Explorador de Archivos**: Navega tu workspace desde la interfaz
- **Progreso en Tiempo Real**: Ve el progreso de las tareas via WebSocket
- **Multi-proveedor IA**: Soporta Anthropic (Claude) y OpenAI (GPT-4)
- **Sandbox de Seguridad**: El agente solo puede acceder a la carpeta que tú elijas

---

## 🚀 Instalación Paso a Paso

### Requisitos Previos

1. **Python 3.9 o superior** - Descárgalo de [python.org](https://www.python.org/downloads/)
2. **Una API Key** de uno de estos proveedores:
   - [Anthropic](https://console.anthropic.com/) (recomendado)
   - [OpenAI](https://platform.openai.com/)

### Instalación

#### Opción 1: Setup Automático (Recomendado)

```bash
# 1. Abre una terminal y navega a la carpeta del proyecto
cd cowork-clone

# 2. Ejecuta el wizard de configuración
python setup.py

# 3. Inicia la aplicación
python app.py
```

#### Opción 2: Setup Manual

```bash
# 1. Navega a la carpeta del proyecto
cd cowork-clone

# 2. Instala las dependencias
pip install -r requirements.txt

# 3. Copia el archivo de ejemplo y edítalo
cp .env.example .env
# Edita .env con tu editor favorito y agrega tu API key

# 4. Inicia la aplicación
python app.py
```

#### En Windows (doble clic)

Simplemente haz doble clic en `run.bat`

#### En macOS/Linux

```bash
./run.sh
```

### 3. Abre tu Navegador

Ve a **http://127.0.0.1:8000** y listo!

---

## 📖 Cómo Usar

### Comandos de Ejemplo

Puedes escribir cosas como:

| Acción | Ejemplo |
|--------|---------|
| Ver archivos | "Muéstrame qué hay en mi workspace" |
| Organizar | "Organiza todos mis archivos por tipo" |
| Crear archivo | "Crea un archivo llamado notas.txt con mis ideas" |
| Buscar | "Busca todos los archivos PDF" |
| Limpiar | "Encuentra archivos duplicados o vacíos" |
| Mover | "Mueve todas las imágenes a una carpeta llamada Fotos" |
| Analizar | "Dame un resumen de lo que hay en mi workspace" |

### Botones Rápidos

La pantalla de bienvenida tiene 4 acciones rápidas:

1. **📂 Organizar Archivos** - Clasifica archivos en carpetas por tipo
2. **🔍 Analizar Workspace** - Vista general de tu workspace
3. **🧹 Limpiar** - Encuentra archivos innecesarios
4. **✨ Crear Estructura** - Crea un proyecto organizado

---

## 🏗️ Arquitectura del Proyecto

```
cowork-clone/
├── app.py                      # Servidor principal (FastAPI)
├── setup.py                    # Wizard de configuración
├── requirements.txt            # Dependencias Python
├── .env.example                # Plantilla de configuración
├── run.bat                     # Lanzador Windows
├── run.sh                      # Lanzador macOS/Linux
├── LEEME.md                    # Este archivo
├── config/
│   ├── __init__.py
│   └── settings.py             # Configuración de la app
├── backend/
│   ├── __init__.py
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── ai_provider.py      # Proveedores de IA (Claude/GPT-4)
│   │   └── cowork_agent.py     # Agente principal
│   ├── services/
│   │   ├── __init__.py
│   │   └── file_manager.py     # Motor de gestión de archivos
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py          # Modelos de datos
│   └── utils/
│       └── __init__.py
└── frontend/
    ├── templates/
    │   └── index.html           # Interfaz web principal
    └── static/
        ├── css/
        │   └── styles.css       # Estilos (tema oscuro)
        └── js/
            └── app.js           # Lógica del frontend
```

---

## ⚙️ Configuración Avanzada

Edita el archivo `.env` para personalizar:

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `AI_PROVIDER` | Proveedor de IA | `anthropic` |
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic | - |
| `OPENAI_API_KEY` | Tu API key de OpenAI | - |
| `ANTHROPIC_MODEL` | Modelo de Claude | `claude-sonnet-4-5-20250929` |
| `OPENAI_MODEL` | Modelo de OpenAI | `gpt-4o` |
| `HOST` | Dirección del servidor | `127.0.0.1` |
| `PORT` | Puerto del servidor | `8000` |
| `WORKSPACE_PATH` | Carpeta de trabajo | `~/cowork-workspace` |
| `MAX_FILE_SIZE_MB` | Tamaño máximo de archivo | `50` |

---

## 🔒 Seguridad

- El agente **solo puede acceder** a la carpeta workspace que configures
- Todas las rutas se validan para evitar acceso fuera del sandbox
- Las API keys se almacenan localmente en `.env` (nunca se comparten)
- El servidor solo escucha en localhost por defecto

---

## 🐛 Solución de Problemas

**"Module not found"**: Ejecuta `pip install -r requirements.txt`

**"API key invalid"**: Verifica tu key en el archivo `.env`

**"Connection refused"**: Asegúrate de que el servidor está corriendo (`python app.py`)

**Puerto en uso**: Cambia `PORT` en `.env` a otro número (ej: 8001)
