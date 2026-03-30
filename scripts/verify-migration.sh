#!/bin/bash

# Script de verificación post-migración
# Verifica que todos los componentes nuevos estén correctamente configurados

echo "🔍 Verificando migración Chat Interface v2..."
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Función para imprimir resultado
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ERRORS=$((ERRORS + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

# Verificar archivos nuevos existenecho -e "${BLUE}📁 Verificando estructura de archivos...${NC}"

if [ -f "client/src/components/chat/MessageInput.tsx" ]; then
    check_pass "MessageInput.tsx existe"
else
    check_fail "MessageInput.tsx no encontrado"
fi

if [ -f "client/src/components/chat/MessageList.tsx" ]; then
    check_pass "MessageList.tsx existe"
else
    check_fail "MessageList.tsx no encontrado"
fi

if [ -f "client/src/components/chat/ChatRuntime.tsx" ]; then
    check_pass "ChatRuntime.tsx existe"
else
    check_fail "ChatRuntime.tsx no encontrado"
fi

if [ -f "client/src/components/chat-interface-v2.tsx" ]; then
    check_pass "chat-interface-v2.tsx existe"
else
    check_fail "chat-interface-v2.tsx no encontrado"
fi

if [ -f "client/src/hooks/chat/useChatRuntime.ts" ]; then
    check_pass "useChatRuntime.ts existe"
else
    check_fail "useChatRuntime.ts no encontrado"
fi

if [ -f "client/src/hooks/chat/useAttachmentPipeline.ts" ]; then
    check_pass "useAttachmentPipeline.ts existe"
else
    check_fail "useAttachmentPipeline.ts no encontrado"
fi

if [ -f "client/src/lib/errors.ts" ]; then
    check_pass "errors.ts existe"
else
    check_fail "errors.ts no encontrado"
fi

if [ -f "client/src/stores/errorStore.ts" ]; then
    check_pass "errorStore.ts existe"
else
    check_fail "errorStore.ts no encontrado"
fi

if [ -f "client/src/hooks/usePerformance.ts" ]; then
    check_pass "usePerformance.ts existe"
else
    check_fail "usePerformance.ts no encontrado"
fi

if [ -f "client/src/hooks/useAccessibility.ts" ]; then
    check_pass "useAccessibility.ts existe"
else
    check_fail "useAccessibility.ts no encontrado"
fi

echo ""
echo -e "${BLUE}🧪 Verificando tests...${NC}"

if [ -f "client/src/hooks/chat/__tests__/useChatRuntime.test.ts" ]; then
    check_pass "Tests de useChatRuntime existen"
else
    check_warn "Tests de useChatRuntime no encontrados"
fi

if [ -f "client/src/hooks/chat/__tests__/useAttachmentPipeline.test.ts" ]; then
    check_pass "Tests de useAttachmentPipeline existen"
else
    check_warn "Tests de useAttachmentPipeline no encontrados"
fi

if [ -f "e2e/chat-core.spec.ts" ]; then
    check_pass "Tests E2E existen"
else
    check_warn "Tests E2E no encontrados"
fi

echo ""
echo -e "${BLUE}📊 Verificando legacy...${NC}"

# Contar archivos que aún usan el legacy
LEGACY_COUNT=$(grep -r "from.*chat-interface[\"']" client/src --include="*.tsx" --include="*.ts" | wc -l)
if [ "$LEGACY_COUNT" -eq 0 ]; then
    check_pass "No hay importaciones legacy de chat-interface"
else
    check_warn "Aún hay $LEGACY_COUNT importaciones legacy de chat-interface"
    echo -e "${YELLOW}  Archivos con importaciones legacy:${NC}"
    grep -r "from.*chat-interface[\"']" client/src --include="*.tsx" --include="*.ts" -l | head -5 | sed 's/^/    - /'
fi

echo ""
echo -e "${BLUE}🔧 Verificando TypeScript...${NC}"

# Verificar compilación
if npm run check > /dev/null 2>&1; then
    check_pass "TypeScript compila sin errores"
else
    check_fail "TypeScript tiene errores de compilación"
    echo -e "${RED}Ejecuta 'npm run check' para ver los errores${NC}"
fi

echo ""
echo -e "${BLUE}📦 Verificando dependencias...${NC}"

# Verificar dependencias necesarias
if npm list zod > /dev/null 2>&1; then
    check_pass "Zod instalado"
else
    check_fail "Zod no está instalado"
fi

if npm list @tanstack/react-virtual > /dev/null 2>&1; then
    check_pass "@tanstack/react-virtual instalado"
else
    check_fail "@tanstack/react-virtual no está instalado"
fi

echo ""
echo "=========================================="
echo -e "${BLUE}📋 RESUMEN${NC}"
echo "=========================================="
echo -e "Errores: ${RED}$ERRORS${NC}"
echo -e "Advertencias: ${YELLOW}$WARNINGS${NC}"

if [ $ERRORS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Verificación completada exitosamente!${NC}"
    echo ""
    echo -e "${BLUE}Próximos pasos:${NC}"
    echo "1. Ejecuta los tests: npm run test:client"
    echo "2. Verifica en desarrollo: npm run dev:client"
    echo "3. Ejecuta tests E2E: npm run test:e2e"
    echo "4. Revisa MIGRATION.md para la guía completa"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Verificación completada con errores${NC}"
    echo -e "${YELLOW}Por favor, corrige los errores antes de continuar${NC}"
    exit 1
fi
