#!/bin/bash
# ILIAGPT - Script de inicio
# Ejecutar: ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Iniciando ILIAGPT...${NC}"

# 1. Verificar node
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js no encontrado${NC}"
    exit 1
fi

# 2. Verificar .env
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Archivo .env no encontrado${NC}"
    exit 1
fi

# 3. Verificar API keys
source .env 2>/dev/null || true
if [ -z "$GEMINI_API_KEY" ] && [ -z "$XAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️ No hay API keys configuradas (GEMINI_API_KEY o XAI_API_KEY)${NC}"
fi

# 4. Matar procesos anteriores
echo -e "${YELLOW}Deteniendo procesos anteriores...${NC}"
pkill -f "node.*iliagpt" 2>/dev/null || true
sleep 2

# 5. Verificar node_modules
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Instalando dependencias...${NC}"
    npm install
fi

# 6. Iniciar servidor
echo -e "${GREEN}✅ Iniciando servidor en puerto 5001...${NC}"
npm run dev &

# 7. Esperar a que esté listo
echo -e "${YELLOW}Esperando a que el servidor esté listo...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:5001 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Servidor listo en http://localhost:5001${NC}"
        exit 0
    fi
    sleep 1
done

echo -e "${RED}❌ El servidor no respondió después de 30 segundos${NC}"
exit 1
