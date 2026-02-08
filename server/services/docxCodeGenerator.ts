/**
 * DOCX Code Generator Service
 * 
 * Generates JavaScript code using the docx library based on document descriptions,
 * then executes it in a sandbox to produce professional Word documents.
 */

import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, convertInchesToTwip } from 'docx';
import OpenAI from 'openai';
import * as vm from 'vm';

const xaiClient = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

/**
 * Template examples for different document types
 */
const DOCUMENT_TEMPLATES = {
    solicitud: `
// Ejemplo: Solicitud Formal
new Document({
    sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "SOLICITUD DE PERMISO", bold: true, size: 32 })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Fecha: _______________________" })] }),
            new Paragraph({ children: [new TextRun({ text: "A: ", bold: true }), new TextRun({ text: "_________________________________________________" })] }),
            // Más campos...
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "_________________________________" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Firma del Solicitante" })] }),
        ]
    }]
})`,
    contrato: `
// Ejemplo: Contrato
new Document({
    sections: [{
        children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CONTRATO DE SERVICIOS", bold: true, size: 32 })] }),
            new Paragraph({ children: [new TextRun({ text: "CLÁUSULA PRIMERA: ", bold: true }), new TextRun({ text: "Descripción del servicio..." })] }),
            // Firmas de ambas partes
            new Paragraph({ children: [new TextRun({ text: "EL CONTRATANTE" })] }),
            new Paragraph({ children: [new TextRun({ text: "_________________________________" })] }),
        ]
    }]
})`,
    informe: `
// Ejemplo: Informe Técnico
new Document({
    sections: [{
        children: [
            new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "INFORME TÉCNICO" })] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "1. INTRODUCCIÓN" })] }),
            new Paragraph({ children: [new TextRun({ text: "Contenido del informe..." })] }),
            // Tablas de datos
            new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Dato" })] })] })] })] }),
        ]
    }]
})`
};

/**
 * Generate JavaScript code for a DOCX document
 */
export async function generateDocxCode(description: string, documentType: string = 'general'): Promise<string> {
    console.log(`[DocxCodeGenerator] Generating code for: "${description.substring(0, 50)}..."`);

    const template = DOCUMENT_TEMPLATES[documentType as keyof typeof DOCUMENT_TEMPLATES] || DOCUMENT_TEMPLATES.solicitud;

    const prompt = `Genera código JavaScript COMPLETO usando la librería 'docx' para crear:

**Documento solicitado:** ${description}

**REGLAS ESTRICTAS:**
1. Usa SOLO estas importaciones (ya están disponibles):
   - Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, convertInchesToTwip

2. Crea un documento profesional en ESPAÑOL con:
   - Título centrado en negrita
   - Campos para completar con líneas: "___________________________________________"
   - Espacios para firma con líneas centradas
   - Si aplica, casillas: "☐ Opción A   ☐ Opción B"
   - Secciones claras con encabezados

3. El código debe ser UNA función async llamada \`createDocument\` que retorna el Document:

\`\`\`javascript
async function createDocument() {
    const doc = new Document({
        styles: { default: { document: { run: { font: "Arial", size: 24 } } } },
        sections: [{
            properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
            children: [
                // Contenido aquí
            ]
        }]
    });
    return doc;
}
\`\`\`

4. NO uses require() ni import - las clases ya están disponibles globalmente

**EJEMPLO DE REFERENCIA:**
${template}

**IMPORTANTE:** 
- Genera un documento COMPLETO y PROFESIONAL
- Incluye TODOS los campos relevantes para: ${description}
- Usa tamaños de fuente apropiados (24 para texto, 32 para títulos)
- Agrega espaciado entre secciones ({ spacing: { after: 200 } })

Responde SOLO con el código JavaScript de la función createDocument, sin explicaciones.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: DEFAULT_MODEL,
            messages: [
                {
                    role: "system",
                    content: "Eres un experto en generar código JavaScript para documentos Word usando la librería docx. Generas documentos profesionales con campos rellenables, firmas y formato corporativo."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 4096,
        });

        let code = response.choices[0].message.content || '';

        // Clean up the code
        code = code.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();

        console.log(`[DocxCodeGenerator] Generated code length: ${code.length} chars`);

        return code;
    } catch (error: any) {
        console.error('[DocxCodeGenerator] Error generating code:', error.message);
        throw new Error(`Failed to generate document code: ${error.message}`);
    }
}

/** Maximum code length to prevent abuse */
const MAX_CODE_LENGTH = 50_000;
/** Execution timeout in milliseconds */
const EXECUTION_TIMEOUT_MS = 15_000;

/** Patterns that indicate dangerous code (process access, file system, network) */
const FORBIDDEN_PATTERNS = [
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\bchild_process\b/,
    /\bfs\b\./,
    /\beval\b/,
    /\bFunction\b/,
    /\bglobal\b/,
    /\bglobalThis\b/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
    /\bfetch\b/,
    /\bXMLHttpRequest\b/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\.constructor\s*\(/,
];

/**
 * Validate code before execution - prevent dangerous patterns
 */
function validateCode(code: string): { safe: boolean; reason?: string } {
    if (!code || typeof code !== 'string') {
        return { safe: false, reason: 'Code must be a non-empty string' };
    }
    if (code.length > MAX_CODE_LENGTH) {
        return { safe: false, reason: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters` };
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(code)) {
            return { safe: false, reason: `Code contains forbidden pattern: ${pattern.source}` };
        }
    }
    return { safe: true };
}

