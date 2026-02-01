import { Router } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export const phoneAuthRouter = Router();

// In-memory OTP store (in production, use Redis)
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

// Rate limiting for phone auth
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_HOUR = 5;

function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function normalizePhone(phone: string): string {
  // Remove all non-digit characters except +
  return phone.replace(/[^\d+]/g, '');
}

function checkRateLimit(phone: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(phone);
  
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (entry.count >= MAX_REQUESTS_PER_HOUR) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  
  entry.count++;
  return { allowed: true };
}

// POST /api/auth/phone/send-code - Send OTP to phone
phoneAuthRouter.post("/send-code", async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: "Número de teléfono requerido" });
    }
    
    const normalizedPhone = normalizePhone(phone);
    
    // Validate phone format (basic validation)
    if (!/^\+?[1-9]\d{6,14}$/.test(normalizedPhone)) {
      return res.status(400).json({ 
        success: false, 
        message: "Formato de teléfono inválido. Usa formato internacional (ej: +51918714054)" 
      });
    }
    
    // Check rate limit
    const rateCheck = checkRateLimit(normalizedPhone);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        success: false, 
        message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rateCheck.retryAfter! / 60)} minutos`,
        retryAfter: rateCheck.retryAfter
      });
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;
    
    // Store OTP
    otpStore.set(normalizedPhone, { code: otp, expiresAt, attempts: 0 });
    
    // In production, send via SMS provider (Twilio, MessageBird, etc.)
    // For now, we'll simulate and log the code in development
    const isDev = process.env.NODE_ENV === "development";
    
    console.log(`[PhoneAuth] OTP for ${normalizedPhone}: ${otp}`);
    
    // Audit log
    await storage.createAuditLog({
      action: "phone_otp_sent",
      resource: "auth",
      details: { phone: normalizedPhone.slice(-4) } // Only log last 4 digits
    });
    
    // TODO: Integrate with SMS provider
    // Example with Twilio:
    // if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    //   const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    //   await twilio.messages.create({
    //     body: `Tu código de verificación de ILIAGPT es: ${otp}`,
    //     from: process.env.TWILIO_PHONE_NUMBER,
    //     to: normalizedPhone
    //   });
    // }
    
    res.json({ 
      success: true, 
      message: "Código enviado",
      expiresIn: OTP_EXPIRY_MS / 1000,
      // Development only - remove in production
      ...(isDev && { devCode: otp })
    });
  } catch (error: any) {
    console.error("[PhoneAuth] Error sending code:", error);
    res.status(500).json({ success: false, message: "Error al enviar el código" });
  }
});

// POST /api/auth/phone/verify - Verify OTP and login
phoneAuthRouter.post("/verify", async (req, res) => {
  try {
    const { phone, code } = req.body;
    
    if (!phone || !code) {
      return res.status(400).json({ success: false, message: "Teléfono y código requeridos" });
    }
    
    const normalizedPhone = normalizePhone(phone);
    const storedOtp = otpStore.get(normalizedPhone);
    
    if (!storedOtp) {
      return res.status(400).json({ 
        success: false, 
        message: "No hay código pendiente. Solicita uno nuevo." 
      });
    }
    
    // Check expiry
    if (Date.now() > storedOtp.expiresAt) {
      otpStore.delete(normalizedPhone);
      return res.status(400).json({ 
        success: false, 
        message: "El código ha expirado. Solicita uno nuevo." 
      });
    }
    
    // Check attempts
    if (storedOtp.attempts >= MAX_OTP_ATTEMPTS) {
      otpStore.delete(normalizedPhone);
      return res.status(400).json({ 
        success: false, 
        message: "Demasiados intentos fallidos. Solicita un nuevo código." 
      });
    }
    
    // Verify code
    if (storedOtp.code !== code.toString().trim()) {
      storedOtp.attempts++;
      const remaining = MAX_OTP_ATTEMPTS - storedOtp.attempts;
      return res.status(400).json({ 
        success: false, 
        message: `Código incorrecto. ${remaining} intento(s) restante(s).` 
      });
    }
    
    // Code is valid - clear it
    otpStore.delete(normalizedPhone);
    
    // Find or create user
    const existingUsers = await db.select().from(users).where(eq(users.phone, normalizedPhone));
    let user = existingUsers[0];
    
    if (!user) {
      // Create new user
      const [newUser] = await db.insert(users).values({
        id: `phone_${crypto.randomUUID()}`,
        phone: normalizedPhone,
        username: `user_${normalizedPhone.slice(-6)}`,
        authProvider: "phone",
        status: "active",
        emailVerified: "false",
        phoneVerified: "true",
        plan: "free",
        role: "user"
      }).returning();
      user = newUser;
      
      await storage.createAuditLog({
        action: "user_registered_phone",
        resource: "users",
        resourceId: user.id,
        details: { phone: normalizedPhone.slice(-4) }
      });
    } else {
      // Update phone verified status
      await db.update(users)
        .set({ phoneVerified: "true", lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
    }
    
    // Create session
    (req as any).login(user, (err: any) => {
      if (err) {
        console.error("[PhoneAuth] Login error:", err);
        return res.status(500).json({ success: false, message: "Error al iniciar sesión" });
      }
      
      storage.createAuditLog({
        action: "login_phone",
        resource: "auth",
        userId: user.id,
        details: { phone: normalizedPhone.slice(-4) }
      });
      
      res.json({ 
        success: true, 
        message: "Inicio de sesión exitoso",
        user: {
          id: user.id,
          username: user.username,
          phone: user.phone,
          plan: user.plan
        }
      });
    });
  } catch (error: any) {
    console.error("[PhoneAuth] Error verifying code:", error);
    res.status(500).json({ success: false, message: "Error al verificar el código" });
  }
});

// POST /api/auth/phone/resend - Resend OTP
phoneAuthRouter.post("/resend", async (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ success: false, message: "Número de teléfono requerido" });
  }
  
  const normalizedPhone = normalizePhone(phone);
  
  // Delete existing OTP
  otpStore.delete(normalizedPhone);
  
  // Forward to send-code
  req.body.phone = normalizedPhone;
  return phoneAuthRouter.handle(req, res, () => {});
});
