"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOverlayWindow = getOverlayWindow;
exports.getMainWindow = getMainWindow;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const trayManager_1 = require("./services/trayManager");
const globalShortcuts_1 = require("./services/globalShortcuts");
const handlers_1 = require("./ipc/handlers");
const autoUpdater_1 = require("./services/autoUpdater");
let overlayWindow = null;
let mainWindow = null;
let tray = null;
const PANEL_URL = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';
function getOverlayWindow() {
    return overlayWindow;
}
function getMainWindow() {
    return mainWindow;
}
function createMainWindow() {
    const isDev = !electron_1.app.isPackaged;
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title: 'ILIAGPT — Panel Administrativo',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#09090b',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    const panelUrl = isDev ? 'http://localhost:5050' : PANEL_URL;
    mainWindow.loadURL(panelUrl);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Show window when ready to avoid white flash
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
}
function createOverlayWindow() {
    overlayWindow = new electron_1.BrowserWindow({
        width: 400, // HUD Dimensions
        height: 800,
        x: 0,
        y: 100,
        transparent: true,
        frame: false,
        alwaysOnTop: true, // HUD is always above
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // compiled preload
            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    // Make window click-through so user can interact with their desktop
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    // En producción, conecta al panel administrativo real (iliagpt.com)
    // En desarrollo, usa el servidor local
    const isDev = !electron_1.app.isPackaged;
    const PANEL_URL = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';
    const url = isDev ? 'http://localhost:5050?mode=overlay' : `${PANEL_URL}?mode=overlay`;
    overlayWindow.loadURL(url);
    // Permitir clics SOLO en la ventana, gobernado temporalmente por React via IPC (luego)
    // overlayWindow.setIgnoreMouseEvents(false);
}
const child_process_1 = require("child_process");
let backendProcess = null;
function startBackendServer() {
    const isPackaged = electron_1.app.isPackaged;
    if (isPackaged) {
        // En producción, el servidor compilado está en dist/index.cjs relativo al asar
        const serverPath = path.join(process.resourcesPath, 'app.asar', 'dist', 'index.cjs');
        console.log("Iniciando MICHAT Backend en:", serverPath);
        backendProcess = (0, child_process_1.fork)(serverPath, [], {
            env: { ...process.env, NODE_ENV: 'production' },
            stdio: 'inherit'
        });
    }
    else {
        console.log("Entorno de desarrollo: Se espera que 'npm run dev' esté corriendo el servidor.");
    }
}
electron_1.app.whenReady().then(() => {
    if (electron_1.app.isPackaged) {
        (0, autoUpdater_1.setupAutoUpdater)();
    }
    // Crear ventana principal conectada al panel administrativo
    createMainWindow();
    // Overlay HUD para control autónomo (opcional, activable desde tray)
    // createOverlayWindow();
    tray = (0, trayManager_1.setupTray)();
    (0, globalShortcuts_1.setupGlobalShortcuts)(overlayWindow);
    (0, handlers_1.registerIpcHandlers)(overlayWindow);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('will-quit', () => {
    // cleanup global shortcuts
    if (backendProcess) {
        backendProcess.kill();
    }
});
