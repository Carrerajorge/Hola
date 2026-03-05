# 🖥️ ILIAGPT Desktop Client — Checklist de Producción

> Estado actual: MVP funcional solo macOS arm64 (v1.0.0 local).
> Objetivo: Releases públicos robustos para macOS, Windows y Linux.

---

## FASE 1: FUNDACIÓN — Corregir inconsistencias y deuda técnica

### 1.1 Unificación de versión
- [ ] Alinear versión en `package.json` → `"version": "2.1.0"` (o la real)
- [ ] Actualizar `trayManager.ts` que hardcodea `v2.1.0` en tooltip y menú
- [ ] Actualizar `download.tsx` → `FALLBACK_VERSION` debe coincidir
- [ ] Unificar `seed-releases.ts` y `update_releases.ts` en un solo script canónico
- [ ] Verificar que `latest-mac.yml` / `latest.yml` / `latest-linux.yml` reflejen la versión correcta tras build

### 1.2 Estructura de archivos del módulo nativo (Rust/NAPI)
- [ ] `native/iliagpt-native.node` actual es **solo arm64 macOS** → documentar que NO es portable
- [ ] Crear CI matrix para compilar `.node` por plataforma (mac-arm64, mac-x64, win-x64, linux-x64)
- [ ] Mover `win_errors*.txt` fuera de `native/` (son logs de debug, no pertenecen al source)
- [ ] Agregar `.gitignore` en `native/` para `target/`, `*.node` compilados, logs

### 1.3 Warnings de compilación Rust
- [ ] Eliminar imports no usados en `uiautomation.rs` (`TreeScope_Children`, `Interface`)
- [ ] Eliminar `INPUT_0` no usado en `input.rs` (Windows)
- [ ] Prefijar con `_` las variables no usadas (`x`, `y` en `mouse_click`)
- [ ] Correr `cargo clippy --all-targets` y resolver todos los warnings

---

## FASE 2: MÓDULO NATIVO (Rust NAPI) — De stubs a implementación real

### 2.1 macOS — Completar implementaciones reales
- [ ] **`screen_capture.rs`**: Verificar que el FFI directo a CoreGraphics funciona sin crashear en macOS 15 (Sequoia). Testear con múltiples monitores
- [ ] **`accessibility.rs`**: El puente AppleScript→JSON es frágil. Implementar binding directo a `AXUIElementRef` vía `core-foundation` para obtener el árbol de accesibilidad real (no solo la ventana enfocada)
- [ ] **`input.rs`**: Testear que `CGEventPost` funciona con SIP activado. Validar keycodes para teclados internacionales (QWERTZ, AZERTY, ñ, acentos)
- [ ] **`window_manager.rs`**: Actualmente retorna datos hardcoded. Implementar con `CGWindowListCopyWindowInfo` real
- [ ] **`system_info.rs`**: Implementar `get_battery_level()` con IOKit real en vez de retornar siempre 100.0
- [ ] **`applescript.rs`**: Agregar timeout a `Command::new("osascript")` para evitar hangs infinitos

### 2.2 Windows — Implementar todo desde los stubs funcionales
- [ ] **`uiautomation.rs`**: `get_focused_element()` funciona. Falta `get_element_tree()` que recorra hijos recursivamente con `TreeScope_Children`
- [ ] **`screen_capture.rs`**: Implementación BitBlt existe. Agregar soporte para captura de monitor específico y escala DPI (125%, 150%, 200%)
- [ ] **`input.rs`**: `mouse_click` tiene las coordenadas `x`/`y` sin usar — el mouse no se mueve antes de clickear. Implementar `mouse_move` + normalización a coordenadas absolutas (`65535 * x / screen_width`)
- [ ] **`input.rs`**: `keyboard_type` necesita manejar caracteres Unicode fuera de ASCII (emojis, caracteres CJK, acentos)
- [ ] **`window_manager.rs`**: `list_windows` funciona. Falta poblar `app_name` (usar `GetWindowModuleFileNameW` o `QueryFullProcessImageNameW`)
- [ ] **`system_info.rs`**: Implementar batería real con `GetSystemPowerStatus` de Win32

