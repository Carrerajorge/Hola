# Ciberseguridad - 10 Mejoras Críticas (Operativo)

Documento local, directo y ejecutable. Esto no es un wishlist: es una lista de control para endurecer el sistema y reducir riesgo real.

1. MFA obligatorio y defensa contra credenciales robadas  
MFA en todo panel administrativo y cuentas privilegiadas. Bloqueo y rate limiting ante intentos de fuerza bruta. Elimina cuentas por defecto y fuerza rotación inmediata de credenciales.

2. Control de acceso estricto y centralizado  
Autorización siempre del lado servidor, con política única, deny-by-default y revisión por rol/atributo en cada ruta sensible.

3. Gestión de sesión robusta  
Rotación de tokens al autenticar. Expiración por inactividad y expiración absoluta. Cookies `HttpOnly`, `Secure`, `SameSite` y revocación inmediata al cerrar sesión.

4. Validación y sanitización de entradas  
Allow-lists con esquema estricto en cada endpoint. Rechazo de payloads fuera de contrato. Límites de tamaño y parsing defensivo.

5. Logging de seguridad y manejo de errores sin fuga de datos  
Registra decisiones de acceso y autenticación. Errores genéricos al usuario. Trazabilidad con `request_id` y sin PII en logs.

6. Gestión de vulnerabilidades con SLA  
Inventario de dependencias, escaneo automatizado y ventanas de parcheo definidas. Bloqueo de despliegue si hay severidad crítica sin mitigación.

7. Hardening y configuración segura por defecto  
Servicios y puertos mínimos. Desactiva debug en producción. Encabezados de seguridad y CORS restrictivo.

8. Criptografía robusta en tránsito y reposo  
TLS fuerte, cifrado en base de datos y backups. Secretos fuera del repo y rotación periódica.

9. Backups confiables y verificados  
Backups cifrados, con verificación de integridad y pruebas de restauración programadas.

10. Respuesta a incidentes formal  
Runbook claro, responsables definidos, canales de comunicación y post‑mortems obligatorios.

## Checklist de Verificación Local

1. MFA activo en admin y cuentas críticas.
2. Rate limiting y bloqueo por intentos fallidos aplicado.
3. Políticas de autorización centralizadas y en servidor.
4. Tokens rotan al login y se invalidan al logout.
5. Cookies seguras y expiración por inactividad configuradas.
6. Validación de input por esquema en endpoints clave.
7. Logs con decisiones de acceso y `request_id` sin datos sensibles.
8. Scan de dependencias y reglas de bloqueo por severidad.
9. TLS y cifrado de datos sensibles verificados.
10. Backups cifrados con prueba de restauración reciente.
