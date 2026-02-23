import { z } from 'zod';
import { AgentCapability } from '../registry';
import { chromium, Browser, Page } from 'playwright';

// Re-use browser instance across calls for performance
let globalBrowser: Browser | null = null;

export const webScraperCapability: AgentCapability = {
    name: "extract_webpage_content",
    description: "Visita una URL web usando un navegador Chromium headless y extrae el texto legible (innerText), ignorando todo el código HTML/CSS/JS. Usar para obtener información de noticias, documentación, o investigar a la competencia.",
    schema: z.object({
        url: z.string().url().describe("La dirección web completa a visitar, por ejemplo 'https://en.wikipedia.org/wiki/Active_inference'"),
        timeoutMs: z.number().optional().default(15000).describe("Milisegundos máximos a esperar a que la página cargue.")
    }),
    execute: async ({ url, timeoutMs }) => {
        let page: Page | null = null;
        try {
            console.log(`[Browser Submodule] Navigating to: ${url}`);

            if (!globalBrowser) {
                globalBrowser = await chromium.launch({ headless: true });
            }

            const context = await globalBrowser.newContext({
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" // Basic anti-bot evasion
            });

            page = await context.newPage();

            // Go to URL and wait until DOM is mostly quiet
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs || 15000 });

            // Clean up common noise elements before extracting text
            await page.evaluate(() => {
                const noiseSelectors = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'nav', 'footer', '.ad', '#cookie-banner'];
                noiseSelectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                });
            });

            // Extract raw readable text
            const content = await page.evaluate(() => {
                return document.body.innerText;
            });

            // Compress whitespace and truncate if extremely large (to protect LLM context window)
            const cleanContent = content.replace(/\s+/g, ' ').trim();
            const MAX_CHARS = 25000;

            await context.close();

            return {
                url,
                length: cleanContent.length,
                content: cleanContent.length > MAX_CHARS
                    ? cleanContent.substring(0, MAX_CHARS) + "\n...[TRUNCATED_DUE_TO_SIZE]"
                    : cleanContent,
                success: true
            };

        } catch (error: any) {
            console.error("[Browser Submodule Error]", error.message);
            if (page) await page.context().close();

            return {
                error: `Failed to load URL. ${error.message}`,
                diagnostics: "La web puede requerir Captcha, estar caída, o tu timeout fue muy corto."
            };
        }
    }
};
