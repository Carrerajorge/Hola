import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users, excelDocuments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// SECURITY: Admin email moved to environment variable
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    try {
        const userReq = req as AuthenticatedRequest;
        const userEmail = userReq.user?.claims?.email;
        const userId = userReq.user?.claims?.sub;

        // SECURITY: Check both email (from env) and database role
        let isAdmin = false;

        // Check against env-configured admin email (if set)
        if (ADMIN_EMAIL && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
            isAdmin = true;
        }

        // Always verify against database role for proper authorization
        if (!isAdmin && userId) {
            const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
            isAdmin = user?.role === "admin";
        }

        if (!isAdmin) {
            await storage.createAuditLog({
                action: "admin_access_denied",
                resource: "admin_panel",
                details: { email: userEmail, userId, path: req.path }
            });
            return res.status(403).json({ error: "Admin access restricted" });
        }
        next();
    } catch (error) {
        console.error("[Admin] Authorization check failed:", error);
        return res.status(500).json({ error: "Authorization check failed" });
    }
}

export async function seedDefaultExcelDocuments() {
    const existing = await db.select().from(excelDocuments).limit(1);
    if (existing.length === 0) {
        await db.insert(excelDocuments).values([
            {
                uuid: nanoid(),
                name: 'Reporte Q4 2024.xlsx',
                sheets: [{ name: 'Sheet1', data: [] }, { name: 'Sheet2', data: [] }, { name: 'Sheet3', data: [] }],
                size: 45000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Análisis Ventas.xlsx',
                sheets: [{ name: 'Ventas', data: [] }, { name: 'Resumen', data: [] }, { name: 'Gráficos', data: [] }, { name: 'Proyecciones', data: [] }, { name: 'Datos', data: [] }],
                size: 128000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Inventario.xlsx',
                sheets: [{ name: 'Productos', data: [] }, { name: 'Stock', data: [] }],
                size: 67000,
                isTemplate: false,
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Factura',
                sheets: [{
                    name: 'Factura', data: [
                        ['FACTURA', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['Cliente:', '', '', 'Fecha:', ''],
                        ['Dirección:', '', '', 'No. Factura:', ''],
                        ['', '', '', '', ''],
                        ['Descripción', 'Cantidad', 'Precio Unit.', 'Total', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['', '', 'Subtotal:', '', ''],
                        ['', '', 'IVA (16%):', '', ''],
                        ['', '', 'TOTAL:', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 18 }, '5-0': { bold: true }, '5-1': { bold: true }, '5-2': { bold: true }, '5-3': { bold: true }, '12-2': { bold: true }, '12-3': { bold: true } } }
                }],
                size: 5000,
                isTemplate: true,
                templateCategory: 'Finanzas',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Presupuesto Mensual',
                sheets: [{
                    name: 'Presupuesto', data: [
                        ['PRESUPUESTO MENSUAL', '', '', ''],
                        ['', '', '', ''],
                        ['Categoría', 'Presupuestado', 'Real', 'Diferencia'],
                        ['Ingresos', '', '', ''],
                        ['Salario', '', '', ''],
                        ['Otros', '', '', ''],
                        ['', '', '', ''],
                        ['Gastos', '', '', ''],
                        ['Vivienda', '', '', ''],
                        ['Alimentación', '', '', ''],
                        ['Transporte', '', '', ''],
                        ['Servicios', '', '', ''],
                        ['Entretenimiento', '', '', ''],
                        ['Ahorros', '', '', ''],
                        ['', '', '', ''],
                        ['TOTAL', '', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '15-0': { bold: true } } }
                }],
                size: 4000,
                isTemplate: true,
                templateCategory: 'Finanzas',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Lista de Tareas',
                sheets: [{
                    name: 'Tareas', data: [
                        ['LISTA DE TAREAS', '', '', '', ''],
                        ['', '', '', '', ''],
                        ['#', 'Tarea', 'Prioridad', 'Estado', 'Fecha Límite'],
                        ['1', '', '', 'Pendiente', ''],
                        ['2', '', '', 'Pendiente', ''],
                        ['3', '', '', 'Pendiente', ''],
                        ['4', '', '', 'Pendiente', ''],
                        ['5', '', '', 'Pendiente', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true } } }
                }],
                size: 2500,
                isTemplate: true,
                templateCategory: 'Productividad',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Inventario de Productos',
                sheets: [{
                    name: 'Inventario', data: [
                        ['INVENTARIO DE PRODUCTOS', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['Código', 'Producto', 'Categoría', 'Stock', 'Precio', 'Valor Total'],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', 'TOTAL:', '', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } }
                }],
                size: 3500,
                isTemplate: true,
                templateCategory: 'Negocio',
                version: 1
            },
            {
                uuid: nanoid(),
                name: 'Registro de Ventas',
                sheets: [{
                    name: 'Ventas', data: [
                        ['REGISTRO DE VENTAS', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['Fecha', 'Cliente', 'Producto', 'Cantidad', 'Precio', 'Total'],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', '', ''],
                        ['', '', '', '', 'TOTAL:', '']
                    ], metadata: { formatting: { '0-0': { bold: true, fontSize: 16 }, '2-0': { bold: true }, '2-1': { bold: true }, '2-2': { bold: true }, '2-3': { bold: true }, '2-4': { bold: true }, '2-5': { bold: true } } }
                }],
                size: 3000,
                isTemplate: true,
                templateCategory: 'Negocio',
                version: 1
            }
        ]);
    }
}

export function checkApiKeyExists(provider: string): boolean {
    const keyMap: Record<string, string | undefined> = {
        'openai': process.env.OPENAI_API_KEY,
        'anthropic': process.env.ANTHROPIC_API_KEY,
        'google': process.env.GEMINI_API_KEY,
        'grok': process.env.GROK_API_KEY,
        'xai': process.env.XAI_API_KEY,
        'deepseek': process.env.DEEPSEEK_API_KEY,
        'mistral': process.env.MISTRAL_API_KEY,
        'cohere': process.env.COHERE_API_KEY
    };
    return !!keyMap[provider.toLowerCase()];
}
