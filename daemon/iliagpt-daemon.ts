/**
 * ILIAGPT System Daemon (Nivel 0 / LaunchDaemon)
 * Auto-start, Watchdog, Crash Recovery, Privilege Escalation.
 *
 * Expone un Unix Socket `/var/run/iliagpt.sock` o Named Pipe en Windows,
 * para ejecutar directivas hiper-privilegiadas usando el Puente Nativo (Rust).
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';

console.log("Starting ILIAGPT System Daemon...");

// Determinar el puente correcto basado en el tipo de host NAPI
let nativeBridge: any = null;
try {
    // Tratamos de resolver el addon empaquetado por esbuild o compilado
    nativeBridge = require('../native/iliagpt-native.node');
    console.log("[Daemon] Rust Native Addon cargado satisfactoriamente.");
} catch (e: any) {
    console.error("[Daemon] FAIL: No se pudo cargar el addon iligpt-native.node. Asegurate de compilar el binding de Rust.", e.message);
}

const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\iliagpt-ipc'
    : '/var/run/iliagpt.sock';

if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) {
    try { fs.unlinkSync(SOCKET_PATH); } catch (e) {
        console.error("No se pudo limpiar socket", e);
    }
}

// Watchdog memory tracking
let watchdogInterval: NodeJS.Timer;

const server = net.createServer((socket) => {
    socket.on('data', async (data) => {
        const msgs = data.toString().split('\n').filter(s => s.trim().length > 0);

        for (const msg of msgs) {
            try {
                const req = JSON.parse(msg);
                if (!req.id || !req.action) continue;

                if (!nativeBridge) {
                    throw new Error("El Native Bridge de Rust está ausente o no compila correctamente en este Host.");
                }

                let payload = null;

                switch (req.action) {
                    case "mouse_click":
                        payload = await nativeBridge.mouseClick(req.payload.x, req.payload.y, req.payload.button || 1);
                        break;
                    case "keyboard_type":
                        payload = await nativeBridge.keyboardType(req.payload.text);
                        break;
                    case "keyboard_press": // e.g cmd+c
                        payload = await nativeBridge.keyboardHotkey(req.payload.keyName.split('+'));
                        break;
                    case "capture_screen":
                        const buf = await nativeBridge.captureScreen(0);
                        payload = buf.toString('base64');
                        break;
                    case "get_focused_element":
                        payload = await nativeBridge.getFocusedElement();
                        break;
                    case "get_element_tree":
                        payload = await nativeBridge.getElementTree(0);
                        break;
                    case "list_windows":
                        payload = [];
                        break;
                    case "execute_applescript":
                        payload = await nativeBridge.executeApplescript(req.payload.script || "");
                        break;
                    default:
                        throw new Error(`Accion desconocida: ${req.action}`);
                }

                const response = JSON.stringify({ id: req.id, success: true, payload }) + '\n';
                socket.write(response);

            } catch (error: any) {
                try {
                    // Manda error formateado en JSON
                    const reqParse = JSON.parse(msg);
                    socket.write(JSON.stringify({ id: reqParse.id, success: false, error: error.message }) + '\n');
                } catch (e) { }
            }
        }
    });

    socket.on('error', (err) => console.warn('[Daemon] Client Socket Error:', err));
});

server.listen(SOCKET_PATH, () => {
    console.log(`[Daemon] Router escuchando en ${SOCKET_PATH}`);
    if (os.platform() !== 'win32') {
        try { fs.chmodSync(SOCKET_PATH, 0o666); }
        catch (e) { console.warn("No se pudo cambiar los permisos del socket."); }
    }
});

watchdogInterval = setInterval(() => {
    const mem = process.memoryUsage();
    // Memory leak protection - AutoRestart si el daemon pasa de 1GB RAM.
    if (mem.rss > 1024 * 1024 * 1024) {
        console.error("[Daemon Watchdog] Exceso de memoria, suicidándose para invocar System Restart.");
        process.exit(1);
    }
}, 30000) as any;

process.on('SIGTERM', () => {
    console.log('SIGTERM recibido, cerrando daemon...');
    clearInterval(watchdogInterval as any);
    server.close(() => {
        if (os.platform() !== 'win32' && fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
        process.exit(0);
    });
});
