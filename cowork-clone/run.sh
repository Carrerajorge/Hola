#!/bin/bash
echo ""
echo "Starting Cowork Clone..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "First time setup detected!"
    python3 setup.py
    if [ $? -ne 0 ]; then
        echo "Setup failed. Please check your Python installation."
        exit 1
    fi
fi

# Start the server
echo "Starting server at http://127.0.0.1:8000"
echo "Press Ctrl+C to stop"
echo ""
python3 app.py
