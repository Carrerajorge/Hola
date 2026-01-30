#!/bin/bash
# Script para crear .env.production automáticamente en el VPS
# Uso: Ejecutar en el servidor: bash production_env_setup.sh

echo "Configurando entorno de producción..."

cat > .env.production <<'EOF'
PORT=5001
NODE_ENV=production
# CONFIGURACIÓN DE BASE DE DATOS
# Si tu contraseña no es 'postgres', cámbiala aquí:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat

# SEGURIDAD
# Esta clave se genera aleatoriamente cada vez, pero para producción real debería ser fija
SESSION_SECRET=$(openssl rand -hex 32)
EOF

echo ".env.production creado exitosamente."
echo "Contenido:"
cat .env.production
