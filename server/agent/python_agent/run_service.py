#!/usr/bin/env python3
"""
Runner script to start the FastAPI Python Agent service.
Installs dependencies if needed and starts the server on port 8081.
"""

import os
import sys
import subprocess

def install_dependencies():
    """Install required dependencies for the service."""
    dependencies = ["fastapi", "uvicorn", "pydantic"]
    
    print("🔧 Checking dependencies...")
    
    for dep in dependencies:
        try:
            __import__(dep.replace("-", "_"))
            print(f"  ✅ {dep}")
        except ImportError:
            print(f"  📦 Installing {dep}...", end=" ", flush=True)
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", dep, "-q", "--disable-pip-version-check"],
                capture_output=True,
                timeout=120
            )
            if result.returncode == 0:
                print("✅")
            else:
                print("❌")
                print(f"Error: {result.stderr.decode()}")

def main():
    """Start the FastAPI service."""
    install_dependencies()
    
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    port = int(os.environ.get("PYTHON_AGENT_PORT", 8081))
    host = os.environ.get("PYTHON_AGENT_HOST", "0.0.0.0")
    
    print(f"\n🚀 Starting Python Agent Service on {host}:{port}")
    print("=" * 50)
    
    try:
        import uvicorn
        uvicorn.run(
            "service:app",
            host=host,
            port=port,
            reload=False,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("\n👋 Service stopped")
    except Exception as e:
        print(f"❌ Error starting service: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
