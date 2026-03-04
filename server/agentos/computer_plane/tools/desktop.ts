import { z } from "zod";
import { spawn } from "child_process";

// Wrapper para AppleScript via osascript
async function runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn("osascript", ["-e", script]);
        let out = "";
        let err = "";
        
        child.stdout.on("data", d => out += d);
        child.stderr.on("data", d => err += d);
        
        child.on("close", (code) => {
            if (code !== 0) reject(new Error(`AppleScript error: ${err}`));
            else resolve(out.trim());
        });
    });
}

export const DesktopTool = {
    // Control de Ventanas
    window: {
        name: "desktop_window_control",
        description: "List or focus application windows on macOS.",
        schema: z.object({
            action: z.enum(["list", "focus", "close"]),
            appName: z.string().optional()
        }),
        riskLevel: "medium" as const,
        handler: async (params: { action: string; appName?: string }) => {
            if (params.action === "list") {
                const script = `
                    tell application "System Events"
                        set procs to processes whose background only is false
                        set visibleProcs to {}
                        repeat with proc in procs
                            set end of visibleProcs to name of proc
                        end repeat
                        return visibleProcs
                    end tell
                `;
                const result = await runAppleScript(script);
                return { windows: result.split(",").map(s => s.trim()) };
            }
            
            if (params.action === "focus" && params.appName) {
                const script = `tell application "${params.appName}" to activate`;
                await runAppleScript(script);
                return { status: "focused", app: params.appName };
            }
            
            return { error: "Invalid action or missing params" };
        }
    },

    // Teclado y Ratón (Básico)
    input: {
        name: "desktop_send_keys",
        description: "Send keystrokes to the active window.",
        schema: z.object({
            text: z.string(),
            enter: z.boolean().default(true)
        }),
        riskLevel: "high" as const, // Riesgo de escribir en chat equivocado
        handler: async (params: { text: string; enter: boolean }) => {
            // Escape quotes for AppleScript
            const safeText = params.text.replace(/"/g, '\\"');
            let script = `tell application "System Events" to keystroke "${safeText}"`;
            if (params.enter) {
                script += `\ntell application "System Events" to key code 36`; // Enter
            }
            
            await runAppleScript(script);
            return { status: "sent" };
        }
    },

    // Notificaciones
    notify: {
        name: "desktop_notify",
        description: "Show a native notification.",
        schema: z.object({
            title: z.string(),
            message: z.string()
        }),
        riskLevel: "low" as const,
        handler: async (params: { title: string; message: string }) => {
            const script = `display notification "${params.message}" with title "${params.title}"`;
            await runAppleScript(script);
            return { status: "displayed" };
        }
    }
};
