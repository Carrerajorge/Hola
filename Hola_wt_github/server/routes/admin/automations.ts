/**
 * Automation Rules Engine
 * If-then rules for automatic actions
 */

import { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { auditLog } from "../../services/auditLogger";
import { adminNotifications } from "../../services/adminNotifications";
import { EventEmitter } from "events";

export const automationsRouter = Router();

// Ensure table exists
const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(100) NOT NULL,
        trigger_conditions JSONB DEFAULT '{}',
        action_type VARCHAR(100) NOT NULL,
        action_config JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        run_count INTEGER DEFAULT 0,
        last_run_at TIMESTAMP,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id VARCHAR(255) NOT NULL,
        trigger_data JSONB,
        action_result JSONB,
        success BOOLEAN,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) {
    // Tables might exist
  }
};

ensureTable();

// Available triggers
const TRIGGER_TYPES = [
  { id: "user_registered", label: "User Registered", fields: [] },
  { id: "user_plan_changed", label: "Plan Changed", fields: ["from_plan", "to_plan"] },
  { id: "chat_created", label: "Chat Created", fields: ["min_messages"] },
  { id: "payment_completed", label: "Payment Completed", fields: ["min_amount"] },
  { id: "login_failed", label: "Login Failed", fields: ["max_attempts"] },
  { id: "user_inactive", label: "User Inactive", fields: ["days_inactive"] },
  { id: "security_alert", label: "Security Alert", fields: ["severity"] }
];

// Available actions
const ACTION_TYPES = [
  { id: "send_email", label: "Send Email", fields: ["template", "subject"] },
  { id: "send_notification", label: "Admin Notification", fields: ["message"] },
  { id: "update_user", label: "Update User", fields: ["field", "value"] },
  { id: "block_user", label: "Block User", fields: ["reason"] },
  { id: "add_tag", label: "Add Tag", fields: ["tag"] },
  { id: "webhook", label: "Call Webhook", fields: ["url", "method"] },
  { id: "slack_message", label: "Slack Message", fields: ["channel", "message"] }
];