### 2.3 Linux — Todo es stub, implementar desde cero
- [ ] **`screen_capture.rs`**: Implementar con **X11** (`XGetImage` vía `x11` crate) Y con **Wayland** (`pipewire` / `wlr-screencopy-unstable-v1` / portal D-Bus `org.freedesktop.portal.ScreenCast`)
- [ ] **`input.rs`**: Implementar con **X11** (`XSendEvent` / `XTest` extension) y **Wayland** (`virtual-keyboard-unstable-v1` / `wtype`)
- [ ] **`accessibility.rs`**: Implementar con **AT-SPI2** D-Bus (`org.a11y.atspi`) para leer el árbol de UI
- [ ] **`window_manager.rs`**: X11 (`XQueryTree`, `_NET_CLIENT_LIST`) + Wayland equivalente (`wlr-foreign-toplevel-management`)
- [ ] **`system_info.rs`**: Leer `/sys/class/power_supply/BAT0/capacity`, `/etc/os-release`
- [ ] Decidir: ¿soportar solo X11, solo Wayland, o ambos? (2025+ es Wayland-first pero muchos distros aún usan X11)

### 2.4 Vision Module
- [ ] **`vision/ocr.rs`**: Actualmente retorna `"stubbed text"`. Integrar Tesseract FFI (`leptess` crate) o usar OCR del OS (macOS `VNRecognizeTextRequest`, Windows `Windows.Media.Ocr`)
- [ ] **`vision/diff.rs`**: Actualmente retorna `1.0`. Implementar diff real píxel a píxel con SIMD (`std::simd` o `packed_simd2`)
- [ ] **`vision/capture.rs`**: `capture_screen_vision()` retorna buffer vacío. Debe delegar a la implementación real de cada plataforma

### 2.5 Testing nativo
- [ ] Expandir `native/tests/macos_tests.rs` — agregar tests para `input`, `accessibility`, `window_manager`
- [ ] Crear `native/tests/windows_tests.rs` con tests equivalentes
- [ ] Crear `native/tests/linux_tests.rs` con tests para X11 y Wayland
- [ ] Los benchmarks (`hal_parity.rs`) solo cubren macOS — agregar benchmarks Windows
- [ ] CI: Correr `cargo test` en cada plataforma del matrix (mac, win, linux)

---

## FASE 3: ELECTRON SHELL — Robustez y seguridad

### 3.1 Seguridad del proceso Electron
- [ ] **Content Security Policy (CSP)**: No hay CSP definida en `main.ts`. Agregar headers restrictivos para prevenir XSS
- [ ] **`nodeIntegration: false`** ✅ ya está bien
- [ ] **`contextIsolation: true`** ✅ ya está bien
- [ ] **Validar URLs cargadas**: `mainWindow.loadURL(panelUrl)` acepta cualquier URL de env. Implementar whitelist de dominios permitidos
- [ ] **`webPreferences.sandbox: true`**: Agregar sandbox al BrowserWindow para aislar el renderer
- [ ] **Revisar entitlements macOS**: `entitlements.mac.plist` pide acceso a cámara, micrófono, accesibilidad, address book, debugger. ¿Se usan todos? Remover los que no sean necesarios (principio de mínimo privilegio)
- [ ] **Deshabilitar `remote` module**: Verificar que no se usa `@electron/remote`
- [ ] **Auditar `preload.ts`**: Las APIs expuestas (`agentStarted`, `agentStopped`, `setIgnoreMouseEvents`) son seguras. Pero `getSystemVolume` debería validar el origen

### 3.2 IPC Handlers — Completar funcionalidad
- [ ] `handlers.ts` solo tiene 3 handlers stub. Implementar:
  - [ ] `system:getMetrics` — CPU, RAM, disco
  - [ ] `system:getBattery` — delegando al módulo nativo
  - [ ] `agent:execute` — ejecutar acciones del agente con sandboxing
  - [ ] `native:captureScreen` — captura de pantalla vía módulo nativo
  - [ ] `native:getAccessibilityTree` — árbol UI vía módulo nativo
  - [ ] `native:typeText` / `native:mouseClick` — input vía módulo nativo
- [ ] Agregar validación de argumentos en TODOS los IPC handlers (no confiar en el renderer)
- [ ] Implementar rate limiting en handlers sensibles (captureScreen, input)
- [ ] Logging estructurado de todas las acciones IPC para auditoría

