#!/usr/bin/expect -f
set timeout -1
spawn ssh -o StrictHostKeyChecking=no root@69.62.98.126 "cd /var/www/michat && echo '⬇️ Bajando cambios...' && git pull origin main && echo '📦 Instalando dependencias...' && npm ci --include=dev && echo '🏗️ Compilando aplicación...' && npm run build && echo '🗄️ Actualizando BD...' && npm run db:push && echo '🌱 Sembrando modelos AI...' && npx tsx server/scripts/seed_models.ts && echo '🚀 Reiniciando servicio...' && pm2 restart michat --update-env"
expect "password:"
send "TESIS20@hostinger2026\r"
expect eof
