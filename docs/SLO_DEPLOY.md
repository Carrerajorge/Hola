# HOLA ENTERPRISE - SLOs & Estrategia de Entrega (Blue/Green)

## 1. Service Level Objectives (SLOs Iniciales)

Para poder catalogar un release de la Plataforma como exitoso, cada dominio y microservicio debe asegurar mediante métricas RED (Rate, Error, Duration) los siguientes pisos mínimos:

- **Disponibilidad Global:** 99.9% de uptime real.
- **Tasa de Error (Error Rate):** < 1% global (500s sobre request total en ventana de 5m).
- **Latencia de Respuesta (P95):** < 400ms para Endpoints A11y / HTTP Base. < 2500ms para llamadas proxy a LLMs (gemini/xai).

## 2. Estrategia de Despliegue (Blue/Green Deployment)

La base `main` es sagrada. Ningún merge puede causar interrupción de disponibilidad para los miles de usuarios que interactúan vía IPC, RPC O Web.

### Mecánica de Promoción

1. **Paso 1 (Inmutable Build):** El pipeline `ci.yml` asegura que los artifactos de `dist/` se generen y bloqueen en una imagen Docker limpia etiquetada con el SHA (`ghcr.io/carrerajorge/hola:{SHA}`).
2. **Paso 2 (Despliegue Paralelo - Green):** Se enruta el nuevo contenedor (Green) junto al viejo (Blue). El Daemon HealthCheck (`/health`) verifica conexión a Postgres y Redis.
3. **Paso 3 (Traffic Shift):** Nginx realiza un *reload* redireccionando a *Green*.
4. **Paso 4 (Rollback Automático):** Si la *Error Rate* supera el 1% en los primeros 10 minutos post-despliegue, Nginx regresa el peso del load balancer hacia *Blue* (`docker-compose -f infra.yml reset`).

*Todos estos despliegues están orquestados sin intervención humana, a menos que sea un Hotfix de emergencia.*