### 3.3 Tray & Shortcuts
- [ ] **Tray icon**: `iconPath` apunta a `../../build/icon.png` que puede no existir. Crear iconos para cada plataforma:
  - [ ] macOS: Template image (16x16 @1x, 32x32 @2x) en formato PNG con transparencia
  - [ ] Windows: `.ico` con múltiples resoluciones (16, 32, 48, 256)
  - [ ] Linux: PNG 128x128
- [ ] **Global shortcuts**: `Cmd+Shift+I` conflicta con DevTools en muchos editores. Hacer configurable
- [ ] **Emergency stop** (`Cmd+Shift+E`): Actualmente solo hace `console.warn`. Implementar halt real del agente (kill backend process, cerrar conexiones WebSocket, notificar al panel)
- [ ] **Tray "Iniciar Agente"**: Usa `executeJavaScript` para hacer fetch — esto es frágil. Usar IPC directo

### 3.4 Overlay HUD
- [ ] Actualmente comentado en `main.ts`. Decidir: ¿se implementa o se elimina?
- [ ] Si se implementa:
  - [ ] Crear componente React dedicado para modo overlay (`?mode=overlay`)
  - [ ] Implementar áreas interactivas con `setIgnoreMouseEvents` dinámico
  - [ ] Testear en multi-monitor (posición, escala DPI)
  - [ ] Agregar toggle en settings para activar/desactivar
- [ ] Si no se implementa: eliminar todo el código muerto del overlay

### 3.5 Backend embebido
- [ ] `startBackendServer()` usa `fork()` con path hardcoded a `dist/index.cjs` dentro del asar. Verificar que el bundle incluye todas las dependencias
- [ ] El `daemon.js` referenciado en `com.iliagpt.hypervisor.plist` no existe en el repo. Crear o documentar
- [ ] Implementar health check del backend embebido (retry, exponential backoff)
- [ ] Manejo de errores si el backend no arranca (mostrar UI de error, no quedarse en blanco)
- [ ] Logging del backend a archivo rotado (no solo stdout)

---

## FASE 4: BUILD PIPELINE & CI/CD

### 4.1 GitHub Actions workflow (`build-desktop.yml`)
- [ ] El workflow existe y se ve completo. Verificar que:
  - [ ] `npm ci --legacy-peer-deps` resuelve correctamente en runners de CI
  - [ ] El build de TypeScript desktop (`tsc -p desktop/tsconfig.json`) no falla
  - [ ] `electron-builder` empaqueta correctamente los native modules (`.node` files)
- [ ] Agregar step de **smoke test** post-build:
  - [ ] macOS: `open IliaGPT.app` + wait + verify process + kill
  - [ ] Windows: Ejecutar `.exe` headless con `--test-startup` flag
  - [ ] Linux: `chmod +x *.AppImage && ./IliaGPT*.AppImage --test-startup`
- [ ] Agregar caching de Rust toolchain y `cargo build` para el módulo nativo

### 4.2 Code signing — NO EXISTE, ES CRÍTICO
- [ ] **macOS**:
  - [ ] Obtener Apple Developer ID certificate ($99/año)
  - [ ] Configurar `CSC_LINK` y `CSC_KEY_PASSWORD` en GitHub Secrets
  - [ ] Implementar notarización con `@electron/notarize` (script `afterSign`)
  - [ ] Sin firma: Gatekeeper bloquea la app → los usuarios NO pueden abrirla
  - [ ] Testear que el `.dmg` firmado pasa `spctl --assess --verbose`
- [ ] **Windows**:
  - [ ] Obtener EV Code Signing Certificate (DigiCert, Sectigo, ~$400/año)
  - [ ] O usar Azure Trusted Signing ($9.99/mes, más barato)
  - [ ] Configurar `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD` en GitHub Secrets
  - [ ] Sin firma: SmartScreen bloquea el instalador → "Windows protegió tu PC"
- [ ] **Linux**: No requiere firma, pero sí GPG para repos apt/rpm (opcional)

