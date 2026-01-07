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
    os.chdir(script_dir)
    
    print("🔧 Verificando dependencias...")
    
    # Instalar dependencias necesarias con validación estricta
    import re as _re_pkg
    ALLOWED_DEPS = frozenset(["fastapi", "uvicorn", "pydantic"])
    _PKG_PATTERN = _re_pkg.compile(r'^[a-zA-Z][a-zA-Z0-9._-]*$')
    
    for dep in ALLOWED_DEPS:
        try:
            __import__(dep.replace("-", "_"))
        except ImportError:
            if _PKG_PATTERN.match(dep) and dep in ALLOWED_DEPS:
                print(f"  📦 Instalando {dep}...")
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", dep, "-q"],
                    capture_output=True,
                    timeout=120,
                    check=False
                )
    
    print("✅ Dependencias OK")
    print()
    
    # Importar y ejecutar el servicio
    from service import run_server
    
    run_server(host="0.0.0.0", port=8081)

if __name__ == "__main__":
    main()
