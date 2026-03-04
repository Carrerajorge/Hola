import { z } from "zod";

// Helper para limpiar HTML básico (sin dependencias externas)
function extractTextFromHtml(html: string): string {
    // Eliminar scripts y estilos
    let text = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
    text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "");
    
    // Extraer body
    const bodyMatch = text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/im);
    if (bodyMatch) text = bodyMatch[1];

    // Eliminar tags HTML
    text = text.replace(/<[^>]+>/g, " ");
    // Normalizar espacios
    text = text.replace(/\s+/g, " ").trim();
    
    return text;
}

// Helper para metadatos de YouTube
async function fetchYoutubeMetadata(url: string) {
    try {
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AgentOS/1.0)" } });
        const html = await response.text();
        
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        const descMatch = html.match(/"shortDescription":"(.*?)"/);
        
        return {
            title: titleMatch ? titleMatch[1].replace(" - YouTube", "") : "Unknown Title",
            description: descMatch ? descMatch[1] : "No description available",
            duration: "Unknown" // Difícil sin API key o parsing complejo
        };
    } catch (e) {
        return { title: "Error fetching video", description: "" };
    }
}

// #21 Ingesta de YouTube (Híbrida: Real Metadata + Mock Transcript)
export const YouTubeTranscriptTool = {
  name: "youtube_transcript",
  description: "Extract metadata and transcript from a YouTube video URL",
  schema: z.object({ url: z.string().url() }),
  riskLevel: "low" as const,
  handler: async (params: { url: string }) => {
    console.log(`[DataTools] 📺 Fetching YouTube data for ${params.url}`);
    
    // 1. Obtener metadatos reales
    const metadata = await fetchYoutubeMetadata(params.url);
    
    // 2. Transcript (Aún simulado porque requiere API compleja/puppeteer)
    // En prod: conectar a servicio de transcripción o API oficial
    const mockTranscript = `[00:00] Start of video '${metadata.title}'...\n[00:30] Discussion about the topic...`;

    return {
        title: metadata.title,
        description: metadata.description,
        transcript: mockTranscript,
        source: params.url
    };
  }
};

// #22 Chat con Excel/CSV (JS-based SQL simulation mejorada)
export const CsvSqlTool = {
  name: "csv_sql_query",
  description: "Query CSV data using simulated SQL-like logic",
  schema: z.object({
    csvContent: z.string().optional(),
    csvPath: z.string().optional(),
    query: z.string()
  }),
  riskLevel: "medium" as const,
  handler: async (params: { csvContent?: string; csvPath?: string; query: string }) => {
    console.log(`[DataTools] 📊 Parsing CSV & Executing: ${params.query}`);
    
    let content = params.csvContent;
    if (!content && params.csvPath) {
        // Intentar leer archivo localmente si estamos en ActionPlane
        try {
            const fs = require('fs');
            content = fs.readFileSync(params.csvPath, 'utf-8');
        } catch (e) {
            throw new Error("Could not read CSV file");
        }
    }
    if (!content) throw new Error("No CSV content provided");

    // 1. Parse CSV to JSON
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj: any = {};
        headers.forEach((h, i) => {
            const val = vals[i]?.trim();
            obj[h] = isNaN(Number(val)) ? val : Number(val);
        });
        return obj;
    });

    // 2. Ejecutar lógica simple (SQL dummy mejorado)
    const q = params.query.toLowerCase();
    let result = rows;
    
    // WHERE simple
    if (q.includes("where")) {
        // Implementación muy básica de filtrado, para demo
        // En prod: usar alasql
    }

    if (q.includes("count")) return [{ count: rows.length }];
    if (q.includes("limit")) {
        const limitMatch = q.match(/limit\s+(\d+)/);
        const limit = limitMatch ? parseInt(limitMatch[1]) : 5;
        result = rows.slice(0, limit);
    }
    
    return result;
  }
};

// #23 Crawler (Real Fetch)
export const WebCrawlerTool = {
  name: "web_deep_crawl",
  description: "Crawl a URL and extract clean text content",
  schema: z.object({ url: z.string().url(), maxDepth: z.number().default(1) }),
  riskLevel: "medium" as const,
  handler: async (params: { url: string }) => {
    console.log(`[DataTools] 🕷️ Crawling ${params.url} (Real Fetch)`);
    
    try {
        const response = await fetch(params.url, { 
            headers: { 
                "User-Agent": "Mozilla/5.0 (compatible; AgentOSbot/1.0)",
                "Accept": "text/html"
            } 
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const text = extractTextFromHtml(html);
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : params.url;

        return {
            status: "success",
            url: params.url,
            title: title,
            content: text.slice(0, 5000), // Limit characters
            length: text.length
        };

    } catch (e: any) {
        console.error(`[DataTools] Crawl failed: ${e.message}`);
        return { status: "error", error: e.message };
    }
  }
};
