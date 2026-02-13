import { Router } from "express";
import { db, dbRead } from "../../db";
import { excelDocuments } from "@shared/schema";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { desc, eq, sql } from "drizzle-orm";

export const excelRouter = Router();

function getActorEmail(req: any): string | null {
    const session = req.session as any;
    return (
        req.user?.claims?.email ||
        req.user?.email ||
        session?.passport?.user?.claims?.email ||
        session?.passport?.user?.email ||
        null
    );
}

// GET /api/admin/excel/list - List Excel documents (server is source of truth; no client-side fallbacks)
excelRouter.get("/list", async (req, res) => {
    try {
        const limitNum = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 200);

        const rows = await dbRead
            .select({
                uuid: excelDocuments.uuid,
                name: excelDocuments.name,
                sheets: excelDocuments.sheets,
                size: excelDocuments.size,
                createdAt: excelDocuments.createdAt,
                updatedAt: excelDocuments.updatedAt,
                metadata: excelDocuments.metadata,
            })
            .from(excelDocuments)
            .orderBy(desc(excelDocuments.updatedAt), desc(excelDocuments.id))
            .limit(limitNum);

        const mapped = rows.map((row) => {
            const metadata = (row.metadata || {}) as Record<string, any>;
            const sheetsCount = Array.isArray(row.sheets) ? row.sheets.length : 0;

            return {
                id: row.uuid, // UI uses `id` as identifier; we map it to the stable `uuid`.
                name: row.name,
                sheets: sheetsCount,
                size: row.size || 0,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                createdBy: metadata.createdByEmail || metadata.lastSavedByEmail || null,
            };
        });

        res.json(mapped);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/excel/sheets - Legacy endpoint kept for compatibility
excelRouter.get("/sheets", async (_req, res) => {
    res.json([]);
});

// GET /api/admin/excel/:id - Get single document by uuid
excelRouter.get("/:id", async (req, res) => {
    try {
        const uuid = req.params.id;

        const [doc] = await dbRead
            .select()
            .from(excelDocuments)
            .where(eq(excelDocuments.uuid, uuid))
            .limit(1);

        if (!doc) {
            return res.status(404).json({ error: "Document not found" });
        }

        res.json({
            id: doc.uuid,
            uuid: doc.uuid,
            name: doc.name,
            data: doc.data,
            sheets: doc.sheets,
            metadata: doc.metadata,
            size: doc.size,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            isTemplate: doc.isTemplate,
            templateCategory: doc.templateCategory,
            version: doc.version,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/excel/save - Save Excel document (upsert by uuid)
excelRouter.post("/save", async (req, res) => {
    try {
        const { id, name, data, sheets } = req.body as {
            id?: string;
            name?: string;
            data?: any[][] | null;
            sheets?: { name: string; data: any[][]; metadata?: any }[] | null;
        };

        if (!id || typeof id !== "string") {
            return res.status(400).json({ error: "id is required" });
        }
        if (!name || typeof name !== "string") {
            return res.status(400).json({ error: "name is required" });
        }

        const normalizedSheets: { name: string; data: any[][]; metadata?: any }[] | null =
            Array.isArray(sheets) && sheets.length > 0
                ? sheets
                : Array.isArray(data)
                    ? [{ name: "Hoja 1", data }]
                    : null;

        if (!normalizedSheets) {
            return res.status(400).json({ error: "Either sheets or data must be provided" });
        }

        const actorEmail = getActorEmail(req);

        const [existing] = await dbRead
            .select({ metadata: excelDocuments.metadata })
            .from(excelDocuments)
            .where(eq(excelDocuments.uuid, id))
            .limit(1);

        const existingMetadata = (existing?.metadata || {}) as Record<string, any>;
        const nextMetadata: Record<string, any> = {
            ...existingMetadata,
            lastSavedAt: new Date().toISOString(),
            lastSavedByEmail: actorEmail,
        };
        if (!nextMetadata.createdByEmail) nextMetadata.createdByEmail = actorEmail;

        const firstSheetData = normalizedSheets?.[0]?.data ?? data ?? [];
        const size = JSON.stringify({ sheets: normalizedSheets, data: firstSheetData }).length;

        await db.execute(sql`
            INSERT INTO excel_documents (uuid, name, data, sheets, metadata, size, updated_at)
            VALUES (${id}, ${name}, ${firstSheetData}, ${normalizedSheets}, ${nextMetadata}, ${size}, NOW())
            ON CONFLICT (uuid) DO UPDATE SET
                name = EXCLUDED.name,
                data = EXCLUDED.data,
                sheets = EXCLUDED.sheets,
                metadata = EXCLUDED.metadata,
                size = EXCLUDED.size,
                updated_at = NOW(),
                version = coalesce(excel_documents.version, 1) + 1
        `);

        await auditLog(req, {
            action: "excel.saved",
            resource: "excel_documents",
            resourceId: id,
            details: { name, savedBy: actorEmail },
            category: "data",
            severity: "info",
        });

        res.json({ success: true, id, name });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/excel/:id - Delete document by uuid
excelRouter.delete("/:id", async (req, res) => {
    try {
        const uuid = req.params.id;
        await db.execute(sql`DELETE FROM excel_documents WHERE uuid = ${uuid}`);

        await auditLog(req, {
            action: "excel.deleted",
            resource: "excel_documents",
            resourceId: uuid,
            details: { deletedBy: getActorEmail(req) },
            category: "data",
            severity: "warning",
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

excelRouter.post("/export", async (req, res) => {
    try {
        const { filename } = req.body;

        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "excel",
            details: { filename, exportedBy: getActorEmail(req) },
            category: "data",
            severity: "info",
        });

        // Logic to generate excel file on server would go here
        res.json({ success: true, url: "/download/excel/..." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