### 4.3 Auto-updater
- [ ] `autoUpdater.ts` apunta a GitHub Releases implícitamente (vía `publish.provider: "github"` en package.json)
- [ ] Verificar que `latest-mac.yml`, `latest.yml`, `latest-linux.yml` se suben al release
- [ ] Testear el flujo completo: v1.0.0 instalada → subir v2.0.0 → app detecta update → descarga → instala → reinicia
- [ ] Implementar **delta updates** (electron-builder los soporta con `.blockmap`)
- [ ] Agregar **rollback** si la actualización falla (guardar versión anterior)
- [ ] Agregar canal **beta** para testers: `autoUpdater.channel = 'beta'`
- [ ] Rate limiting: No bombardear GitHub API con checks cada minuto

### 4.4 Cross-compilation del módulo nativo Rust
- [ ] macOS arm64: ✅ funciona (compilado localmente)
- [ ] macOS x64 (Intel): Agregar target `x86_64-apple-darwin` en CI
  - [ ] Decidir: ¿universal binary (arm64+x64) o builds separados?
- [ ] Windows x64: Necesita `cross` o runner Windows con Rust + Visual Studio Build Tools
  - [ ] Las dependencias de `windows` crate requieren SDK de Windows
- [ ] Linux x64: Necesita runner Ubuntu con `build-essential`, `libx11-dev`, `libatspi2.0-dev`, `libdbus-1-dev`
- [ ] Generar `.node` nombrados por plataforma: `iliagpt-native-darwin-arm64.node`, etc.
- [ ] Implementar runtime loading del `.node` correcto según `process.platform` + `process.arch`

---

## FASE 5: DISTRIBUCIÓN & RELEASES

### 5.1 GitHub Releases
- [ ] Crear primer release real con tag `v2.1.0`
- [ ] Subir artifacts: `.dmg`, `.zip` (macOS), `.exe` (Windows), `.AppImage`, `.deb` (Linux)
- [ ] Subir archivos de manifiesto: `latest-mac.yml`, `latest.yml`, `latest-linux.yml`
- [ ] Generar checksums SHA-256 y publicarlos en el body del release
- [ ] Agregar release notes con changelog detallado

### 5.2 Página de descarga (`/download`)
- [ ] Conectar la DB (`appReleases`) con datos reales (no seeds con URLs ficticias)
- [ ] Implementar detección automática del OS del visitante para recomendar la descarga correcta
- [ ] Agregar verificación de integridad: mostrar SHA-256 junto al botón de descarga
- [ ] Agregar link de "verificar firma" con instrucciones
- [ ] Considerar descarga directa vs redirección a GitHub Releases
- [ ] Agregar página de changelog / release notes embebida

### 5.3 Stores y distribución alternativa (futuro)
- [ ] **macOS App Store**: Requiere sandboxing completo, entitlements específicos, y review de Apple
  - [ ] Nota: Las funciones de accesibilidad/input probablemente requieren distribución fuera del App Store
- [ ] **Windows Store** (MSIX): Opcional, reduce fricción de SmartScreen
- [ ] **Homebrew Cask**: `brew install --cask iliagpt`
- [ ] **Winget**: `winget install IliaGPT`
- [ ] **Snap / Flatpak**: Alternativas a AppImage para Linux
- [ ] **AUR (Arch Linux)**: PKGBUILD para la comunidad Arch

### 5.4 Administración de releases en el panel (`ReleasesManager.tsx`)
- [ ] Verificar que el admin puede:
  - [ ] Crear nuevos releases
  - [ ] Marcar como `available: true/false` por plataforma
  - [ ] Editar URLs de descarga
  - [ ] Ver estadísticas de descargas
- [ ] Agregar webhook que actualice la DB automáticamente cuando se crea un GitHub Release

---

## FASE 6: SEGURIDAD AVANZADA & SANDBOXING

### 6.1 Permisos del agente autónomo
- [ ] El agente puede controlar teclado, ratón y leer pantalla. Esto es **extremadamente sensible**
- [ ] Implementar **sistema de permisos granular**:
  - [ ] `screen:read` — captura de pantalla
  - [ ] `screen:record` — grabación continua
  - [ ] `input:keyboard` — tipear texto
  - [ ] `input:mouse` — mover/clickear mouse
  - [ ] `accessibility:read` — leer árbol UI
  - [ ] `filesystem:read` / `filesystem:write`
  - [ ] `network:outbound`
  - [ ] `applescript:execute`
- [ ] UI de confirmación de permisos al estilo macOS (popup modal antes de la primera vez)
- [ ] Logging inmutable de TODAS las acciones del agente (qué hizo, cuándo, con qué datos)
- [ ] **Kill switch** accesible: botón rojo en tray + shortcut + endpoint HTTP local

