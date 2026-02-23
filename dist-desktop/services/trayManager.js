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
    // Generar icono neutro o de recursos (Placeholder temporal en runtime)
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
    // Si falla cargar local, usamos empty image map para el Tray en dev
    let icon;
    try {
        icon = electron_1.nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
    }
    catch (e) {
        // Fallback transparent buffer
        icon = electron_1.nativeImage.createEmpty();
    }
    const tray = new electron_1.Tray(icon);
    tray.setToolTip('ILIA Autonomous Brain');
    const contextMenu = electron_1.Menu.buildFromTemplate([
        {
            label: 'Toggle HUD',
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
            label: 'Start Agent',
            click: () => console.log('Starting Agent Activity...')
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => electron_1.app.quit()
        }
    ]);
    tray.setContextMenu(contextMenu);
    return tray;
}
