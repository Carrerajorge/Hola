"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAutoUpdater = setupAutoUpdater;
const electron_updater_1 = require("electron-updater");
const electron_1 = require("electron");
function setupAutoUpdater() {
    electron_updater_1.autoUpdater.autoDownload = false; // Ask user before downloading
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        electron_1.dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: `Version ${info.version} of the Autonomous Brain is available.`,
            detail: 'Would you like to download it now?',
            buttons: ['Download', 'Later']
        }).then((result) => {
            if (result.response === 0) {
                electron_updater_1.autoUpdater.downloadUpdate();
            }
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', () => {
        electron_1.dialog.showMessageBox({
            title: 'Install Updates',
            message: 'Updates downloaded. The application will restart to apply them.',
        }).then(() => {
            setImmediate(() => electron_updater_1.autoUpdater.quitAndInstall());
        });
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        console.error('Error in auto-updater.', err);
    });
    // Initiate check
    electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch(err => console.error("Update Check Failed", err));
}
