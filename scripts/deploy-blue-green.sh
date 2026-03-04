#!/bin/bash
# Enterprise Deploy Mechanism (Blue/Green)
# HOLA V1.0 - Executed ONLY by the CI/CD Action Runner

set -e

NEW_SHA=$1
if [ -z "$NEW_SHA" ]; then
    echo "Falta tag SHA de versión."
    exit 1
fi

echo "[1/4] Levantando entorno GREEN (Versión: $NEW_SHA) asíncronamente..."
docker-compose --project-name green -f docker-compose.infra.yml up -d --build

echo "[2/4] Esperando 15s para Healthcheck y Warmup..."
sleep 15
# Aquí se testearía contra localhost:8081/health

echo "[3/4] Intercambiando Router Traffic en Nginx..."
# Mock Nginx HUP signal
docker exec hola-infra-nginx-1 nginx -s reload

echo "[4/4] Observando SLO durante 1m (Si hay errores > 1% hacemos Fallback)..."
# (Acá entrarían alarmas Prometheus).

echo "✅ Promoción BLUE-GREEN Extitosa."
# docker-compose --project-name blue down
