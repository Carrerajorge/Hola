import { app, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { getOverlayWindow } from '../main';

export function setupTray(): Tray {
    // Generar icono neutro o de recursos (Placeholder temporal en runtime)
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');

    // Si falla cargar local, usamos empty image map para el Tray en dev
    let icon;
    try {
        icon = nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
    } catch (e) {
        // Fallback transparent buffer
        icon = nativeImage.createEmpty();
    }

    const tray = new Tray(icon);
    tray.setToolTip('ILIA Autonomous Brain');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Toggle HUD',
            click: () => {
                const overlay = getOverlayWindow();
                if (overlay) {
                    if (overlay.isVisible()) overlay.hide();
                    else overlay.showInactive();
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
            click: () => app.quit()
        }
    ]);

    tray.setContextMenu(contextMenu);

    return tray;
}
