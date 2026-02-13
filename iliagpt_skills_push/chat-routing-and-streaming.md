IliaGPT — Chat URLs /chat/:id sin refresh + Streaming estable (Runbook/ADR)
Por qué se hizo

Queríamos que IliaGPT se comporte como ChatGPT:

La URL refleja el chat activo: /chat/:id

Cambiar de chat no recarga (SPA, cambio “imperceptible”)

Abrir un chat por URL funciona (deep-link)

El streaming siempre aparece en el chat correcto

Síntomas que vimos

La URL cambiaba rápido a /chat/:id pero luego:

volvía a /, o

se quedaba en /chat/:id pero no llegaba respuesta

En prod, el build/dockers fallaban con errores “raros” tras editar archivos grandes manualmente.

Causas raíz
A) Router borraba el id o remapeaba /chat/:id

Había lógica que al entrar a /chat/:id terminaba redirigiendo/normalizando hacia /, dejando la URL sin id.

B) Streaming “se perdía” por mismatch de IDs

En ChatInterface había un bloque EMERGENCY BYPASS que streameaba con un chatId inventado tipo:

chat_${Date.now()}
mientras que el backend creaba un chat real con un UUID distinto.

➡️ Resultado: la respuesta se generaba/guardaba en otro chatId, y el usuario “no veía respuesta” en el chat que estaba mirando.

Solución implementada (alto nivel)
1) Mantener Home como “shell” en / y /chat/:id (sin remount)

Archivo: client/src/App.tsx

Se dejó un route único que matchea / y /chat/:id, para que el chat UI no se desmonte (cero parpadeo):

const HOME_ROUTE_REGEX = /^\/(?:chat(?:\/[^/]+)?)?\/?$/;

<Route path={HOME_ROUTE_REGEX} component={Home} />


✅ Resultado: /chat/:id vive y es SPA real.

2) Sincronizar URL ↔ chat activo

Archivo: client/src/pages/home.tsx

Cuando location es /chat/:id, se parsea chatIdFromUrl.

Si chatIdFromUrl existe, se hace setActiveChatId(chatIdFromUrl).

Cuando el usuario selecciona chat desde sidebar, se hace:

setActiveChatId(id)

setLocation(/chat/${id})

Cuando el usuario hace “Nuevo chat”, se vuelve a /.

✅ Resultado: deep-link y navegación consistente.

3) Fix crítico: EMERGENCY BYPASS debe usar runId + chatId real

Archivo: client/src/components/chat-interface.tsx

En el bloque:
[EMERGENCY BYPASS] Simple text message - going direct to API

Se cambió el flujo a:

Esperar a que onSendMessage(userMessage) devuelva el run real:

const runInfo = await onSendMessage(userMessage);

Derivar chatId real:

runInfo.run.chatId (preferido)

fallback: resolveRealChatId(chatId)

Iniciar /api/chat/stream con:

chatId real

runId: runInfo.run.id (CLAVE)

Si veníamos de chat “pending”/nuevo, disparar:

window.dispatchEvent(new CustomEvent("select-chat", { chatId: realChatId, preserveKey: true }))

✅ Resultado: el streaming ya no se pierde en un chatId inventado, y la respuesta aparece en el chat correcto.

Validación / QA checklist

 Entrar a / → enviar primer mensaje → URL pasa a /chat/<uuid> sin refresh visible.

 Abrir /chat/<uuid> directo → abre el chat correcto.

 Cambiar de chat desde sidebar → URL cambia a /chat/<uuid>.

 Enviar mensaje desde chat nuevo → llega respuesta por streaming.

 DevTools → Network → /api/chat/stream:

content-type: text/event-stream

body incluye chatId = UUID de la URL

body incluye runId no vacío

Deploy runbook (VPS)

Recomendación: siempre validar build antes de docker.

Build:

cd /opt/hola
npm run build


Deploy:

docker compose -p iliagpt -f docker-compose.prod.yml up -d --build app


Nota: Si npm run build falla, Docker puede fallar luego con:

COPY dist ./dist: "/dist": not found
porque dist/ no se generó.

Lecciones / reglas para el equipo

No editar archivos gigantes con sed/cat >> para reconstruirlos.
Eso crea cascadas de imports rotos/duplicados y errores de syntax difíciles.

Preferir: patch pequeño, commit, PR.

Si algo se rompe feo: restaurar archivo desde GitHub y re-aplicar patch mínimo.

Para streaming, NO usar IDs temporales (chat_${Date.now()}) si el backend genera UUIDs reales.

Siempre alinear: pending → realId, chatId, runId.

Para debugging de build:

arreglar el primer error real

volver a correr npm run build

recién después docker.

Archivos tocados (núcleo)

client/src/App.tsx → route shell / + /chat/:id

client/src/pages/home.tsx → sync URL ↔ chat activo + setLocation en selección/creación

client/src/components/chat-interface.tsx → EMERGENCY BYPASS: await onSendMessage + runId + chatId real
