# Guía de Despliegue en VPS (Vía GitHub)

Esta guía detalla los pasos para desplegar ILIAGPT en tu VPS utilizando GitHub como fuente de verdad.

## Requisitos Previos

1. **Repositorio en GitHub**: Asegúrate de que este proyecto esté subido a un repositorio de GitHub (privado o público).
2. **Acceso SSH al VPS**: Debes tener acceso root o sudo al servidor.
3. **Docker y Docker Compose**: Instalados en el VPS.
4. **Git**: Instalado en el VPS.

## Paso 1: Subir cambios a GitHub (Local)

Ya hemos realizado los commits necesarios. Asegúrate de subir los cambios:

```bash
git push origin main
```

## Paso 2: Configuración en el VPS

Conéctate a tu VPS via SSH:

```bash
ssh usuario@tu-vps-ip
```

### 2.1 Clonar el repositorio (Solo la primera vez)

Si aún no has clonado el proyecto:

```bash
# Navega al directorio deseado (ej. /opt o ~)
cd /opt

# Clona el repo (te pedirá credenciales o usa una clave SSH)
git clone https://github.com/usuario/repo.git iliagpt

cd iliagpt
```

### 2.2 Actualizar el código (Despliegues subsiguientes)

Si ya tienes el repositorio clonado:

```bash
cd /opt/iliagpt
git pull origin main
```

## Paso 3: Configuración de Variables de Entorno

Asegúrate de crear el archivo `.env.production` en el servidor con los secretos reales.

```bash
# Copia el ejemplo si no existe
cp .env.production.example .env.production

# Edita el archivo
nano .env.production
```

**Variables Críticas:**

- `DATABASE_URL`: Tu conexión a PostgreSQL.
- `REDIS_URL`: Tu conexión a Redis (o usa el servicio dockerizado).
- `SESSION_SECRET`: Una cadena larga y aleatoria (mínimo 32 caracteres).
- `OPENAI_API_KEY`, etc.: Tus llaves de API.

**Opcionales (solo si habilitas login de Microsoft):**

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`

## Paso 4: Levantar los Servicios

Utiliza `docker-compose.prod.yml` para construir y levantar la aplicación.

```bash
# Construir y levantar en segundo plano
docker compose -f docker-compose.prod.yml up --build -d
```

### Comandos Útiles

- **Ver logs**: `docker compose -f docker-compose.prod.yml logs -f`
- **Reiniciar solo la app**: `docker compose -f docker-compose.prod.yml restart app`
- **Parar todo**: `docker compose -f docker-compose.prod.yml down`

## Verificar el Despliegue

La aplicación debería estar corriendo en el puerto configurado (ej. 80, 443 o 5000).
Visita `http://tu-vps-ip` o tu dominio configurado.
