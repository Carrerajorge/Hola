/**
 * Prompt Templates System
 * Save, manage, and use prompt templates
 */

import { Router } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { auditLog, AuditActions } from "../services/auditLogger";

export const templatesRouter = Router();

// Ensure table exists
const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        variables JSONB DEFAULT '[]',
        is_public BOOLEAN DEFAULT false,
        use_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_templates_user ON prompt_templates(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_templates_category ON prompt_templates(category)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_templates_public ON prompt_templates(is_public)`);
  } catch (e) {
    // Table might already exist
  }
};

// Initialize table
ensureTable();

// GET /api/templates - List templates
templatesRouter.get("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { category, search, includePublic = "true" } = req.query;
    
    let query = `
      SELECT * FROM prompt_templates 
      WHERE (user_id = $1 ${includePublic === "true" ? "OR is_public = true" : ""})
    `;
    const params: any[] = [userId];
    
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    
    query += " ORDER BY use_count DESC, created_at DESC";
    
    const result = await db.execute(sql.raw(query));
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/:id - Get single template
templatesRouter.get("/:id", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM prompt_templates WHERE id = ${req.params.id}
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "Template not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/templates - Create template
templatesRouter.post("/", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { name, description, content, category, variables, isPublic } = req.body;
    
    if (!name || !content) {
      return res.status(400).json({ error: "name and content are required" });
    }
    
    // Extract variables from content ({{variable}})
    const extractedVars = (content.match(/\{\{(\w+)\}\}/g) || [])
      .map((v: string) => v.replace(/\{\{|\}\}/g, ''));
    
    const result = await db.execute(sql`
      INSERT INTO prompt_templates (user_id, name, description, content, category, variables, is_public)
      VALUES (${userId}, ${name}, ${description || null}, ${content}, ${category || 'general'}, 
              ${JSON.stringify(variables || extractedVars)}, ${isPublic || false})
      RETURNING *
    `);
    
    await auditLog(req, {
      action: "template.created",
      resource: "prompt_templates",
      resourceId: result.rows?.[0]?.id as string | undefined,
      details: { name, category },
      category: "user",
      severity: "info"
    });
    
    res.json(result.rows?.[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/templates/:id - Update template
templatesRouter.patch("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { name, description, content, category, variables, isPublic } = req.body;
    
    // Verify ownership
    const existing = await db.execute(sql`
      SELECT * FROM prompt_templates WHERE id = ${req.params.id} AND user_id = ${userId}
    `);
    
    if (!existing.rows?.length) {
      return res.status(404).json({ error: "Template not found or not owned" });
    }
    
    const result = await db.execute(sql`
      UPDATE prompt_templates SET
        name = COALESCE(${name}, name),
        description = COALESCE(${description}, description),
        content = COALESCE(${content}, content),
        category = COALESCE(${category}, category),
        variables = COALESCE(${variables ? JSON.stringify(variables) : null}, variables),
        is_public = COALESCE(${isPublic}, is_public),
        updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `);
    
    res.json(result.rows?.[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/templates/:id - Delete template
templatesRouter.delete("/:id", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    
    const result = await db.execute(sql`
      DELETE FROM prompt_templates WHERE id = ${req.params.id} AND user_id = ${userId}
      RETURNING id
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "Template not found or not owned" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/templates/:id/use - Apply template with variables
templatesRouter.post("/:id/use", async (req, res) => {
  try {
    const { variables = {} } = req.body;
    
    const result = await db.execute(sql`
      SELECT * FROM prompt_templates WHERE id = ${req.params.id}
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "Template not found" });
    }
    
    const template = result.rows[0];
    let content = String(template.content || '');

    // Replace variables
    Object.entries(variables).forEach(([key, value]) => {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value as string);
    });
    
    // Increment use count
    await db.execute(sql`
      UPDATE prompt_templates SET use_count = use_count + 1 WHERE id = ${req.params.id}
    `);
    
    res.json({ 
      content,
      template: template.name,
      appliedVariables: variables
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/categories - List categories
templatesRouter.get("/meta/categories", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT category, COUNT(*) as count 
      FROM prompt_templates 
      GROUP BY category 
      ORDER BY count DESC
    `);
    
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/templates/import - Import templates
templatesRouter.post("/import", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { templates } = req.body;
    
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: "templates must be an array" });
    }
    
    let imported = 0;
    for (const t of templates) {
      if (t.name && t.content) {
        await db.execute(sql`
          INSERT INTO prompt_templates (user_id, name, description, content, category, variables)
          VALUES (${userId}, ${t.name}, ${t.description || null}, ${t.content}, 
                  ${t.category || 'imported'}, ${JSON.stringify(t.variables || [])})
        `);
        imported++;
      }
    }
    
    res.json({ success: true, imported });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates/export - Export user templates
templatesRouter.get("/meta/export", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    
    const result = await db.execute(sql`
      SELECT name, description, content, category, variables 
      FROM prompt_templates 
      WHERE user_id = ${userId}
    `);
    
    res.json({
      exportedAt: new Date().toISOString(),
      templates: result.rows || []
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
