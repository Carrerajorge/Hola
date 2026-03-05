import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const LIVEKIT_DIR = path.resolve(import.meta.dirname, '../../external/livekit');
const OUTPUT_BIN = path.resolve(import.meta.dirname, '../../bin/livekit-server');

export async function buildLivekitServer(): Promise<void> {
    console.log('🔄 Checking LiveKit WebRTC server binary...');

    // 1. Revisa si el binario ya existe para no compilar cada vez
    if (fs.existsSync(OUTPUT_BIN)) {
        console.log('✅ LiveKit binary already exists at:', OUTPUT_BIN);
        return;
    }

    console.log('🏗️  Compiling LiveKit server from Go source (this may take a minute)...');

    if (!fs.existsSync(LIVEKIT_DIR)) {
        throw new Error(`LiveKit source not found at ${LIVEKIT_DIR}. Please run clone first.`);
    }

    // Crea la carpeta bin/ si no existe
    const binDir = path.dirname(OUTPUT_BIN);
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        // 2. Ejecuta go build apuntando al directorio fuente
        const goBuild = spawn('go', ['build', '-o', OUTPUT_BIN, './cmd/server'], {
            cwd: LIVEKIT_DIR,
            stdio: 'inherit',
            env: { ...process.env, CGO_ENABLED: '1' }
        });

        goBuild.on('close', (code) => {
            if (code === 0) {
                console.log('✅ LiveKit compiled successfully!');
                resolve();
            } else {
                console.error(`❌ LiveKit compilation failed with code ${code}`);
                reject(new Error(`Go build failed with code ${code}`));
            }
        });

        goBuild.on('error', (err) => {
            console.error('❌ Failed to start Go compilation:', err);
            reject(err);
        });
    });
}

import { fileURLToPath } from 'url';

// Permitir ejecución directa del script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildLivekitServer().catch(console.error);
}
