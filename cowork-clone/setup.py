#!/usr/bin/env python3
"""
Cowork Clone - Setup Script
Interactive setup wizard for first-time configuration.
"""
import os
import sys
import shutil

def print_banner():
    print("""
╔══════════════════════════════════════════════════════╗
║                                                      ║
║         🤖  COWORK CLONE - Setup Wizard             ║
║         AI-Powered File Management Agent             ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
    """)

def setup():
    print_banner()

    # Check Python version
    if sys.version_info < (3, 9):
        print("❌ Python 3.9+ is required. You have:", sys.version)
        sys.exit(1)
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor} detected")

    # Create .env if it doesn't exist
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    env_example = os.path.join(os.path.dirname(__file__), '.env.example')

    if not os.path.exists(env_file):
        print("\n📋 Let's configure your settings:\n")

        # AI Provider
        print("Which AI provider would you like to use?")
        print("  1. Anthropic (Claude) - Recommended")
        print("  2. OpenAI (GPT-4)")
        choice = input("\nEnter 1 or 2 [1]: ").strip() or "1"
        provider = "anthropic" if choice == "1" else "openai"

        # API Key
        if provider == "anthropic":
            print(f"\n🔑 Enter your Anthropic API key")
            print("   (Get it from: https://console.anthropic.com/)")
        else:
            print(f"\n🔑 Enter your OpenAI API key")
            print("   (Get it from: https://platform.openai.com/)")

        api_key = input("   API Key: ").strip()

        # Workspace
        default_workspace = os.path.expanduser("~/cowork-workspace")
        print(f"\n📁 Workspace folder (where the AI manages files)")
        workspace = input(f"   Path [{default_workspace}]: ").strip() or default_workspace

        # Create workspace
        os.makedirs(workspace, exist_ok=True)
        print(f"   ✅ Workspace ready: {workspace}")

        # Write .env
        with open(env_file, 'w') as f:
            f.write(f"AI_PROVIDER={provider}\n")
            if provider == "anthropic":
                f.write(f"ANTHROPIC_API_KEY={api_key}\n")
                f.write(f"OPENAI_API_KEY=\n")
                f.write(f"ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n")
            else:
                f.write(f"ANTHROPIC_API_KEY=\n")
                f.write(f"OPENAI_API_KEY={api_key}\n")
                f.write(f"OPENAI_MODEL=gpt-4o\n")
            f.write(f"HOST=127.0.0.1\n")
            f.write(f"PORT=8000\n")
            f.write(f"MAX_FILE_SIZE_MB=50\n")
            f.write(f"WORKSPACE_PATH={workspace}\n")

        print(f"\n✅ Configuration saved to .env")
    else:
        print("✅ Configuration file (.env) already exists")

    # Install dependencies
    print("\n📦 Installing dependencies...")
    os.system(f"{sys.executable} -m pip install -r requirements.txt")

    print("""
╔══════════════════════════════════════════════════════╗
║                                                      ║
║  ✅  Setup Complete!                                 ║
║                                                      ║
║  To start the application, run:                      ║
║                                                      ║
║    python app.py                                     ║
║                                                      ║
║  Then open http://127.0.0.1:8000 in your browser    ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
    """)

if __name__ == "__main__":
    setup()
