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
exports.setupTray = setupTray;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const main_1 = require("../main");
function setupTray() {
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
    let icon;
    try {
        icon = electron_1.nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
    }
    catch (e) {
        icon = electron_1.nativeImage.createEmpty();
    }
    const tray = new electron_1.Tray(icon);
    tray.setToolTip('ILIAGPT v2.1.0 — Agente Autónomo');
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: '🧠 Abrir Panel Administrativo',
            click: () => {
                const main = (0, main_1.getMainWindow)();
                if (main) {
                    main.show();
                    main.focus();
                }
                else {
                    // Re-create if closed
                    const { createMainWindow } = require('../main');
                    if (typeof createMainWindow === 'function')
                        createMainWindow();
                }
            }
        },
        {
            label: '🌐 Panel en Navegador',
            click: () => {
                const panelUrl = process.env.ILIAGPT_PANEL_URL || 'https://iliagpt.com';
                electron_1.shell.openExternal(panelUrl);
            }
        },
        { type: 'separator' },
        {
            label: '👁 Toggle Overlay HUD',
            click: () => {
                const overlay = (0, main_1.getOverlayWindow)();
                if (overlay) {
                    if (overlay.isVisible())
                        overlay.hide();
                    else
                        overlay.showInactive();
                }
            }
        },
        {
            label: '🤖 Iniciar Agente Autónomo',
            click: () => {
                const main = (0, main_1.getMainWindow)();
                if (main) {
                    main.webContents.executeJavaScript(`
                        fetch('/api/agent/start', { method: 'POST' })
                            .then(r => r.json())
                            .then(d => console.log('Agent started:', d))
                            .catch(e => console.error('Agent start failed:', e));
                    `);
                }
            }
        },
        { type: 'separator' },
        {
            label: 'ILIAGPT v2.1.0',
            enabled: false
        },
        {
            label: 'Salir',
            click: () => electron_1.app.quit()
        }
    ]);
    tray.setContextMenu(contextMenu);
    // Double-click tray opens main window
    tray.on('double-click', () => {
        const main = (0, main_1.getMainWindow)();
        if (main) {
            main.show();
            main.focus();
        }
    });
    return tray;
}