### 6.2 Aislamiento del daemon/hypervisor
- [ ] `com.iliagpt.hypervisor.plist` corre como LaunchDaemon con `KeepAlive: true`
  - [ ] ¿Debería ser LaunchAgent (user-level) en vez de LaunchDaemon (root-level)?
  - [ ] Documentar si necesita `sudo` para instalar
- [ ] Implementar equivalente para Windows: **Windows Service** con `node-windows` o NSSM
- [ ] Implementar equivalente para Linux: **systemd unit** (`~/.config/systemd/user/iliagpt.service`)
- [ ] El daemon debe tener su propio proceso de auth (API key local, no solo "trust the socket")

### 6.3 Comunicación segura panel ↔ desktop
- [ ] Actualmente el desktop simplemente carga la URL del panel. No hay auth dedicada
- [ ] Implementar **device pairing**: El desktop genera un device ID, el panel lo aprueba
- [ ] Usar **mTLS** o **WebSocket con token JWT** para comunicación bidireccional
- [ ] Encriptar datos sensibles en tránsito y at-rest (keychain macOS, Credential Manager Windows)

---

## FASE 7: UX & POLISH

### 7.1 Primer arranque (onboarding)
- [ ] Wizard de configuración:
  1. Conectar con el panel (URL + login)
  2. Solicitar permisos del OS (accesibilidad, grabación de pantalla)
  3. Opcional: configurar daemon/hypervisor
  4. Test de conectividad
- [ ] Guía visual de cómo otorgar permisos en System Preferences (macOS) / Settings (Windows)

### 7.2 Manejo de errores y estados
- [ ] Pantalla de error si no puede conectar al panel (con retry + diagnóstico)
- [ ] Indicador de estado en tray:
  - [ ] 🟢 Conectado al panel, agente idle
  - [ ] 🔵 Agente ejecutando tarea
  - [ ] 🟡 Desconectado, reintentando
  - [ ] 🔴 Error crítico
- [ ] Notificaciones nativas del OS para eventos importantes del agente
- [ ] Deep linking: `iliagpt://` protocol handler para abrir la app desde el navegador

### 7.3 Rendimiento
- [ ] El `.dmg` actual pesa **505 MB**. Esto es excesivo para una app Electron
  - [ ] Investigar: ¿Se están empaquetando `node_modules` completos dentro del asar?
  - [ ] Usar `asar list` para auditar qué hay dentro del paquete
  - [ ] Excluir dependencias de desarrollo, test files, source maps
  - [ ] Excluir prebuilds de otras plataformas (el build mac incluye `.node` de Windows)
  - [ ] Objetivo: ≤150 MB para macOS, ≤120 MB para Windows
- [ ] Consumo de RAM: Electron base ~150MB. Establecer presupuesto de memoria
- [ ] Startup time: Medir cold start. Objetivo: <3 segundos hasta ventana visible
- [ ] Evitar memory leaks en el overlay HUD (si se implementa)

### 7.4 Internacionalización
- [ ] La UI mezcla español e inglés:
  - [ ] `autoUpdater.ts` mensajes en inglés ("Version X is available")
  - [ ] `trayManager.ts` en español ("Abrir Panel Administrativo")
  - [ ] `download.tsx` en español
- [ ] Decidir: ¿app solo en español, solo en inglés, o i18n completo?
- [ ] Si i18n: implementar con `i18next` + archivos de traducción

---

## FASE 8: TESTING & QA

### 8.1 Tests unitarios
- [ ] Tests para cada IPC handler
- [ ] Tests para `trayManager` (menú items, clicks)
- [ ] Tests para `autoUpdater` (mock de electron-updater)
- [ ] Tests para preload API surface

### 8.2 Tests de integración
- [ ] Electron app arranca sin crash en cada plataforma
- [ ] Conexión al panel funciona (mock server)
- [ ] Cada función nativa (screen capture, input, accessibility) retorna datos válidos
- [ ] Auto-updater detecta nuevas versiones correctamente