/**
 * Execute generated DOCX code in a VM sandbox with timeout and memory protection
 */
export async function executeDocxCode(code: string): Promise<Buffer> {
    console.log('[DocxCodeGenerator] Executing generated code in sandbox...');
    console.log('[DocxCodeGenerator] Code length:', code.length);

    // Step 1: Validate code before execution
    const validation = validateCode(code);
    if (!validation.safe) {
        throw new Error(`Code validation failed: ${validation.reason}`);
    }

    try {
        // Step 2: Create a VM sandbox context with only docx classes
        const sandbox = {
            Document,
            Packer,
            Paragraph,
            TextRun,
            AlignmentType,
            Table,
            TableRow,
            TableCell,
            WidthType,
            BorderStyle,
            HeadingLevel,
            convertInchesToTwip,
            console: { log: () => {}, warn: () => {}, error: () => {} }, // Suppress console
            Promise,
            Array,
            Object,
            String,
            Number,
            Math,
            Date,
            JSON,
            __result: null as any,
        };

        const context = vm.createContext(sandbox, {
            codeGeneration: { strings: false, wasm: false },
        });

        // Step 3: Wrap the user code in an async IIFE that stores result
        const wrappedCode = `
            (async () => {
                ${code}
                __result = await createDocument();
            })();
        `;

        // Step 4: Compile and run with timeout
        const script = new vm.Script(wrappedCode, {
            filename: 'user-document-code.js',
        });

        const resultPromise = script.runInContext(context, {
            timeout: EXECUTION_TIMEOUT_MS,
        });

        // Step 5: Await the async result with timeout
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`)), EXECUTION_TIMEOUT_MS)
        );
        await Promise.race([resultPromise, timeoutPromise]);

        const doc = sandbox.__result;

        if (!doc) {
            throw new Error('Document creation returned null. Ensure createDocument() returns a Document object.');
        }

        console.log('[DocxCodeGenerator] Document created in sandbox, packing...');

        const buffer = await Packer.toBuffer(doc);
        console.log(`[DocxCodeGenerator] Generated buffer size: ${buffer.length} bytes`);

        return buffer;
    } catch (error: any) {
        const message = error.message || 'Unknown error';
        // Sanitize error message - don't leak internal paths or stack traces
        const sanitized = message
            .replace(/\/[^\s:]+/g, '[path]')
            .substring(0, 500);
        console.error('[DocxCodeGenerator] Sandbox execution error:', sanitized);
        throw new Error(`Document code execution failed: ${sanitized}`);
    }
}

/**
 * High-level function: Generate and execute in one call
 */
export async function generateProfessionalDocument(
    description: string,
    documentType: string = 'solicitud'
): Promise<{ buffer: Buffer; code: string }> {
    const code = await generateDocxCode(description, documentType);
    const buffer = await executeDocxCode(code);

    return { buffer, code };
}

/**
 * Determine document type from description
 */
export function detectDocumentType(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes('contrato') || lower.includes('acuerdo')) return 'contrato';
    if (lower.includes('informe') || lower.includes('reporte')) return 'informe';
    if (lower.includes('solicitud') || lower.includes('permiso') || lower.includes('carta')) return 'solicitud';
    if (lower.includes('factura') || lower.includes('cotización')) return 'factura';
    if (lower.includes('curriculum') || lower.includes('cv')) return 'cv';

    return 'solicitud'; // Default
}
