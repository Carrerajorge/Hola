import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

export class SecureFileGateway {
  private allowedRoots: string[];

  constructor(additionalRoots: string[] = []) {
    // Por defecto: Workspace actual y Home del usuario (solo lectura en Home excepto Downloads/Desktop)
    this.allowedRoots = [
      process.cwd(),
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Downloads"),
      path.join(os.homedir(), "Documents"),
      ...additionalRoots
    ].map(p => path.resolve(p));
  }

  public resolvePath(userInputPath: string): string {
    // Normalizar y resolver ruta
    let targetPath = userInputPath;
    
    // Expandir ~
    if (targetPath.startsWith("~")) {
      targetPath = path.join(os.homedir(), targetPath.slice(1));
    }

    const resolved = path.resolve(targetPath);

    // Verificar Sandboxing (Must be inside allowed roots)
    const isAllowed = this.allowedRoots.some(root => {
      const relative = path.relative(root, resolved);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });

    if (!isAllowed) {
      throw new Error(`[SecurityAlert] Access Denied: Path '${userInputPath}' is outside allowed security boundaries.`);
    }

    return resolved;
  }

  public async validateFileAccess(filePath: string, mode: "read" | "write" | "execute"): Promise<void> {
    const resolved = this.resolvePath(filePath);
    
    // Bloqueo de archivos sensibles del sistema (Shadow IT)
    const sensitivePatterns = [
        /\.ssh\//, /\.aws\//, /\.env/, /\.kube\//, 
        /\/etc\//, /\/var\//, /\.git\//
    ];

    if (sensitivePatterns.some(p => p.test(resolved))) {
        throw new Error(`[SecurityAlert] Access Denied: Path contains sensitive system patterns.`);
    }

    try {
        await fs.access(resolved);
    } catch {
        // Si es escritura, el archivo puede no existir aún, lo cual es válido si el padre existe
        if (mode === "write") {
            const dir = path.dirname(resolved);
            try {
                await fs.access(dir);
            } catch {
                throw new Error(`[FileGateway] Parent directory does not exist: ${dir}`);
            }
        } else {
            throw new Error(`[FileGateway] File not found: ${resolved}`);
        }
    }
  }
}

export const fsGateway = new SecureFileGateway();