### 8.3 Tests E2E
- [ ] Usar **Playwright** o **Spectron** (deprecated) → preferir **Playwright Electron support**
- [ ] Flow completo: arranque → login → ejecutar tarea → ver resultado
- [ ] Flow de actualización: instalar v1 → detectar v2 → actualizar → verificar
- [ ] Stress test del overlay HUD (abrir/cerrar 100 veces sin memory leak)

### 8.4 Tests de seguridad
- [ ] Penetration test del IPC (¿puede una página web maliciosa invocar handlers?)
- [ ] Verificar que `contextIsolation` realmente previene acceso a Node desde el renderer
- [ ] Auditar que no hay `eval()` ni `innerHTML` con datos no sanitizados
- [ ] Dependency audit: `npm audit` + `cargo audit`

### 8.5 Tests multi-plataforma manuales
- [ ] macOS 12 (Monterey), 13 (Ventura), 14 (Sonoma), 15 (Sequoia)
- [ ] macOS Intel vs Apple Silicon
- [ ] Windows 10 (21H2, 22H2), Windows 11 (23H2, 24H2)
- [ ] Windows con escala DPI 125%, 150%, 200%
- [ ] Ubuntu 22.04 LTS, 24.04 LTS
- [ ] Fedora 40+ (Wayland default)
- [ ] Arch Linux (rolling release edge case)

---

## FASE 9: MONITOREO & TELEMETRÍA POST-LAUNCH

### 9.1 Crash reporting
- [ ] Integrar **Sentry** o **Electron CrashReporter** para reportes automáticos
- [ ] Configurar source maps para stack traces legibles
- [ ] Dashboard de crashes por versión, plataforma, OS version

### 9.2 Analytics (opt-in, respetar privacidad)
- [ ] Conteo de instalaciones activas por plataforma
- [ ] Versión de la app y del OS
- [ ] Tasa de actualización exitosa vs fallida
- [ ] Errores de conexión al panel
- [ ] **NO** trackear: contenido de pantalla, teclas, datos del usuario

### 9.3 Feedback loop
- [ ] Botón "Reportar problema" en la app → abre issue en GitHub o envía a panel
- [ ] Recopilar logs del app cuando el usuario reporta un bug (con consentimiento)

---

## FASE 10: DOCUMENTACIÓN

### 10.1 Documentación para desarrolladores
- [ ] `CONTRIBUTING.md` específico para el módulo desktop
- [ ] Guía de setup del entorno de desarrollo (Rust toolchain, Electron, Node)
- [ ] Arquitectura del módulo nativo: diagrama de cómo Rust ↔ NAPI ↔ Electron ↔ React
- [ ] Guía de debugging: cómo inspeccionar el proceso main vs renderer
- [ ] Guía de cross-compilation del módulo nativo

### 10.2 Documentación para usuarios
- [ ] Guía de instalación por plataforma con screenshots
- [ ] FAQ: "macOS dice que la app es de desarrollador no identificado" → cómo resolver
- [ ] FAQ: "Windows SmartScreen bloquea la instalación" → cómo resolver
- [ ] Guía de permisos requeridos y por qué se necesitan
- [ ] Troubleshooting: "La app no conecta al panel" → pasos de diagnóstico

### 10.3 Documentación de seguridad
- [ ] Security policy (`SECURITY.md`) con proceso de reporte de vulnerabilidades
- [ ] Threat model del desktop client (qué puede hacer el agente, límites, riesgos)
- [ ] Explicación pública de qué datos se recopilan y cuáles no

---

## PRIORIDAD SUGERIDA

| Prioridad | Fases | Justificación |
|-----------|-------|---------------|
| 🔴 P0 — Bloqueante | 1.1, 4.2, 5.1 | Sin versión unificada, firma de código y release real, nadie puede descargar nada |
| 🟠 P1 — Crítica | 2.1, 3.1, 3.2, 6.1 | Sin implementaciones reales y seguridad, la app no hace nada útil |
| 🟡 P2 — Importante | 2.2, 2.3, 4.1, 4.4, 7.3 | Windows/Linux y optimización del build |
| 🟢 P3 — Mejora | 3.3, 3.4, 7.1, 7.2, 8.x | Polish, UX, testing exhaustivo |
| 🔵 P4 — Futuro | 5.3, 6.2, 6.3, 9.x, 10.x | Distribución avanzada, monitoreo, docs completas |

---

*Generado: 2026-02-23 | Basado en análisis del codebase ILIACODEX V2*
