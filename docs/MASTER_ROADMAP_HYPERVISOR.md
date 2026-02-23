<!-- markdownlint-disable MD013 MD024 MD040 -->
# 🧠 ILIAGPT HYPERVISOR — MASTER ROADMAP

## Instrucciones de Implementación para el Equipo de Ingeniería

### Objetivo: Agente Autónomo de Hiper-Privilegio con 1000+ Capacidades

**Fecha:** 2026-02-22
**Versión:** 1.0
**Estado actual:** 5,578 tests pasando | ~40% de 1000 capacidades | macOS parcial | Sin daemon

---

## TABLA DE CONTENIDOS

1. [Arquitectura General](#1-arquitectura-general)
2. [FASE 0: Infraestructura Base (Semana 1-2)](#fase-0-infraestructura-base)
3. [FASE 1: Native OS Control Layer (Semana 2-4)](#fase-1-native-os-control-layer)
4. [FASE 2: Vision Pipeline Continuo (Semana 3-5)](#fase-2-vision-pipeline-continuo)
5. [FASE 3: Autonomous Brain v2 (Semana 4-6)](#fase-3-autonomous-brain-v2)
6. [FASE 4: Cross-Platform HAL (Semana 5-8)](#fase-4-cross-platform-hal)
7. [FASE 5: Persistence & Telemetry (Semana 6-8)](#fase-5-persistence--telemetry)
8. [FASE 6: Desktop App Nativa (Semana 7-10)](#fase-6-desktop-app-nativa)
9. [FASE 7: Completar 1000 Capacidades (Semana 8-12)](#fase-7-completar-1000-capacidades)
10. [Asignación de Equipos](#asignación-de-equipos)
11. [Stack Tecnológico Definitivo](#stack-tecnológico-definitivo)
12. [Métricas de Éxito](#métricas-de-éxito)

---

## 1. ARQUITECTURA GENERAL

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        ILIAGPT HYPERVISOR                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │   Electron    │  │   Web UI     │  │   Mobile / WhatsApp /     │ │
│  │   Desktop     │  │   React      │  │   Telegram / API          │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────────┘ │
│         │                  │                       │                 │
│  ┌──────┴──────────────────┴───────────────────────┴──────────────┐ │
│  │              UNIFIED API GATEWAY (Express + WS)                │ │
│  │         RPC cifrado bidireccional (gRPC / WebSocket)           │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                              │                                      │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │                  COGNITIVE CORE                                │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────────────┐  │ │
│  │  │ Brain v2    │ │ Intent       │ │ Active Inference       │  │ │
│  │  │ (ReAct+)    │ │ Analysis     │ │ (FEP State Graphs)     │  │ │
│  │  └─────────────┘ └──────────────┘ └────────────────────────┘  │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────────────┐  │ │
│  │  │ Multi-Agent │ │ Memory       │ │ Learning System        │  │ │
│  │  │ Swarm       │ │ Hierarchy    │ │ (Reward + Reflection)  │  │ │
│  │  └─────────────┘ └──────────────┘ └────────────────────────┘  │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                              │                                      │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │             CONTINUOUS VISION PIPELINE                         │ │
│  │  ┌────────────┐ ┌──────────────┐ ┌─────────────────────────┐  │ │
│  │  │ Screen     │ │ VLM Frame    │ │ UI Element Detection    │  │ │
│  │  │ Capture    │ │ Analysis     │ │ (YOLO/GroundingDINO)    │  │ │
│  │  │ (60fps)    │ │ (Gemini/GPT) │ │ + Accessibility Tree    │  │ │
│  │  └────────────┘ └──────────────┘ └─────────────────────────┘  │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                              │                                      │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │            CROSS-PLATFORM HAL (Hardware Abstraction Layer)     │ │
│  │  ┌──────────────────────┐  ┌────────────────────────────────┐ │ │
│  │  │      macOS            │  │         Windows                │ │ │
│  │  │  ┌────────────────┐   │  │  ┌────────────────────────┐   │ │ │
│  │  │  │ Accessibility  │   │  │  │ UIAutomation (COM)     │   │ │ │
│  │  │  │ API (AX)       │   │  │  │ Win32 API              │   │ │ │
│  │  │  │ CoreGraphics   │   │  │  │ DirectX Screen Cap     │   │ │ │
│  │  │  │ IOKit          │   │  │  │ WinRT                  │   │ │ │
│  │  │  │ AppleScript    │   │  │  │ PowerShell             │   │ │ │
│  │  │  └────────────────┘   │  │  └────────────────────────┘   │ │ │
│  │  └──────────────────────┘  └────────────────────────────────┘ │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                              │                                      │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │           SYSTEM DAEMON (Nivel 0 / LaunchDaemon)              │ │
│  │  Auto-start · Watchdog · Crash Recovery · Privilege Escalation │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │           PERSISTENCE & TELEMETRY                             │ │
│  │  PostgreSQL · Redis · ClickHouse · Vector Store · File Store  │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## FASE 0: INFRAESTRUCTURA BASE

### Semana 1-2 | Equipos: DevOps + Backend Core

### Prioridad: 🔴 CRÍTICA

### 0.1 — System Daemon (macOS LaunchDaemon)

**Archivo a crear:** `daemon/iliagpt-daemon.ts`

```
Objetivo: Proceso residente que sobrevive reinicios, corre con privilegios
elevados, y orquesta todos los subsistemas.
```

**Instrucciones:**

1. Crear un servicio Node.js standalone que corra como `LaunchDaemon` en macOS:

   ```bash
   # Plist destino: /Library/LaunchDaemons/com.iliagpt.hypervisor.plist
   ```

2. El daemon debe:
   - Arrancar automáticamente al boot (antes de login de usuario)
   - Correr como `root` (necesario para Accessibility API sin prompts)
   - Exponer un socket Unix en `/var/run/iliagpt.sock` para IPC
   - Tener watchdog con auto-restart en crash (máx 3 intentos en 60s)
   - Manejar graceful shutdown en SIGTERM
   - Loggear a `/var/log/iliagpt/daemon.log` con rotación

3. Estructura del plist:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.iliagpt.hypervisor</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/local/bin/node</string>
       <string>/opt/iliagpt/daemon/index.cjs</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <dict>
       <key>SuccessfulExit</key>
       <false/>
     </dict>
     <key>StandardOutPath</key>
     <string>/var/log/iliagpt/daemon.log</string>
     <key>StandardErrorPath</key>
     <string>/var/log/iliagpt/daemon-error.log</string>
     <key>EnvironmentVariables</key>
     <dict>
       <key>NODE_ENV</key>
       <string>production</string>
     </dict>
   </dict>
   </plist>
   ```

4. **Para Windows** (Fase 4): usar `node-windows` o compilar como `.exe` con `pkg` + registrar como Windows Service via `sc.exe`.

### 0.2 — RPC Cifrado Bidireccional

**Archivos a crear:**

- `server/rpc/transport.ts` — Capa de transporte
- `server/rpc/protocol.ts` — Definición de mensajes
- `server/rpc/server.ts` — Servidor RPC
- `server/rpc/client.ts` — Cliente RPC

**Instrucciones:**

1. Implementar sobre **WebSocket + MessagePack** (más rápido que JSON, binario):

   ```
   npm install ws @msgpack/msgpack
   ```

2. Protocolo de mensajes:

   ```typescript
   interface RPCMessage {
     id: string;           // UUID v4
     type: 'request' | 'response' | 'event' | 'stream';
     method: string;       // e.g., "vision.captureScreen", "input.click"
     params?: any;
     result?: any;
     error?: { code: number; message: string; data?: any };
     timestamp: number;
     signature?: string;   // HMAC-SHA256 del payload
   }
   ```

3. Cifrado: TLS 1.3 para conexiones remotas, HMAC-SHA256 para firma de mensajes locales.

4. Features requeridos:
   - Heartbeat cada 5s con auto-reconnect
   - Request timeout configurable (default 30s)
   - Streaming bidireccional para vision frames
   - Backpressure handling
   - Connection multiplexing (múltiples canales lógicos por socket)

### 0.3 — Event Bus Unificado

**Archivo existente a extender:** `server/agent/eventBus.ts`

**Instrucciones:**

1. Reemplazar el EventEmitter actual por un bus tipado con:
   - Eventos persistentes (guardados en DB para replay)
   - Pub/Sub con topics jerárquicos: `system.mouse.click`, `vision.frame.analyzed`
   - Dead letter queue para eventos fallidos
   - Métricas de throughput por topic

2. Topics principales:

   ```
   system.*          — Eventos del SO (mouse, keyboard, window focus)
   vision.*          — Frames, detecciones, OCR results
   agent.*           — Decisiones, planes, acciones
   telemetry.*       — Métricas, logs, traces
   user.*            — Inputs del usuario, comandos
   workflow.*        — Estados de workflows
   ```

---

## FASE 1: NATIVE OS CONTROL LAYER

### Semana 2-4 | Equipos: Native/Systems + macOS + Windows

### Prioridad: 🔴 CRÍTICA

### 1.1 — Rust Native Bridge (reemplazo de Nut.js + AppleScript)

**DECISIÓN ARQUITECTÓNICA:** Reemplazar `@nut-tree-fork/nut-js` y `AppleScript` con un addon nativo en **Rust** compilado via **NAPI-RS**.

**¿Por qué Rust?**

- Performance: 100x más rápido que AppleScript para acciones repetitivas
- Seguridad: Memory safety sin GC
- Cross-platform: Un solo codebase para macOS + Windows
- FFI directo: Acceso a Accessibility API, CoreGraphics, Win32 sin wrappers

**Archivos a crear:**

```
native/
├── Cargo.toml
├── src/
│   ├── lib.rs                    # Entry point NAPI
│   ├── platform/
│   │   ├── mod.rs
│   │   ├── macos/
│   │   │   ├── mod.rs
│   │   │   ├── accessibility.rs  # AXUIElement API
│   │   │   ├── screen_capture.rs # CGWindowListCreateImage
│   │   │   ├── input.rs          # CGEvent para mouse/keyboard
│   │   │   ├── window_manager.rs # Window enumeration + control
│   │   │   ├── system_info.rs    # IOKit, battery, displays
│   │   │   └── applescript.rs    # OSA bridge para legacy
│   │   └── windows/
│   │       ├── mod.rs
│   │       ├── uiautomation.rs   # IUIAutomation COM
│   │       ├── screen_capture.rs # DXGI Desktop Duplication
│   │       ├── input.rs          # SendInput Win32
│   │       ├── window_manager.rs # EnumWindows + HWND control
│   │       └── system_info.rs    # WMI queries
│   ├── vision/
│   │   ├── mod.rs
│   │   ├── capture.rs            # Unified screen capture
│   │   ├── diff.rs               # Frame differencing (SIMD)
│   │   └── ocr.rs                # Tesseract FFI o Windows OCR
│   └── types.rs                  # Shared types
├── build.rs
└── index.d.ts                    # TypeScript declarations
```

**Instrucciones detalladas:**

#### 1.1.1 — macOS Accessibility API (`accessibility.rs`)

```rust
// Usar core-foundation y core-graphics crates
// Crates necesarios en Cargo.toml:
// core-foundation = "0.10"
// core-graphics = "0.24"
// accessibility = "0.1"  (o FFI directo)

// Funciones a exponer via NAPI:
#[napi]
pub fn get_focused_element() -> AXElement { ... }

#[napi]
pub fn get_element_at_position(x: f64, y: f64) -> AXElement { ... }

#[napi]
pub fn get_element_tree(pid: i32) -> Vec<AXElement> { ... }

#[napi]
pub fn perform_action(element_id: String, action: String) -> bool { ... }

#[napi]
pub fn get_element_attributes(element_id: String) -> HashMap<String, String> { ... }

#[napi]
pub fn set_element_value(element_id: String, value: String) -> bool { ... }
```

**AXElement debe exponer:**

- `role` (button, textfield, window, menu, etc.)
- `title` / `description`
- `value`
- `position` (x, y)
- `size` (width, height)
- `isEnabled`, `isFocused`, `isSelected`
- `children[]` (tree traversal)
- `actions[]` (AXPress, AXConfirm, etc.)

#### 1.1.2 — Screen Capture de Alto Rendimiento (`screen_capture.rs`)

```rust
// macOS: CGWindowListCreateImage / CGDisplayCreateImage
// Windows: DXGI Desktop Duplication API (DirectX 11)

#[napi]
pub fn capture_screen(display_id: u32) -> Buffer { ... }
// Retorna PNG/JPEG raw bytes

#[napi]
pub fn capture_region(x: i32, y: i32, w: i32, h: i32) -> Buffer { ... }

#[napi]
pub fn capture_window(window_id: u32) -> Buffer { ... }

#[napi]
pub fn start_continuous_capture(fps: u32, callback: JsFunction) -> CaptureHandle { ... }
// Para el vision pipeline continuo — invoca callback con cada frame

#[napi]
pub fn stop_continuous_capture(handle: CaptureHandle) { ... }
```

**Requisitos de performance:**

- Captura a **30fps** mínimo para desktop completo (1920x1080)
- **60fps** para regiones pequeñas (500x500)
- Formato: raw BGRA → JPEG con calidad 80 para enviar al VLM
- Usar memoria compartida (mmap) para evitar copias entre Rust y Node

#### 1.1.3 — Input Injection (`input.rs`)

```rust
// macOS: CGEventCreateMouseEvent / CGEventCreateKeyboardEvent
// Windows: SendInput API

#[napi]
pub fn mouse_move(x: f64, y: f64) { ... }

#[napi]
pub fn mouse_click(x: f64, y: f64, button: String) { ... }

#[napi]
pub fn mouse_double_click(x: f64, y: f64) { ... }

#[napi]
pub fn mouse_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) { ... }

#[napi]
pub fn mouse_scroll(x: f64, y: f64, delta_x: i32, delta_y: i32) { ... }

#[napi]
pub fn keyboard_type(text: String) { ... }
// Debe manejar Unicode completo (emoji, CJK, etc.)

#[napi]
pub fn keyboard_press(key: String, modifiers: Vec<String>) { ... }
// modifiers: ["cmd", "shift", "alt", "ctrl"]

#[napi]
pub fn keyboard_hotkey(keys: Vec<String>) { ... }
// e.g., ["cmd", "c"] para copy
```

### 1.2 — TypeScript Wrapper (`server/native/index.ts`)

**Instrucciones:**

1. Crear wrapper TypeScript que abstrae la capa nativa:

   ```typescript
   // server/native/index.ts
   import { NativeBridge } from '../../native'; // el addon Rust compilado

   export class DesktopController {
     // Abstrae platform-specific detrás de interfaz uniforme
     async click(x: number, y: number, opts?: ClickOptions): Promise<void>;
     async type(text: string): Promise<void>;
     async hotkey(...keys: string[]): Promise<void>;
     async screenshot(region?: Region): Promise<Buffer>;
     async getElementAt(x: number, y: number): Promise<UIElement>;
     async getAccessibilityTree(pid?: number): Promise<UIElement[]>;
     async findElement(query: ElementQuery): Promise<UIElement | null>;
     async getActiveWindow(): Promise<WindowInfo>;
     async listWindows(): Promise<WindowInfo[]>;
     // ...
   }
   ```

2. Migrar TODO el código que actualmente usa:
   - `@nut-tree-fork/nut-js` → `NativeBridge`
   - `osascript` calls → `NativeBridge.accessibility` o `NativeBridge.applescript`
   - `server/services/macOSBridge.ts` → eliminar, mover a `NativeBridge`
   - `server/services/systemControl.ts` → refactorear sobre `DesktopController`

### 1.3 — Refactorear `macosNativeTools.ts`

**Archivo existente:** `server/agent/tools/macosNativeTools.ts` (659 líneas)

**Instrucciones:**

1. Cambiar todas las implementaciones de AppleScript a llamadas del `NativeBridge`
2. Añadir tools que faltan:
   - `file_manager` — operaciones de Finder avanzadas
   - `process_manager` — kill, signal, nice, lsof
   - `network_control` — DNS, proxy, firewall rules
   - `display_control` — resolución, arrangement, night shift
   - `power_management` — sleep, wake schedule, caffeinate
   - `user_defaults` — leer/escribir preferencias de apps
   - `keychain_access` — leer passwords (con auth del usuario)
   - `notification_center` — leer notificaciones recientes
   - `spotlight_query` — búsquedas avanzadas via MDQuery
   - `disk_management` — mount, unmount, disk info, SMART

---

## FASE 2: VISION PIPELINE CONTINUO

### Semana 3-5 | Equipos: ML/Vision + Backend

### Prioridad: 🔴 CRÍTICA

### 2.1 — Continuous Screen Analysis Engine

**Archivos a crear:**

```
server/vision/
├── captureLoop.ts          # Loop de captura a 1-5 fps
├── frameDiffer.ts           # Detecta cambios significativos entre frames
├── elementDetector.ts       # Detección de UI elements via VLM o modelo local
├── accessibilityFusion.ts   # Fusiona Accessibility Tree + Vision
├── stateTracker.ts          # Mantiene estado del desktop en tiempo real
├── actionPredictor.ts       # Predice siguiente acción basado en contexto
└── index.ts
```

**Instrucciones:**

#### 2.1.1 — Capture Loop (`captureLoop.ts`)

```typescript
/**
 * Loop de captura inteligente:
 * - Captura a 1 fps en idle
 * - Sube a 5 fps cuando detecta actividad
 * - Sube a 15 fps durante ejecución de acciones del agente
 * - Usa frame differencing para no procesar frames idénticos
 */

export class CaptureLoop {
  private fps: number = 1;
  private running: boolean = false;
  private lastFrame: Buffer | null = null;

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      const frame = await nativeBridge.captureScreen(0);
      const diff = this.calculateDiff(frame, this.lastFrame);

      if (diff > CHANGE_THRESHOLD) {
        await this.eventBus.emit('vision.frame.new', {
          frame,
          timestamp: Date.now(),
          changePercent: diff,
        });
      }

      this.lastFrame = frame;
      await sleep(1000 / this.fps);
    }
  }

  // Frame differencing usando pixel sampling (rápido)
  private calculateDiff(a: Buffer, b: Buffer | null): number {
    if (!b) return 1.0;
    // Comparar ~1000 pixels aleatorios, retornar % de cambio
    // Usar SIMD via Rust para performance
  }
}
```

#### 2.1.2 — VLM Frame Analysis

**Usar Gemini 2.0 Flash (barato, rápido, 1M tokens) para análisis de frames:**

```typescript
/**
 * Analiza cada frame significativo con el VLM.
 * Extrae:
 * - Lista de ventanas visibles y su contenido
 * - Estado de la UI (botones, inputs, menús abiertos)
 * - Texto visible (OCR implícito del VLM)
 * - Contexto semántico ("usuario está editando código en VS Code")
 */

export class VLMAnalyzer {
  private model = 'gemini-2.0-flash'; // rápido + barato para frames

  async analyzeFrame(frame: Buffer, context: AgentContext): Promise<FrameAnalysis> {
    const response = await this.llm.invoke([
      {
        role: 'system',
        content: FRAME_ANALYSIS_PROMPT, // Ver abajo
      },
      {
        role: 'user',
        content: [
          { type: 'image', data: frame.toString('base64') },
          { type: 'text', text: `Context: ${JSON.stringify(context)}` }
        ]
      }
    ]);

    return this.parseFrameAnalysis(response);
  }
}
```

**FRAME_ANALYSIS_PROMPT:**

```
You are a desktop UI analyzer. Given a screenshot, extract:

1. WINDOWS: List all visible windows with:
   - app name, title, position, size, z-order
   - is_focused: boolean

2. UI_ELEMENTS: All interactive elements visible:
   - type (button, input, menu, dropdown, checkbox, link, tab)
   - label/text
   - bounding_box: {x, y, width, height}
   - state (enabled, disabled, checked, selected, hovered)
   - center_point: {x, y} — for clicking

3. TEXT_CONTENT: All readable text, organized by region

4. SEMANTIC_STATE: One-sentence description of what the user is doing

5. ACTIONABLE_ITEMS: Things the agent could interact with, ranked by relevance

Respond in JSON format.
```

#### 2.1.3 — Grounding DINO / YOLO para Detección Local (sin API)

**Para reducir costos y latencia cuando no necesitamos el VLM completo:**

```
npm install onnxruntime-node
```

1. Descargar modelo ONNX de **GroundingDINO** (detección de objetos por texto)
2. Pipeline:
   - Frame → GroundingDINO("button", "input field", "menu") → bounding boxes
   - Solo enviar al VLM cuando GroundingDINO tiene baja confianza
3. Alternativa: **YOLO-World** (más rápido, open-vocabulary)

#### 2.1.4 — Accessibility Tree Fusion

```typescript
/**
 * Combina la información del Accessibility Tree nativo con
 * la detección visual del VLM para crear un mapa unificado
 * de la UI con máxima precisión.
 *
 * El AT da: roles, labels, values, states, actions
 * El VLM da: posición visual exacta, contexto semántico, OCR
 *
 * La fusión corrige errores de ambos:
 * - AT a veces tiene labels vacíos → VLM puede leerlos visualmente
 * - VLM a veces confunde posiciones → AT tiene coordenadas exactas
 */

export class AccessibilityFusion {
  async getUnifiedUIState(): Promise<UnifiedUIState> {
    const [accessibilityTree, visionAnalysis] = await Promise.all([
      this.nativeBridge.getAccessibilityTree(),
      this.vlmAnalyzer.analyzeCurrentFrame(),
    ]);

    return this.merge(accessibilityTree, visionAnalysis);
  }
}
```

### 2.2 — Desktop State Machine

**Archivo:** `server/vision/stateTracker.ts`

```typescript
/**
 * Mantiene un modelo del estado del desktop en tiempo real.
 * Actualizado por cada frame analizado.
 *
 * Estados:
 * - IDLE: No hay actividad significativa
 * - USER_ACTIVE: Usuario interactuando manualmente
 * - AGENT_EXECUTING: Agente ejecutando acciones
 * - WAITING_RESPONSE: Esperando que algo cargue/responda
 * - ERROR_DETECTED: Se detectó un error/dialog inesperado
 * - VERIFICATION: Verificando que la acción tuvo el efecto esperado
 */

export class DesktopStateTracker {
  private state: DesktopState = 'IDLE';
  private history: StateTransition[] = [];
  private windows: Map<number, WindowState> = new Map();
  private focusedApp: string | null = null;
  private mousePosition: { x: number; y: number } = { x: 0, y: 0 };

  // Llamado por el capture loop en cada frame significativo
  async updateFromFrame(analysis: FrameAnalysis): Promise<void> {
    const previousState = this.state;
    this.state = this.inferState(analysis);

    if (this.state !== previousState) {
      this.history.push({
        from: previousState,
        to: this.state,
        timestamp: Date.now(),
        trigger: analysis.semanticState,
      });

      await this.eventBus.emit('vision.state.changed', {
        from: previousState,
        to: this.state,
      });
    }
  }
}
```

---

## FASE 3: AUTONOMOUS BRAIN v2

### Semana 4-6 | Equipos: AI/ML + Backend Core

### Prioridad: 🟠 ALTA

### 3.1 — Reescribir `autonomousAgentBrain.ts` con Active Inference

**Archivo existente:** `server/agent/computerUse/autonomousAgentBrain.ts` (1,087 líneas)

**Concepto de Active Inference:**
En vez del loop ReAct simple (Think→Act→Observe), implementar un modelo basado en **Free Energy Principle**:

- El agente mantiene un **modelo generativo** del mundo (qué espera ver)
- Compara con la **observación real** (lo que realmente ve en pantalla)
- Minimiza la **sorpresa** (free energy) ejecutando acciones que hacen que el mundo se parezca a su modelo deseado

```typescript
/**
 * Active Inference Brain v2
 *
 * Loop:
 * 1. PREDICT: Generar predicción de lo que debería verse en pantalla
 * 2. OBSERVE: Capturar el estado real del desktop
 * 3. COMPARE: Calcular "surprise" (divergencia predicción vs realidad)
 * 4. PLAN: Si hay surprise, generar plan para resolverla
 * 5. ACT: Ejecutar la acción que minimice surprise
 * 6. VERIFY: Confirmar que la acción redujo surprise
 * 7. UPDATE: Actualizar el modelo generativo con lo aprendido
 */

export class ActiveInferenceBrain {
  private generativeModel: WorldModel;
  private beliefState: BeliefState;
  private policyTree: PolicyTree;

  async executionLoop(goal: AgentGoal): Promise<ExecutionResult> {
    let iteration = 0;
    const MAX_ITERATIONS = goal.constraints.maxActions;

    while (iteration < MAX_ITERATIONS) {
      // 1. Predict
      const prediction = await this.generativeModel.predict(
        this.beliefState,
        goal
      );

      // 2. Observe
      const observation = await this.visionPipeline.getUnifiedUIState();

      // 3. Calculate surprise (KL divergence)
      const surprise = this.calculateFreeEnergy(prediction, observation);

      if (surprise < GOAL_ACHIEVED_THRESHOLD) {
        return { success: true, iterations: iteration };
      }

      // 4. Plan — generate action policies that minimize expected free energy
      const policies = await this.policyTree.generatePolicies(
        this.beliefState,
        observation,
        goal,
        { maxDepth: 3, branchFactor: 5 }
      );

      // 5. Select best policy (lowest expected free energy)
      const bestPolicy = this.selectPolicy(policies);

      // 6. Execute first action of best policy
      const action = bestPolicy.actions[0];
      await this.executeAction(action);

      // 7. Verify
      await sleep(500); // Wait for UI to update
      const postActionState = await this.visionPipeline.getUnifiedUIState();
      const postSurprise = this.calculateFreeEnergy(prediction, postActionState);

      // 8. Update beliefs
      this.beliefState.update(observation, action, postActionState);
      this.generativeModel.learn(observation, action, postActionState);

      // Log for telemetry
      await this.telemetry.log({
        iteration,
        surprise,
        postSurprise,
        action: action.description,
        surpriseReduction: surprise - postSurprise,
      });

      iteration++;
    }

    return { success: false, iterations: iteration, reason: 'max_iterations' };
  }
}
```

### 3.2 — Policy Tree con Monte Carlo Tree Search

```typescript
/**
 * Genera árboles de decisión usando MCTS adaptado:
 * - Simula secuencias de acciones usando el modelo generativo
 * - Evalúa cada secuencia por su "expected free energy" (bajo = mejor)
 * - Usa UCB1 para balancear exploración vs explotación
 */

export class PolicyTree {
  async generatePolicies(
    belief: BeliefState,
    observation: UIState,
    goal: AgentGoal,
    opts: { maxDepth: number; branchFactor: number }
  ): Promise<Policy[]> {
    const root = new MCTSNode(belief, observation);

    for (let sim = 0; sim < 100; sim++) { // 100 simulaciones
      let node = root;

      // Selection
      while (node.isFullyExpanded() && !node.isTerminal()) {
        node = node.selectChild(); // UCB1
      }

      // Expansion
      if (!node.isTerminal()) {
        const actions = await this.generatePossibleActions(
          node.state,
          goal,
          opts.branchFactor
        );
        node = node.expand(actions[0]);
      }

      // Simulation (rollout using generative model)
      const reward = await this.simulate(node, goal, opts.maxDepth);

      // Backpropagation
      node.backpropagate(reward);
    }

    return root.getBestPolicies(5); // Top 5 policies
  }
}
```

### 3.3 — Multi-Agent Swarm para Tareas Complejas

**Archivo existente:** `server/services/multiAgentCollaboration.ts`

**Extender con protocolo de delegación:**

```typescript
/**
 * Cuando una tarea es demasiado compleja para un solo agente,
 * el Brain la descompone y delega sub-tareas a agentes especializados:
 *
 * - ResearchAgent: Busca información en web/documentos
 * - BrowserAgent: Navega y extrae datos de sitios web
 * - CodeAgent: Escribe, compila y ejecuta código
 * - DocumentAgent: Genera documentos (Word, Excel, PPT, PDF)
 * - SystemAgent: Controla el desktop (mouse, keyboard, apps)
 * - CommunicationAgent: Envía emails, mensajes, notificaciones
 *
 * Protocolo:
 * 1. Brain descompone goal → sub-goals
 * 2. Asigna sub-goals a agentes especializados
 * 3. Agentes reportan progreso via Event Bus
 * 4. Brain monitorea y re-planifica si algo falla
 * 5. Resultados se fusionan en respuesta final
 */
```

---

## FASE 4: CROSS-PLATFORM HAL

### Semana 5-8 | Equipos: Windows + Systems

### Prioridad: 🟡 MEDIA

### 4.1 — Windows UIAutomation

**Archivo:** `native/src/platform/windows/uiautomation.rs`

**Instrucciones:**

1. Usar la crate `windows-rs` para COM interop:

   ```toml
   [target.'cfg(target_os = "windows")'.dependencies]
   windows = { version = "0.58", features = [
     "Win32_UI_Accessibility",
     "Win32_Foundation",
     "Win32_System_Com",
     "Win32_Graphics_Gdi",
     "Win32_UI_WindowsAndMessaging",
     "Win32_UI_Input_KeyboardAndMouse",
   ]}
   ```

2. Implementar las mismas interfaces que macOS Accessibility:

   ```rust
   #[napi]
   pub fn get_focused_element_win() -> UIElement { ... }
   // Usar IUIAutomation::GetFocusedElement

   #[napi]
   pub fn get_element_at_position_win(x: f64, y: f64) -> UIElement { ... }
   // Usar IUIAutomation::ElementFromPoint

   #[napi]
   pub fn get_element_tree_win(hwnd: i64) -> Vec<UIElement> { ... }
   // TreeWalker + IUIAutomationElement
   ```

### 4.2 — Windows Screen Capture (DXGI)

```rust
// Usar Desktop Duplication API (DirectX 11)
// Es la forma más rápida de capturar pantalla en Windows
// Soporta hardware acceleration

#[napi]
pub fn capture_screen_win(monitor: u32) -> Buffer {
    // IDXGIOutputDuplication::AcquireNextFrame
    // ID3D11Texture2D → staging texture → map → copy bytes
}
```

### 4.3 — Unified HAL Interface

**Archivo:** `server/native/hal.ts`

```typescript
/**
 * Hardware Abstraction Layer — interfaz única independiente de plataforma.
 * Detecta el OS y delega al bridge nativo correcto.
 */

export interface IHAL {
  // Input
  mouse: IMouseController;
  keyboard: IKeyboardController;

  // Screen
  screen: IScreenController;

  // Accessibility
  accessibility: IAccessibilityController;

  // System
  system: ISystemController;

  // Files
  files: IFileController;

  // Platform info
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  version: string;
}

export function createHAL(): IHAL {
  switch (process.platform) {
    case 'darwin': return new MacOSHAL();
    case 'win32': return new WindowsHAL();
    default: throw new Error(`Platform ${process.platform} not supported`);
  }
}
```

---

## FASE 5: PERSISTENCE & TELEMETRY

### Semana 6-8 | Equipos: Backend + Data Engineering

### Prioridad: 🟡 MEDIA

### 5.1 — Telemetry Database (ClickHouse)

**¿Por qué ClickHouse?** Optimizado para time-series, puede almacenar semanas de telemetría con queries ultra-rápidos.

**Instrucciones:**

1. Añadir ClickHouse al docker-compose:

   ```yaml
   clickhouse:
     image: clickhouse/clickhouse-server:24.3
     ports:
       - "8123:8123"   # HTTP
       - "9000:9000"   # Native
     volumes:
       - clickhouse_data:/var/lib/clickhouse
     environment:
       CLICKHOUSE_DB: iliagpt_telemetry
   ```

2. Schema de tablas:

   ```sql
   -- Acciones del agente
   CREATE TABLE agent_actions (
     timestamp DateTime64(3),
     session_id String,
     agent_id String,
     action_type String,          -- 'click', 'type', 'screenshot', 'api_call'
     action_params String,        -- JSON
     result String,               -- JSON
     duration_ms UInt32,
     surprise_before Float32,
     surprise_after Float32,
     success UInt8
   ) ENGINE = MergeTree()
   ORDER BY (timestamp, session_id);

   -- Frames de vision
   CREATE TABLE vision_frames (
     timestamp DateTime64(3),
     frame_id String,
     change_percent Float32,
     elements_detected UInt16,
     semantic_state String,
     focused_app String,
     analysis_ms UInt32
   ) ENGINE = MergeTree()
   ORDER BY timestamp
   TTL timestamp + INTERVAL 2 WEEK;  -- Auto-cleanup después de 2 semanas

   -- System metrics
   CREATE TABLE system_metrics (
     timestamp DateTime64(3),
     cpu_percent Float32,
     memory_used_mb UInt32,
     gpu_percent Float32,
     disk_io_read_mb Float32,
     disk_io_write_mb Float32,
     network_rx_mb Float32,
     network_tx_mb Float32,
     active_processes UInt16
   ) ENGINE = MergeTree()
   ORDER BY timestamp
   TTL timestamp + INTERVAL 4 WEEK;
   ```

### 5.2 — Telemetry Dashboard

**Archivos a crear:**

```
client/src/pages/telemetry/
├── TelemetryDashboard.tsx     # Layout principal
├── AgentActivityTimeline.tsx   # Timeline de acciones
├── VisionFrameViewer.tsx       # Viewer de screenshots con annotations
├── SystemMetricsChart.tsx      # CPU/Memory/GPU en tiempo real
├── TaskProgressTracker.tsx     # Estado de tareas activas
├── SurpriseGraph.tsx           # Gráfica de free energy over time
└── AgentDecisionTree.tsx       # Visualización del árbol MCTS
```

**Tecnología frontend:**

- Gráficas: **Apache ECharts** (mejor que Chart.js para time-series pesados)
- Timeline: **vis-timeline** o custom con D3
- Real-time updates: via WebSocket desde el Event Bus

### 5.3 — Session Persistence para Tareas Largas

```typescript
/**
 * Permite que el agente trabaje por días/semanas en una tarea sin perder estado.
 *
 * Checkpoint system:
 * - Guarda estado completo del agente cada 5 minutos
 * - Incluye: belief state, memory, plan tree, action history
 * - Permite resume después de crash/restart
 * - Diff-based para minimizar storage
 */

export class SessionPersistence {
  private checkpointInterval = 5 * 60 * 1000; // 5 min

  async saveCheckpoint(state: AgentState): Promise<string> {
    const checkpoint = {
      id: randomUUID(),
      timestamp: Date.now(),
      beliefState: state.beliefs,
      memory: state.memory.serialize(),
      planTree: state.planTree.serialize(),
      actionHistory: state.actionHistory.slice(-1000), // últimas 1000 acciones
      visionState: state.visionState,
    };

    // Guardar en PostgreSQL (JSON comprimido con zstd)
    await db.insert(agentCheckpoints).values({
      ...checkpoint,
      data: zstdCompress(JSON.stringify(checkpoint)),
    });

    return checkpoint.id;
  }

  async resume(checkpointId: string): Promise<AgentState> {
    const checkpoint = await db.query.agentCheckpoints.findFirst({
      where: eq(agentCheckpoints.id, checkpointId),
    });
    return this.deserialize(zstdDecompress(checkpoint.data));
  }
}
```

---

## FASE 6: DESKTOP APP NATIVA

### Semana 7-10 | Equipos: Desktop + Frontend

### Prioridad: 🟡 MEDIA

### 6.1 — Electron App Completa

**Archivo existente:** `desktop/main.js` (básico, 80 líneas)

**Reescribir completamente:**

```
desktop/
├── main.ts                    # Main process (TypeScript)
├── preload.ts                 # Context bridge
├── renderer/                  # UI del overlay
│   ├── overlay.html           # HUD transparente sobre el desktop
│   ├── overlay.ts             # Lógica del overlay
│   └── styles.css
├── services/
│   ├── trayManager.ts         # System tray icon + menu
│   ├── globalShortcuts.ts     # Atajos globales (Cmd+Shift+I para activar)
│   ├── autoUpdater.ts         # Auto-actualización
│   ├── permissionManager.ts   # Solicitar permisos de Accessibility, Screen Recording
│   └── daemonConnector.ts     # Conexión al daemon via Unix socket
├── ipc/
│   ├── handlers.ts            # IPC handlers main ↔ renderer
│   └── protocol.ts            # Custom protocol (iliagpt://)
└── build/
    ├── entitlements.mac.plist  # Entitlements para macOS code signing
    ├── icon.icns               # App icon macOS
    └── icon.ico                # App icon Windows
```

**Features requeridos:**

1. **Overlay transparente** — ventana siempre visible (como un HUD) que muestra:
   - Estado del agente (idle, working, waiting)
   - Progreso de tareas actuales
   - Miniatura de lo que el agente "ve"
   - Input field para dar comandos rápidos

2. **System Tray** — icono con menú para:
   - Start/Stop agente
   - Ver dashboard
   - Configuración
   - Logs

3. **Global Shortcuts:**
   - `Cmd+Shift+I` — Toggle overlay
   - `Cmd+Shift+A` — Activar agente con selección de pantalla
   - `Cmd+Shift+S` — Screenshot + analyze

4. **Permission Manager:**
   - Al primer inicio, solicitar: Accessibility, Screen Recording, Full Disk Access
   - Guiar al usuario con instrucciones visuales paso a paso

### 6.2 — Instalador

**macOS:** usar `electron-builder` con:

- DMG con background image
- Code signing + notarization
- Auto-updater via GitHub Releases

**Windows:** usar `electron-builder` con:

- NSIS installer
- Code signing con EV certificate
- Auto-updater

---

## FASE 7: COMPLETAR 1000+ CAPACIDADES

### Semana 8-12 | TODOS los equipos

### Prioridad: 🟠 ALTA

### Capacidades que FALTAN (organizadas por categoría)

Referencia: `PLAN_1000_CAPACIDADES.md`

#### 7.1 — Investigación Académica (completar el 40% faltante)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0013 | Detección peer-reviewed | Crossref API → `is_peer_reviewed` flag |
| 0016 | OCR de PDFs escaneados | Tesseract WASM o Google Vision API |
| 0021-0024 | Análisis IMRyD, comparación, contradicciones | Prompt engineering sobre LLM + structured output |
| 0030-0037 | MLA/Vancouver/BibTeX/RIS formatters | Implementar `server/services/citationFormatters/` |
| 0042-0050 | Versionado, alertas, meta-análisis | Redis pub/sub + cron para alertas, R/Python para meta-análisis |

#### 7.2 — Browser Automation (completar el 55% faltante)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0126-0135 | Proxy rotation, CAPTCHA solving | Integrar 2Captcha API + proxy pool service |
| 0136-0145 | Form auto-fill inteligente | VLM analiza form → mapea campos → auto-fill |
| 0146-0160 | Web scraping ético avanzado | Rate limiter + robots.txt parser + politeness delay |

#### 7.3 — Generación de Documentos (completar 30% faltante)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0200-0220 | Templates avanzados Word/Excel/PPT | Extender `perfectDocumentGenerator.ts` |
| 0221-0240 | Diagramas (Mermaid, PlantUML, D3) | Server-side rendering con Puppeteer |
| 0241-0260 | LaTeX rendering | KaTeX server-side, o compilar con `tectonic` |

#### 7.4 — Comunicación (nuevo)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0400-0420 | Email (Gmail, Outlook, IMAP) | Extender `gmailService.ts` + añadir IMAP genérico |
| 0421-0440 | WhatsApp Business API | Via Baileys o WhatsApp Cloud API |
| 0441-0460 | Telegram Bot | Via `grammy` o `telegraf` |
| 0461-0480 | Slack integration | Via Slack Bolt SDK |
| 0481-0500 | Calendar management | Google Calendar API + Apple Calendar via AppleScript |

#### 7.5 — Control del Sistema (extender lo existente)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0600-0620 | File manager avanzado | Búsqueda, organización, dedup, sync |
| 0621-0640 | Process orchestration | PM2-style pero integrado |
| 0641-0660 | Network diagnostics | ping, traceroute, DNS, port scan |
| 0661-0680 | Security scanner | Nmap integration, vulnerability check |
| 0681-0700 | Backup automation | rsync wrapper, Time Machine trigger |

#### 7.6 — Data Analysis & Visualization (nuevo)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0700-0730 | Statistical analysis | Python bridge (scipy, pandas, numpy) |
| 0731-0760 | Chart generation | ECharts server-side rendering |
| 0761-0780 | Database querying | Natural language → SQL via LLM |
| 0781-0800 | Data cleaning/transformation | Pandas via Python sandbox |

#### 7.7 — Code Development (nuevo)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0800-0830 | Code generation | Multi-file generation con LLM |
| 0831-0860 | Code review | AST analysis + LLM review |
| 0861-0880 | Git operations | Via `simple-git` |
| 0881-0900 | Build & deploy | Docker build, CI/CD trigger |
| 0901-0920 | Testing | Auto-generate tests, run suites |

#### 7.8 — IoT & Hardware (nuevo)

| Cap # | Descripción | Implementación |
| ------- | ------------- | --------------- |
| 0920-0950 | Smart home control | HomeKit via HAP-NodeJS, MQTT |
| 0951-0970 | Camera feeds | RTSP/ONVIF integration |
| 0971-1000 | Device management | USB, Bluetooth, network devices |

---

## ASIGNACIÓN DE EQUIPOS

```text
┌─────────────────────────────────────────────────────────────────┐
│                    ESTRUCTURA DE EQUIPOS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EQUIPO 1: NATIVE/SYSTEMS (Rust + C/C++)                       │
│  ├── Rust addon (NAPI-RS)                                      │
│  ├── macOS: Accessibility API, CoreGraphics, IOKit             │
│  ├── Windows: UIAutomation, Win32, DXGI                        │
│  ├── Screen capture de alto rendimiento                        │
│  └── Input injection (CGEvent / SendInput)                     │
│  Tecnologías: Rust, NAPI-RS, Objective-C (bridging), C++      │
│                                                                 │
│  EQUIPO 2: VISION / ML                                         │
│  ├── Continuous capture loop                                   │
│  ├── Frame differencing (SIMD)                                 │
│  ├── VLM integration (Gemini Flash para análisis)              │
│  ├── GroundingDINO / YOLO-World local                          │
│  ├── Accessibility fusion                                      │
│  └── OCR pipeline                                              │
│  Tecnologías: ONNX Runtime, Gemini API, OpenCV (optional)      │
│                                                                 │
│  EQUIPO 3: AI / COGNITIVE CORE                                 │
│  ├── Active Inference Brain                                    │
│  ├── MCTS Policy Tree                                          │
│  ├── World Model (generative)                                  │
│  ├── Multi-agent swarm orchestration                           │
│  ├── Learning system (reward model)                            │
│  └── Memory hierarchy (working → episodic → semantic)          │
│  Tecnologías: LangChain/LangGraph, TypeScript, Python          │
│                                                                 │
│  EQUIPO 4: BACKEND CORE                                        │
│  ├── RPC server (WebSocket + MessagePack)                      │
│  ├── Event Bus unificado                                       │
│  ├── System daemon (LaunchDaemon / Windows Service)            │
│  ├── Session persistence + checkpointing                       │
│  ├── API routes nuevas                                         │
│  └── Database migrations                                       │
│  Tecnologías: Node.js, Express, PostgreSQL, Redis, ClickHouse  │
│                                                                 │
│  EQUIPO 5: DESKTOP APP                                         │
│  ├── Electron rewrite                                          │
│  ├── Overlay HUD transparente                                  │
│  ├── System tray + global shortcuts                            │
│  ├── Permission manager                                        │
│  ├── Auto-updater                                              │
│  └── Installers (DMG + NSIS)                                   │
│  Tecnologías: Electron, TypeScript, HTML/CSS                   │
│                                                                 │
│  EQUIPO 6: FRONTEND / DASHBOARD                                │
│  ├── Telemetry dashboard                                       │
│  ├── Agent activity timeline                                   │
│  ├── Vision frame viewer con annotations                       │
│  ├── System metrics charts                                     │
│  ├── Decision tree visualizer                                  │
│  └── Real-time WebSocket updates                               │
│  Tecnologías: React, ECharts, D3.js, vis-timeline              │
│                                                                 │
│  EQUIPO 7: CAPABILITIES (x6 sub-equipos)                      │
│  ├── Sub-equipo Research: capacidades 0001-0100                │
│  ├── Sub-equipo Browser: capacidades 0101-0200                 │
│  ├── Sub-equipo Documents: capacidades 0201-0400               │
│  ├── Sub-equipo Communication: capacidades 0401-0600           │
│  ├── Sub-equipo System: capacidades 0601-0800                  │
│  └── Sub-equipo Code/Data: capacidades 0801-1000               │
│  Tecnologías: TypeScript, Python, APIs externas                │
│                                                                 │
│  EQUIPO 8: QA / TESTING                                        │
│  ├── Test harness para cada capability                         │
│  ├── Integration tests (Playwright E2E)                        │
│  ├── Performance benchmarks                                    │
│  ├── Security audits                                           │
│  └── Mantener >5000 tests passing                              │
│  Tecnologías: Vitest, Playwright, k6                           │
│                                                                 │
│  EQUIPO 9: DEVOPS / INFRA                                      │
│  ├── CI/CD pipeline (GitHub Actions)                           │
│  ├── Docker multi-arch builds                                  │
│  ├── ClickHouse deployment                                     │
│  ├── Monitoring (Grafana + Prometheus)                         │
│  └── Release management                                        │
│  Tecnologías: Docker, GitHub Actions, Terraform                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## STACK TECNOLÓGICO DEFINITIVO

| Capa | Tecnología | Versión Mínima | Propósito |
| ------ | ----------- | ---------------- | ----------- |
| **Runtime** | Node.js | 22 LTS | Backend principal |
| **Language** | TypeScript | 5.4+ | Type safety |
| **Native Addons** | Rust + NAPI-RS | 1.78+ / 3.0+ | FFI a APIs del SO |
| **Frontend** | React + Vite | 19 / 6+ | UI web |
| **Desktop** | Electron | 33+ | App nativa |
| **AI Framework** | LangChain + LangGraph | 0.3+ | Agent orchestration |
| **VLM** | Gemini 2.0 Flash | - | Frame analysis (barato, rápido) |
| **VLM Heavy** | Gemini 3.1 Pro / Claude Opus | - | Planning complejo |
| **Local Vision** | ONNX Runtime + GroundingDINO | 1.19+ | Detección sin API |
| **DB Principal** | PostgreSQL + pgvector | 16+ | Data + embeddings |
| **Cache** | Redis | 7+ | Session state, pub/sub |
| **Telemetry DB** | ClickHouse | 24.3+ | Time-series analytics |
| **Search** | Meilisearch | 1.7+ | Full-text search |
| **Message Format** | MessagePack | - | RPC binario |
| **Transport** | WebSocket + gRPC | - | RPC bidireccional |
| **Charts** | Apache ECharts | 5.5+ | Telemetry dashboard |
| **Testing** | Vitest + Playwright | 2+ / 1.40+ | Unit + E2E |
| **Build** | esbuild + electron-builder | - | Compilación rápida |
| **CI/CD** | GitHub Actions | - | Automation |
| **Python** | Python 3.12 + FastAPI | - | Data science tools |
| **OCR** | Tesseract WASM | 5+ | Offline OCR |

---

## MÉTRICAS DE ÉXITO

### Milestone 1 (Semana 4): Foundation

- [ ] Daemon corriendo como LaunchDaemon
- [ ] Rust addon compilando con Accessibility API funcional
- [ ] Screen capture nativo a 30fps
- [ ] >5500 tests passing

### Milestone 2 (Semana 6): Vision + Brain

- [ ] Vision pipeline capturando y analizando frames continuamente
- [ ] Active Inference Brain ejecutando tareas simples (abrir app, click en botón)
- [ ] Telemetry dashboard mostrando acciones en tiempo real
- [ ] >6000 tests passing

### Milestone 3 (Semana 8): Cross-Platform + Persistence

- [ ] Windows HAL funcional (UIAutomation + DXGI capture)
- [ ] Checkpointing de sesiones largas
- [ ] ClickHouse almacenando semanas de telemetría
- [ ] 600+ capacidades implementadas
- [ ] >7000 tests passing

### Milestone 4 (Semana 10): Desktop App

- [ ] Electron app con overlay, tray, shortcuts
- [ ] Instalador macOS (DMG) + Windows (NSIS)
- [ ] Auto-updater funcional
- [ ] 800+ capacidades implementadas
- [ ] >8000 tests passing

### Milestone 5 (Semana 12): Full Hypervisor

- [ ] 1000+ capacidades implementadas y testeadas
- [ ] Agente autónomo completando tareas de 30+ minutos sin intervención
- [ ] Cross-platform (macOS + Windows) funcional
- [ ] Telemetría de días/semanas funcionando
- [ ] Performance: <100ms latencia de acción, <500ms para análisis de frame
- [ ] >10,000 tests passing

---

## COMANDOS PARA EMPEZAR AHORA MISMO

```bash
# 1. Setup del proyecto Rust nativo
cd "/Users/ale/Desktop/ILIACODEX V2"
mkdir -p native/src/platform/{macos,windows}
mkdir -p native/src/vision
cd native
cargo init --lib
cargo add napi napi-derive
cargo add core-foundation core-graphics --target 'cfg(target_os = "macos")'

# 2. Setup ClickHouse para telemetría
docker pull clickhouse/clickhouse-server:24.3
# Añadir al docker-compose.infra.yml

# 3. Setup de la carpeta del daemon
mkdir -p daemon
# Crear daemon/index.ts

# 4. Setup del vision pipeline
mkdir -p server/vision
# Crear los 6 archivos listados en Fase 2

# 5. Correr tests existentes para confirmar baseline
npm run test:run
```

---

**NOTA FINAL:** Este documento es el blueprint. Cada equipo debe crear su propio `IMPLEMENTATION_NOTES.md` dentro de su carpeta con decisiones técnicas específicas, blockers encontrados, y progreso diario. Reportar en daily standups contra los milestones de arriba.

**El objetivo no es código perfecto — es un hipervisor funcional en 12 semanas.**
