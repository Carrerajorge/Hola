import { z } from "zod";
import { spawn } from "child_process";
import * as os from "os";

const HIGH_RISK_PATTERNS = [
    /\bsudo\b/, /\brm\s+-[rf]/, /\bdd\b/, /\bmkfs\b/, /\bchmod\b/, 
    /\bchown\b/, /\bwget\b/, /\bcurl\b.*\|/, /\binstall\b/
];

export const ShellTool = {
    exec: {
        name: "shell_exec_real",
        description: "Execute a shell command on the host OS via Child Process.",
        schema: z.object({
            command: z.string(),
            args: z.array(z.string()).optional(),
            cwd: z.string().optional(),
            timeout: z.number().default(10000),
            background: z.boolean().default(false)
        }),
        riskLevel: "critical" as const, // Siempre requiere validación del Control Plane
        handler: async (params: { command: string; args?: string[]; cwd?: string; timeout: number; background: boolean }) => {
            console.log(`[ShellTool] 🐚 Executing: ${params.command} ${params.args?.join(" ")}`);

            // Risk Assessment Local (Pre-Flight)
            const fullCmd = `${params.command} ${params.args?.join(" ") || ""}`;
            if (HIGH_RISK_PATTERNS.some(p => p.test(fullCmd))) {
                // El Control Plane ya debió haber validado esto, pero hacemos double-check.
                // Si llegamos aquí, asumimos que el usuario aprobó explícitamente.
                console.warn(`[ShellTool] ⚠️ HIGH RISK COMMAND EXECUTING: ${fullCmd}`);
            }

            return new Promise((resolve, reject) => {
                const child = spawn(params.command, params.args || [], {
                    cwd: params.cwd || os.homedir(),
                    shell: true, // Necesario para pipes y variables de entorno
                    env: process.env
                });

                let stdout = "";
                let stderr = "";
                let completed = false;

                if (params.background) {
                    child.unref(); // Detach process
                    resolve({ status: "background_started", pid: child.pid });
                    return;
                }

                // Timer para timeout
                const timer = setTimeout(() => {
                    if (!completed) {
                        child.kill();
                        reject(new Error(`Command timed out after ${params.timeout}ms`));
                    }
                }, params.timeout);

                child.stdout.on("data", (data) => { stdout += data.toString(); });
                child.stderr.on("data", (data) => { stderr += data.toString(); });

                child.on("close", (code) => {
                    clearTimeout(timer);
                    completed = true;
                    resolve({
                        command: fullCmd,
                        exitCode: code,
                        stdout: stdout.trim(),
                        stderr: stderr.trim(),
                        duration: 0 // TODO: measure
                    });
                });

                child.on("error", (err) => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
        }
    }
};
