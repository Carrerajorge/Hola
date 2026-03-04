import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Helper: Generar HTML profesional con estilos de impresión
function createProfessionalReport(title: string, markdownContent: string): string {
    const date = new Date().toLocaleDateString();
    // Convertir Markdown básico a HTML (simulado para headers y listas)
    let htmlContent = markdownContent
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
        .replace(/\*(.*)\*/gim, '<i>$1</i>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br />');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>${title} | IliaGPT</title>
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px; }
            h1 { color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            h2 { color: #e67e22; margin-top: 30px; }
            .meta { color: #7f8c8d; font-size: 0.9em; margin-bottom: 40px; }
            .footer { margin-top: 50px; font-size: 0.8em; text-align: center; color: #aaa; border-top: 1px solid #eee; padding-top: 20px; }
            @media print {
                body { padding: 0; max-width: 100%; }
                .no-print { display: none; }
            }
        </style>
    </head>
    <body>
        <h1>${title}</h1>
        <div class="meta">Generado por IliaGPT • ${date}</div>
        <div class="content">
            ${htmlContent}
        </div>
        <div class="footer">
            Documento generado automáticamente por IliaGPT Enterprise AI.
        </div>
    </body>
    </html>
    `;
}

// #47 Generador de Reportes (Real File)
export const PdfReportTool = {
  name: "generate_report_file",
  description: "Generate a downloadable professional report (HTML/PDF-ready)",
  schema: z.object({
    title: z.string(),
    content: z.string(), // Markdown text
    filename: z.string().optional()
  }),
  riskLevel: "low" as const,
  handler: async (params: { title: string; content: string; filename?: string }) => {
    console.log(`[BusinessTools] 📄 Creating real report: ${params.title}`);
    
    const html = createProfessionalReport(params.title, params.content);
    const name = (params.filename || params.title).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Guardar en carpeta pública temporal para acceso
    // Asumimos que 'public' existe o usamos /tmp
    const outputDir = path.join(process.cwd(), "public", "reports");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const filePath = path.join(outputDir, `${name}.html`);
    fs.writeFileSync(filePath, html);
    
    // Retornar ruta relativa para que el frontend pueda linkearlo
    return { 
        status: "created",
        url: `/reports/${name}.html`,
        localPath: filePath,
        format: "html (print-to-pdf ready)"
    };
  }
};

// #42 Agente de Email (Generador de Drafts .eml reales)
// Esto es mucho más seguro que enviar correos ciegamente. Genera un archivo que el usuario puede abrir.
export const EmailTool = {
  name: "create_email_draft",
  description: "Create a real email draft file (.eml) that can be opened in Outlook/Mail",
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string()
  }),
  riskLevel: "low" as const,
  handler: async (params: { to: string; subject: string; body: string }) => {
    console.log(`[BusinessTools] 📧 Creating .eml draft for ${params.to}`);
    
    const emlContent = `To: ${params.to}
Subject: ${params.subject}
X-Unsent: 1
Content-Type: text/plain; charset=UTF-8

${params.body}
`;
    
    const name = `draft_${Date.now()}`;
    const outputDir = path.join(process.cwd(), "public", "drafts");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const filePath = path.join(outputDir, `${name}.eml`);
    fs.writeFileSync(filePath, emlContent);
    
    return {
        status: "draft_created",
        url: `/drafts/${name}.eml`,
        message: "Draft file created. User can click to open in default mail client."
    };
  }
};

// #48 Agente de Compras (Mock robusto)
export const PriceCheckTool = {
  name: "price_check",
  description: "Check prices for a product across multiple stores",
  schema: z.object({
    productName: z.string(),
    region: z.string().default("US")
  }),
  riskLevel: "low" as const,
  handler: async (params: any) => {
    // En prod: Scraper real. Aquí simulamos datos variados para la UI.
    const basePrice = Math.floor(Math.random() * 500) + 50;
    return {
        product: params.productName,
        bestPrice: basePrice,
        currency: "USD",
        stores: [
            { name: "Amazon", price: basePrice * 1.05, inStock: true },
            { name: "eBay", price: basePrice, inStock: true, condition: "Refurbished" },
            { name: "Official Store", price: basePrice * 1.2, inStock: false }
        ],
        timestamp: new Date().toISOString()
    };
  }
};