// GET /api/admin/automations - List rules
automationsRouter.get("/", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM automation_rules ORDER BY created_at DESC
    `);
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/automations/triggers - List available triggers
automationsRouter.get("/triggers", async (req, res) => {
  res.json(TRIGGER_TYPES);
});

// GET /api/admin/automations/actions - List available actions
automationsRouter.get("/actions", async (req, res) => {
  res.json(ACTION_TYPES);
});

// POST /api/admin/automations - Create rule
automationsRouter.post("/", async (req, res) => {
  try {
    const { name, description, triggerType, triggerConditions, actionType, actionConfig } = req.body;
    
    if (!name || !triggerType || !actionType) {
      return res.status(400).json({ error: "name, triggerType, and actionType are required" });
    }
    
    const result = await db.execute(sql`
      INSERT INTO automation_rules (name, description, trigger_type, trigger_conditions, action_type, action_config, created_by)
      VALUES (${name}, ${description || null}, ${triggerType}, ${JSON.stringify(triggerConditions || {})}, 
              ${actionType}, ${JSON.stringify(actionConfig || {})}, ${(req as any).user?.email})
      RETURNING *
    `);
    
    await auditLog(req, {
      action: "automation.created",
      resource: "automation_rules",
      resourceId: result.rows?.[0]?.id,
      details: { name, triggerType, actionType },
      category: "admin",
      severity: "info"
    });
    
    res.json(result.rows?.[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/automations/:id - Update rule
automationsRouter.patch("/:id", async (req, res) => {
  try {
    const { name, description, triggerConditions, actionConfig, isActive } = req.body;
    
    const result = await db.execute(sql`
      UPDATE automation_rules SET
        name = COALESCE(${name}, name),
        description = COALESCE(${description}, description),
        trigger_conditions = COALESCE(${triggerConditions ? JSON.stringify(triggerConditions) : null}, trigger_conditions),
        action_config = COALESCE(${actionConfig ? JSON.stringify(actionConfig) : null}, action_config),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${req.params.id}
      RETURNING *
    `);
    
    if (!result.rows?.length) {
      return res.status(404).json({ error: "Rule not found" });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/automations/:id - Delete rule
automationsRouter.delete("/:id", async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM automation_rules WHERE id = ${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/automations/:id/logs - Get rule execution logs
automationsRouter.get("/:id/logs", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM automation_logs 
      WHERE rule_id = ${req.params.id}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/automations/:id/test - Test rule execution
automationsRouter.post("/:id/test", async (req, res) => {
  try {
    const { testData } = req.body;
    
    const ruleResult = await db.execute(sql`
      SELECT * FROM automation_rules WHERE id = ${req.params.id}
    `);
    
    if (!ruleResult.rows?.length) {
      return res.status(404).json({ error: "Rule not found" });
    }
    
    const rule = ruleResult.rows[0];
    const result = await executeAction(rule, testData || {}, true);
    
    res.json({ 
      success: result.success,
      result: result.data,
      error: result.error
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= AUTOMATION ENGINE =============

interface AutomationRule {
  id: string;
  trigger_type: string;
  trigger_conditions: Record<string, any>;
  action_type: string;
  action_config: Record<string, any>;
  is_active: boolean;
}

async function executeAction(
  rule: AutomationRule,
  triggerData: Record<string, any>,
  isDryRun = false
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    let result: any = { dryRun: isDryRun };

    switch (rule.action_type) {
      case "send_notification":
        if (!isDryRun) {
          adminNotifications.info(
            rule.action_config.title || "Automation Alert",
            rule.action_config.message || `Rule triggered: ${rule.id}`
          );
        }
        result = { action: "notification_sent" };
        break;

      case "update_user":
        if (!isDryRun && triggerData.userId) {
          await db.execute(sql.raw(`
            UPDATE users SET ${rule.action_config.field} = '${rule.action_config.value}'
            WHERE id = '${triggerData.userId}'
          `));
        }
        result = { action: "user_updated", userId: triggerData.userId };
        break;

      case "block_user":
        if (!isDryRun && triggerData.userId) {
          await db.execute(sql`
            UPDATE users SET status = 'blocked', block_reason = ${rule.action_config.reason}
            WHERE id = ${triggerData.userId}
          `);
        }
        result = { action: "user_blocked", userId: triggerData.userId };
        break;

      case "webhook":
        if (!isDryRun) {
          const response = await fetch(rule.action_config.url, {
            method: rule.action_config.method || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rule: rule.id, trigger: triggerData })
          });
          result = { action: "webhook_called", status: response.status };
        }
        break;

      default:
        result = { action: rule.action_type, config: rule.action_config };
    }

    // Log execution
    if (!isDryRun) {
      await db.execute(sql`
        INSERT INTO automation_logs (rule_id, trigger_data, action_result, success)
        VALUES (${rule.id}, ${JSON.stringify(triggerData)}, ${JSON.stringify(result)}, true)
      `);
      
      await db.execute(sql`
        UPDATE automation_rules SET run_count = run_count + 1, last_run_at = NOW()
        WHERE id = ${rule.id}
      `);
    }

    return { success: true, data: result };
  } catch (error: any) {
    if (!isDryRun) {
      await db.execute(sql`
        INSERT INTO automation_logs (rule_id, trigger_data, success, error_message)
        VALUES (${rule.id}, ${JSON.stringify(triggerData)}, false, ${error.message})
      `);
    }
    return { success: false, error: error.message };
  }
}

// Event handler for triggers
class AutomationEngine extends EventEmitter {
  async handleEvent(eventType: string, data: Record<string, any>) {
    try {
      const rules = await db.execute(sql`
        SELECT * FROM automation_rules 
        WHERE trigger_type = ${eventType} AND is_active = true
      `);

      for (const rule of rules.rows || []) {
        // Check conditions
        const conditions = rule.trigger_conditions as Record<string, any>;
        let shouldExecute = true;

        for (const [key, value] of Object.entries(conditions)) {
          if (data[key] !== value) {
            shouldExecute = false;
            break;
          }
        }

        if (shouldExecute) {
          executeAction(rule as AutomationRule, data).catch(console.error);
        }
      }
    } catch (error) {
      console.error("[Automation] Error handling event:", error);
    }
  }
}

export const automationEngine = new AutomationEngine();

// Helper to trigger automation from anywhere
export function triggerAutomation(eventType: string, data: Record<string, any>) {
  automationEngine.handleEvent(eventType, data).catch(console.error);
}
