#!/usr/bin/env python3
"""
🚀 Script para iniciar el servicio Agente IA v5.0
"""

import subprocess
import sys
import os
from pathlib import Path

def main():
    # Asegurar que estamos en el directorio correcto
    script_dir = Path(__file__).parent
    os.chdir(script_dir.parent)  # Ir al directorio agente-ia-v5
    
    print("🔧 Verificando dependencias...")
    
    # Instalar dependencias necesarias
    deps = ["fastapi", "uvicorn", "pydantic"]
    for dep in deps:
        try:
            __import__(dep.replace("-", "_"))
        except ImportError:
            print(f"  📦 Instalando {dep}...")
            subprocess.run([sys.executable, "-m", "pip", "install", dep, "-q"], check=True)
    
    print("✅ Dependencias OK")
    print()
    
    # Importar y ejecutar el servicio
    sys.path.insert(0, str(script_dir.parent))
    from server.service import run_server
    
    run_server(host="0.0.0.0", port=8081)

if __name__ == "__main__":
    main()
