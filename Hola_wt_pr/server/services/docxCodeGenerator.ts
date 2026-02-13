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
    apiKey: process.env.XAI_API_KEY,
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

/**
 * Execute generated DOCX code in a sandbox and return the buffer
 */
export async function executeDocxCode(code: string): Promise<Buffer> {
    console.log('[DocxCodeGenerator] Executing generated code...');
    console.log('[DocxCodeGenerator] Code preview:', code.substring(0, 200));

    try {
        // Create a function that has access to docx classes
        const createDocFn = new Function(
            'Document',
            'Packer',
            'Paragraph',
            'TextRun',
            'AlignmentType',
            'Table',
            'TableRow',
            'TableCell',
            'WidthType',
            'BorderStyle',
            'HeadingLevel',
            'convertInchesToTwip',
            `
            return (async () => {
                ${code}
                return await createDocument();
            })();
            `
        );

        // Execute with all docx classes available
        const doc = await createDocFn(
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
            convertInchesToTwip
        );

        if (!doc) {
            throw new Error('Document creation returned null');
        }

        console.log('[DocxCodeGenerator] Document created, packing to buffer...');

        // Pack the document to buffer
        const buffer = await Packer.toBuffer(doc);

        console.log(`[DocxCodeGenerator] Generated buffer size: ${buffer.length} bytes`);

        return buffer;
    } catch (error: any) {
        console.error('[DocxCodeGenerator] Execution error:', error.message);
        console.error('[DocxCodeGenerator] Stack:', error.stack);
        throw new Error(`Failed to execute document code: ${error.message}`);
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
