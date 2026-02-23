"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Escuchar mensajes del proceso principal (Node) al Renderizador
    onNativeAction: (callback) => electron_1.ipcRenderer.on('native-action', callback),
    // Mandar mensajes desde React (Renderizador) hacía Node
    agentStarted: () => electron_1.ipcRenderer.send('agent:started'),
    agentStopped: () => electron_1.ipcRenderer.send('agent:stopped'),
    // Requerir información cruda del OS
    getSystemVolume: () => electron_1.ipcRenderer.invoke('system:getVolume'),
    // Toggle Ignore Mouse Events (Para la transparencia overlay)
    setIgnoreMouseEvents: (ignore) => electron_1.ipcRenderer.send('window:setIgnoreMouseEvents', ignore)
});
