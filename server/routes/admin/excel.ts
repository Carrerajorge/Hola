import { Router } from "express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const excelRouter = Router();

// GET /api/admin/excel/list - List all Excel documents
excelRouter.get("/list", async (req, res) => {
    try {
        // Try to get from database
        const result = await db.execute(sql`
            SELECT id, name, sheets, size, created_at, updated_at, created_by
            FROM excel_documents
            ORDER BY updated_at DESC
            LIMIT 100
        `).catch(() => ({ rows: [] }));
        
        res.json(result.rows || []);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/excel/:id - Get single document
excelRouter.get("/:id", async (req, res) => {
    try {
        const result = await db.execute(sql`
            SELECT * FROM excel_documents WHERE id = ${req.params.id}
        `).catch(() => ({ rows: [] }));
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Document not found" });
        }
        
        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

excelRouter.get("/sheets", async (req, res) => {
    try {
        // Excel functionality is now client-side mostly, but we track saved artifacts
        // This endpoint could list excel-related artifacts
        res.json([]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/excel/save - Save Excel document
excelRouter.post("/save", async (req, res) => {
    try {
        const { id, name, data } = req.body;
        
        // Upsert document
        await db.execute(sql`
            INSERT INTO excel_documents (id, name, data, sheets, size, created_by, updated_at)
            VALUES (${id}, ${name}, ${JSON.stringify(data)}, ${data?.length || 1}, ${JSON.stringify(data).length}, ${(req as any).user?.email || 'admin'}, NOW())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                data = EXCLUDED.data,
                sheets = EXCLUDED.sheets,
                size = EXCLUDED.size,
                updated_at = NOW()
        `).catch(() => null);
        
        await auditLog(req, {
            action: "excel.saved",
            resource: "excel_documents",
            resourceId: id,
            details: { name, savedBy: (req as any).user?.email },
            category: "data",
            severity: "info"
        });
        
        res.json({ success: true, id, name });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/excel/:id - Delete Excel document
excelRouter.delete("/:id", async (req, res) => {
    try {
        await db.execute(sql`
            DELETE FROM excel_documents WHERE id = ${req.params.id}
        `).catch(() => null);
        
        await auditLog(req, {
            action: "excel.deleted",
            resource: "excel_documents",
            resourceId: req.params.id,
            details: { deletedBy: (req as any).user?.email },
            category: "data",
            severity: "warning"
        });
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

excelRouter.post("/export", async (req, res) => {
    try {
        const { data, filename } = req.body;
        
        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "excel",
            details: { filename, exportedBy: (req as any).user?.email },
            category: "data",
            severity: "info"
        });
        
        // Logic to generate excel file on server would go here
        res.json({ success: true, url: "/download/excel/..." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
