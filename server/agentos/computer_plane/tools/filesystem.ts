import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { fsGateway } from "../security/fs_gateway";

// Tipos de contenido soportados para lectura inteligente
type FileContent = {
    path: string;
    content: string; // Base64 si es binario, texto si es legible
    type: "text" | "binary";
    mime?: string;
    size: number;
    lastModified: Date;
};

export const FileSystemTool = {
    // Lectura Inteligente
    read: {
        name: "fs_read_file",
        description: "Read a local file securely. Detects text/binary automatically.",
        schema: z.object({
            path: z.string()
        }),
        riskLevel: "medium" as const,
        handler: async (params: { path: string }) => {
            console.log(`[FileSystem] 📂 Reading: ${params.path}`);
            const resolved = fsGateway.resolvePath(params.path);
            await fsGateway.validateFileAccess(resolved, "read");

            const stats = await fs.stat(resolved);
            if (stats.size > 10 * 1024 * 1024) { // 10MB Limit
                throw new Error("File too large for inline reading. Use streaming or chunking.");
            }

            // Detección binaria simple
            const buffer = await fs.readFile(resolved);
            const isBinary = buffer.includes(0); // Null byte check
            
            return {
                path: resolved,
                size: stats.size,
                lastModified: stats.mtime,
                type: isBinary ? "binary" : "text",
                content: isBinary ? buffer.toString("base64") : buffer.toString("utf-8")
            };
        }
    },

    // Escritura Atómica
    write: {
        name: "fs_write_file",
        description: "Write content to a local file securely (Overwrites).",
        schema: z.object({
            path: z.string(),
            content: z.string()
        }),
        riskLevel: "high" as const,
        handler: async (params: { path: string; content: string }) => {
            console.log(`[FileSystem] 💾 Writing to: ${params.path}`);
            const resolved = fsGateway.resolvePath(params.path);
            
            // Verificación extra para escritura
            await fsGateway.validateFileAccess(resolved, "write");

            await fs.writeFile(resolved, params.content, "utf-8");
            return { status: "success", bytesWritten: Buffer.byteLength(params.content) };
        }
    },

    // Listado
    list: {
        name: "fs_list_dir",
        description: "List contents of a directory.",
        schema: z.object({
            path: z.string()
        }),
        riskLevel: "low" as const,
        handler: async (params: { path: string }) => {
            const resolved = fsGateway.resolvePath(params.path);
            await fsGateway.validateFileAccess(resolved, "read");
            
            const entries = await fs.readdir(resolved, { withFileTypes: true });
            return entries.map(e => ({
                name: e.name,
                type: e.isDirectory() ? "directory" : "file",
                path: path.join(resolved, e.name)
            }));
        }
    }
};
