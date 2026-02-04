# Ciberseguridad - 20 Mejoras Críticas (Operativo)

Documento local, directo y ejecutable. Esto no es teoría: es una lista de control para endurecer el sistema y reducir riesgo real.

1. MFA obligatorio en admin  
MFA en paneles internos y cuentas privilegiadas. Elimina cuentas por defecto y fuerza rotación inmediata.

2. Defensa contra credential stuffing  
Rate limiting, bloqueo progresivo y detección de patrones anómalos.

3. Contraseñas fuertes y no reutilizables  
Longitud mínima, complejidad, historial y rechazo de credenciales filtradas.

4. Sesiones blindadas  
Rotación de tokens al login/logout, expiración por inactividad y revocación inmediata.

5. Cookies seguras  
`HttpOnly`, `Secure`, `SameSite=Strict`. Sin excepciones.

6. Autorización centralizada  
RBAC/ABAC server‑side, deny‑by‑default, sin bypass por UI.

7. Validación de entradas estricta  
Esquemas por endpoint, allow‑lists, límites de tamaño.

8. Inyección cero  
Queries parametrizadas y sanitización de comandos y filtros.

9. Secretos fuera del repo  
Vault/secret manager y rotación periódica.

10. TLS moderno  
Solo suites fuertes, HSTS, sin protocolos obsoletos.

11. Cifrado en reposo  
DB, backups y archivos sensibles cifrados.

12. Logging sin fugas  
Logs de auth/permiso con `request_id`, sin PII en claro.

13. Alertas de seguridad  
Login anómalo, privilegios escalados, intentos masivos.

14. Hardening de producción  
Debug off, headers seguros, CORS restrictivo.

15. Dependencias controladas  
SCA automático y bloqueo de deploy con CVEs críticas.

16. Entornos aislados  
Dev/stage/prod con llaves distintas, cero reutilización.

17. Backups verificados  
Cifrado, pruebas de restauración programadas y auditadas.

18. Protección SSRF/CSRF/XSS  
Filtros y políticas explícitas por capa.

19. Mínimo privilegio real  
Revisión periódica de roles y accesos.

20. Respuesta a incidentes formal  
Runbook, responsables, canal de crisis y post‑mortems obligatorios.

## Checklist de Verificación Local

1. MFA activo en admin y cuentas críticas.
2. Rate limiting y bloqueo por intentos fallidos aplicado.
3. Contraseñas fuertes con historial y rechazo de filtradas.
4. Tokens rotan al login/logout y se revocan al cerrar sesión.
5. Cookies seguras y expiración por inactividad configuradas.
6. Autorización server‑side centralizada y deny‑by‑default.
7. Validación de input por esquema en endpoints clave.
8. Queries parametrizadas sin excepciones.
9. Secretos fuera del repo y rotación programada.
10. TLS moderno con HSTS activo.
11. Cifrado en reposo verificado.
12. Logs de seguridad sin PII.
13. Alertas de eventos críticos activas.
14. Debug desactivado en producción.
15. SCA con bloqueo por CVEs críticas.
16. Entornos aislados por llaves.
17. Backups cifrados y prueba de restauración reciente.
18. Controles SSRF/CSRF/XSS verificados.
19. Auditoría de privilegios al día.
20. Runbook de incidentes vigente.
