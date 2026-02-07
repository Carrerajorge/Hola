/**
 * Document Worker Thread - Runs inside worker_threads
 *
 * Handles CPU-intensive parsing operations off the main event loop:
 * - Excel parsing (XLSX)
 * - Word document parsing (DOCX)
 * - Image processing
 * - PDF rendering helpers
 */

import { parentPort, workerData } from 'worker_threads';

interface TaskMessage {
    taskId: string;
    type: 'excel_parse' | 'word_parse' | 'image_process' | 'pdf_render';
    data: {
        buffer?: number[]; // Uint8Array as plain array for serialization
        filename?: string;
        options?: Record<string, any>;
    };
}

interface TaskResult {
    taskId: string;
    success: boolean;
    result?: any;
    error?: string;
}

function sendResult(result: TaskResult): void {
    parentPort?.postMessage(result);
}

async function handleExcelParse(taskId: string, data: TaskMessage['data']): Promise<void> {
    try {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.default.Workbook();
        const buffer = Buffer.from(data.buffer || []);
        await workbook.xlsx.load(buffer);

        const sheets: Array<{
            name: string;
            rowCount: number;
            columnCount: number;
            headers: string[];
            data: any[][];
        }> = [];

        workbook.eachSheet((worksheet) => {
            const headers: string[] = [];
            const rows: any[][] = [];
            let columnCount = 0;

            worksheet.eachRow((row, rowNumber) => {
                const values = row.values as any[];
                // ExcelJS row.values is 1-indexed; index 0 is empty
                const cells = values.slice(1);
                columnCount = Math.max(columnCount, cells.length);

                if (rowNumber === 1) {
                    headers.push(...cells.map(c => String(c ?? '')));
                } else {
                    rows.push(cells.map(c => c ?? ''));
                }
            });

            sheets.push({
                name: worksheet.name,
                rowCount: worksheet.rowCount,
                columnCount,
                headers,
                data: rows,
            });
        });

        sendResult({
            taskId,
            success: true,
            result: {
                sheetCount: sheets.length,
                sheets,
                metadata: {
                    creator: workbook.creator,
                    created: workbook.created,
                    modified: workbook.modified,
                },
            },
        });
    } catch (error: any) {
        sendResult({ taskId, success: false, error: error.message });
    }
}

async function handleWordParse(taskId: string, data: TaskMessage['data']): Promise<void> {
    try {
        const mammoth = await import('mammoth');
        const buffer = Buffer.from(data.buffer || []);

        const [htmlResult, textResult] = await Promise.all([
            mammoth.convertToHtml({ buffer }, {
                styleMap: [
                    "p[style-name='Heading 1'] => h1:fresh",
                    "p[style-name='Heading 2'] => h2:fresh",
                    "p[style-name='Heading 3'] => h3:fresh",
                ],
            }),
            mammoth.extractRawText({ buffer }),
        ]);

        sendResult({
            taskId,
            success: true,
            result: {
                html: htmlResult.value,
                text: textResult.value,
                warnings: htmlResult.messages.map(m => m.message),
                wordCount: textResult.value.split(/\s+/).filter(Boolean).length,
            },
        });
    } catch (error: any) {
        sendResult({ taskId, success: false, error: error.message });
    }
}

async function handleImageProcess(taskId: string, data: TaskMessage['data']): Promise<void> {
    try {
        const buffer = Buffer.from(data.buffer || []);
        // Basic image metadata extraction without heavy dependencies
        const size = buffer.length;
        let width = 0;
        let height = 0;
        let format = 'unknown';

        // PNG detection
        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
            format = 'png';
            width = buffer.readUInt32BE(16);
            height = buffer.readUInt32BE(20);
        }
        // JPEG detection
        else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            format = 'jpeg';
            // Simple SOF0 marker search for dimensions
            for (let i = 2; i < buffer.length - 10; i++) {
                if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
                    height = buffer.readUInt16BE(i + 5);
                    width = buffer.readUInt16BE(i + 7);
                    break;
                }
            }
        }

        sendResult({
            taskId,
            success: true,
            result: { format, width, height, sizeBytes: size },
        });
    } catch (error: any) {
        sendResult({ taskId, success: false, error: error.message });
    }
}

async function handlePdfRender(taskId: string, data: TaskMessage['data']): Promise<void> {
    try {
        const pdfParse = await import('pdf-parse');
        const buffer = Buffer.from(data.buffer || []);
        const parsed = await pdfParse.default(buffer);

        sendResult({
            taskId,
            success: true,
            result: {
                text: parsed.text,
                pages: parsed.numpages,
                info: parsed.info,
                metadata: parsed.metadata,
            },
        });
    } catch (error: any) {
        sendResult({ taskId, success: false, error: error.message });
    }
}

// ============== Message Handler ==============

parentPort?.on('message', async (message: TaskMessage) => {
    const { taskId, type, data } = message;

    switch (type) {
        case 'excel_parse':
            await handleExcelParse(taskId, data);
            break;
        case 'word_parse':
            await handleWordParse(taskId, data);
            break;
        case 'image_process':
            await handleImageProcess(taskId, data);
            break;
        case 'pdf_render':
            await handlePdfRender(taskId, data);
            break;
        default:
            sendResult({
                taskId,
                success: false,
                error: `Unknown task type: ${type}`,
            });
    }
});

// Signal readiness
parentPort?.postMessage({ type: 'ready', workerIndex: workerData?.workerIndex });
