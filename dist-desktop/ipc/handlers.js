"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
function registerIpcHandlers(overlayWindow) {
    if (!overlayWindow)
        return;
    electron_1.ipcMain.handle('system:getVolume', async () => {
        // En Fase 4 hicimos Node Fetch, aquí se usaría un daemon bridge o similar
        // Para este HUD, servirá de ping test
        return 100;
    });
    electron_1.ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
        // Si el usuario posiciona el MOUSE sobre un Widget de React en el HUD, 
        // cancelamos click-through para que pueda presionarlo. 
        // Si sale de él, devolvemos a "ignore" (transparente a clicks de atrás).
        let win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (win) {
            win.setIgnoreMouseEvents(ignore, { forward: true });
            console.log(`[IPC] HUD Click-Through Ignored = ${ignore}`);
        }
    });
    electron_1.ipcMain.on('agent:started', () => {
        console.log('[IPC] Renderer reports: Agent ACTIVE');
        // Tray icon podría pintarse rojo
    });
    electron_1.ipcMain.on('agent:stopped', () => {
        console.log('[IPC] Renderer reports: Agent STOPPED');
        // Tray icon podría volver a neutro
    });
}
