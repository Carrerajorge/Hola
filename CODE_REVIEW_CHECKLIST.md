# Code Review Checklist

Lista de verificacion para revisiones de codigo del equipo IliaGPT.

---

## 1. Correctitud y Logica

- [ ] El codigo resuelve el problema descrito en el issue/PR
- [ ] No hay errores logicos ni casos limite sin manejar
- [ ] Los tipos de TypeScript son correctos y no se abusa de `any`
- [ ] Los schemas de Zod validan correctamente la entrada del usuario
- [ ] Las queries de Drizzle ORM son correctas y eficientes

## 2. Seguridad

- [ ] No se exponen secretos, API keys ni credenciales en el codigo
- [ ] Las entradas del usuario se validan y sanitizan (prevenir XSS, SQL injection)
- [ ] Los endpoints de Express verifican autenticacion y autorizacion (Passport.js)
- [ ] No hay `dangerouslySetInnerHTML` sin sanitizacion previa
- [ ] Las queries a PostgreSQL usan parametros preparados (Drizzle los maneja, pero verificar queries raw)
- [ ] Los uploads de archivos (Uppy/S3) validan tipo y tamano

## 3. Rendimiento

- [ ] No hay re-renders innecesarios en componentes React
- [ ] Las queries de TanStack Query tienen `staleTime`/`cacheTime` apropiados
- [ ] Los stores de Zustand no causan suscripciones innecesarias
- [ ] Las queries a la base de datos tienen indices adecuados
- [ ] Los jobs de BullMQ manejan reintentos y timeouts correctamente
- [ ] No se cargan modulos pesados de forma sincrona (lazy loading cuando aplique)

## 4. Estilo y Calidad de Codigo

- [ ] El codigo pasa ESLint sin errores (`npm run lint`)
- [ ] Los tipos de TypeScript compilan sin errores (`npm run type-check`)
- [ ] Los nombres de variables, funciones y archivos son descriptivos
- [ ] No hay codigo duplicado que deberia ser extraido
- [ ] No hay `console.log` de debug (usar Pino para logging en server)
- [ ] Los commits siguen la convencion de commitlint (`feat:`, `fix:`, `chore:`, etc.)

## 5. Testing

- [ ] Se incluyen tests unitarios para logica nueva (Vitest)
- [ ] Los tests existentes siguen pasando (`npm run test`)
- [ ] Los tests de cliente usan el entorno jsdom correctamente
- [ ] Se cubren los casos de error y los edge cases
- [ ] Para cambios de UI criticos, se actualizan los tests E2E (Playwright)

## 6. Arquitectura y Patrones

- [ ] La separacion client/server/shared se respeta
- [ ] Los tipos compartidos estan en `shared/`, no duplicados
- [ ] Los nuevos endpoints siguen la estructura existente del servidor Express
- [ ] Los componentes de React usan Radix UI y Tailwind CSS de forma consistente
- [ ] Las integraciones de AI (Claude, OpenAI, Gemini) manejan errores y rate limits
- [ ] Los schemas de base de datos nuevos tienen migraciones de Drizzle

## 7. Manejo de Errores

- [ ] Los errores se capturan y reportan de forma adecuada
- [ ] Los endpoints devuelven codigos HTTP apropiados
- [ ] Las promesas tienen `.catch()` o `try/catch` con `async/await`
- [ ] Los jobs de BullMQ manejan fallos sin perder datos
- [ ] Las conexiones a Redis/PostgreSQL manejan desconexiones

## 8. Observabilidad

- [ ] Los cambios criticos tienen logging con Pino (nivel apropiado)
- [ ] Las operaciones importantes emiten trazas de OpenTelemetry
- [ ] Los errores incluyen contexto suficiente para debugging

## 9. Despliegue

- [ ] Los cambios de entorno se reflejan en `.env.example`
- [ ] Las configuraciones de Docker/docker-compose estan actualizadas si aplica
- [ ] Los scripts de migracion de DB se ejecutan sin errores
- [ ] No se rompe la compatibilidad con el cliente desktop (Electron)

---

## Como Usar

1. El autor del PR verifica esta lista antes de solicitar revision
2. El revisor usa esta lista como guia durante la revision
3. Marcar los items que no aplican como N/A en el comentario del PR
4. Todo item critico (seguridad, correctitud) debe cumplirse antes de hacer merge
