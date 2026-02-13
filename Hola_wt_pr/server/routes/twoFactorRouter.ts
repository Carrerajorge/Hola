/**
 * Two-Factor Authentication Routes
 */

import { Router } from "express";
import { 
  setup2FA, 
  verify2FASetup, 
  verify2FALogin, 
  is2FAEnabled, 
  disable2FA,
  regenerateBackupCodes 
} from "../services/twoFactorAuth";
import { auditLog } from "../services/auditLogger";

export const twoFactorRouter = Router();

// GET /api/2fa/status - Check if 2FA is enabled
twoFactorRouter.get("/status", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const enabled = await is2FAEnabled(userId);
    res.json({ enabled });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/setup - Initialize 2FA setup
twoFactorRouter.post("/setup", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const result = await setup2FA(userId);
    
    // Generate QR code as data URL
    const qrCodeDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(result.qrCodeUrl)}`;
    
    await auditLog(req, {
      action: "2fa.setup_initiated",
      resource: "security",
      details: { userId },
      category: "security",
      severity: "info"
    });
    
    res.json({
      secret: result.secret,
      qrCodeUrl: result.qrCodeUrl,
      qrCodeImage: qrCodeDataUrl,
      backupCodes: result.backupCodes,
      message: "Scan the QR code with your authenticator app, then verify with a code"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/verify-setup - Verify and enable 2FA
twoFactorRouter.post("/verify-setup", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { code } = req.body;
    if (!code || code.length !== 6) {
      return res.status(400).json({ error: "Invalid code format" });
    }
    
    const success = await verify2FASetup(userId, code);
    
    if (success) {
      await auditLog(req, {
        action: "2fa.enabled",
        resource: "security",
        details: { userId },
        category: "security",
        severity: "warning"
      });
      
      res.json({ success: true, message: "Two-factor authentication enabled" });
    } else {
      res.status(400).json({ error: "Invalid verification code" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/verify - Verify 2FA code during login
twoFactorRouter.post("/verify", async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: "userId and code are required" });
    }
    
    const success = await verify2FALogin(userId, code);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Invalid code" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/disable - Disable 2FA
twoFactorRouter.post("/disable", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { code } = req.body;
    
    // Require current 2FA code to disable
    const verified = await verify2FALogin(userId, code);
    if (!verified) {
      return res.status(400).json({ error: "Invalid verification code" });
    }
    
    await disable2FA(userId);
    
    await auditLog(req, {
      action: "2fa.disabled",
      resource: "security",
      details: { userId },
      category: "security",
      severity: "critical"
    });
    
    res.json({ success: true, message: "Two-factor authentication disabled" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/regenerate-backup - Generate new backup codes
twoFactorRouter.post("/regenerate-backup", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    const { code } = req.body;
    
    // Require current 2FA code
    const verified = await verify2FALogin(userId, code);
    if (!verified) {
      return res.status(400).json({ error: "Invalid verification code" });
    }
    
    const backupCodes = await regenerateBackupCodes(userId);
    
    await auditLog(req, {
      action: "2fa.backup_regenerated",
      resource: "security",
      details: { userId },
      category: "security",
      severity: "warning"
    });
    
    res.json({ 
      success: true, 
      backupCodes,
      message: "New backup codes generated. Save them securely."
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
