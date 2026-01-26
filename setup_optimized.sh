#!/bin/bash

# =============================================================================
# ILIAGPT - High Performance Server Setup Script
# =============================================================================
# Este script configura un servidor Ubuntu 24.04/22.04 para alta concurrencia.
# Ejecútalo como root: bash setup_optimized.sh
# =============================================================================

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}[+] Iniciando configuración de Alto Rendimiento para ILIAGPT...${NC}"

# 1. Actualización del Sistema
echo -e "${YELLOW}[1/7] Actualizando sistema...${NC}"
apt update && apt upgrade -y
apt install -y curl git build-essential nginx ufw htop software-properties-common

# 2. Configuración del Kernel (Sysctl) para Alta Concurrencia
echo -e "${YELLOW}[2/7] Optimizando Sysctl para alto tráfico...${NC}"
cat <<EOF >> /etc/sysctl.conf
# ILIAGPT Optimizations
fs.file-max = 2097152
net.core.somaxconn = 65535
net.virtual_waiting_queues = 2048
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_keepalive_time = 60
net.ipv4.ip_local_port_range = 1024 65535
EOF
sysctl -p

# Aumentar límite de archivos abiertos (ulimit)
echo -e "${YELLOW}[+] Configurando límites de archivos (ulimit)...${NC}"
cat <<EOF > /etc/security/limits.d/iliagpt.conf
root soft nofile 65535
root hard nofile 65535
* soft nofile 65535
* hard nofile 65535
EOF

# 3. Instalación de Node.js 20 (LTS)
echo -e "${YELLOW}[3/7] Instalando Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2 yarn

# 4. Instalación de Docker y Docker Compose
echo -e "${YELLOW}[4/7] Instalando Docker...${NC}"
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker $USER

# 5. Instalación de PostgreSQL 16 (Cliente solamente, usaremos Docker para el server)
# Opcional: si queremos usar psql client
echo -e "${YELLOW}[5/7] Instalando herramientas Postgres...${NC}"
apt install -y postgresql-client

# 6. Configuración de Firewall (UFW)
echo -e "${YELLOW}[6/7] Configurando Firewall básico...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
# ufw enable # Comentado para evitar desconexión accidental, activar manualmente

# 7. Crear directorio y clonar (Prepare folder)
echo -e "${YELLOW}[7/7] Preparando directorio de app...${NC}"
mkdir -p /var/www/iliagpt
chown -R $USER:$USER /var/www/iliagpt

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}¡Configuración Base Completada!${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "Pasos siguientes:"
echo -e "1. ${YELLOW}Navegar al directorio:${NC}"
echo -e "   cd /var/www/iliagpt"
echo -e "2. ${YELLOW}Clonar repo y desplegar:${NC}"
echo -e "   git clone https://github.com/Carrerajorge/Hola.git ."
echo -e "   cp .env.production.example .env.production"
echo -e "   nano .env.production"
echo -e "3. ${YELLOW}Iniciar con Docker Compose:${NC}"
echo -e "   docker compose -f docker-compose.prod.yml up --build -d"
