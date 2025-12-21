import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { storage } from "../../storage";

// Admin credentials from environment variables
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // User login with email/password (for users created by admin)
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email y contraseña son requeridos" });
      }
      
      // Check if it's the admin
      if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        const adminId = "admin-user-id";
        await authStorage.upsertUser({
          id: adminId,
          email: ADMIN_EMAIL,
          firstName: "Admin",
          lastName: "User",
          profileImageUrl: null,
          role: "admin",
        });
        
        const adminUser = {
          claims: {
            sub: adminId,
            email: ADMIN_EMAIL,
            first_name: "Admin",
            last_name: "User",
          },
          expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
        };
        
        return req.login(adminUser, async (err: any) => {
          if (err) {
            return res.status(500).json({ message: "Error al iniciar sesión" });
          }
          const user = await authStorage.getUser(adminId);
          res.json({ success: true, user });
        });
      }
      
      // Find user in database by email
      const allUsers = await storage.getAllUsers();
      const dbUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());
      
      if (!dbUser) {
        return res.status(401).json({ message: "Usuario no encontrado" });
      }
      
      // Verify password
      if (dbUser.password !== password) {
        return res.status(401).json({ message: "Contraseña incorrecta" });
      }
      
      // Check if user is active
      if (dbUser.status !== "active") {
        return res.status(401).json({ message: "Usuario inactivo" });
      }
      
      // Set up session
      const sessionUser = {
        claims: {
          sub: dbUser.id,
          email: dbUser.email,
          first_name: dbUser.firstName || "",
          last_name: dbUser.lastName || "",
        },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      };
      
      req.login(sessionUser, async (err: any) => {
        if (err) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }
        
        // Track login
        try {
          await storage.createAuditLog({
            userId: dbUser.id,
            action: "user_login",
            resource: "auth",
            details: { email: dbUser.email },
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
        
        res.json({ success: true, user: dbUser });
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Error al iniciar sesión" });
    }
  });

  // Admin login with email/password
  app.post("/api/auth/admin-login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
      }
      
      if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Create or get admin user
      const adminId = "admin-user-id";
      await authStorage.upsertUser({
        id: adminId,
        email: ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
        role: "admin",
      });
      
      // Set up session for admin
      const adminUser = {
        claims: {
          sub: adminId,
          email: ADMIN_EMAIL,
          first_name: "Admin",
          last_name: "User",
        },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 1 week
      };
      
      req.login(adminUser, async (err: any) => {
        if (err) {
          console.error("Admin login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        
        // Track admin login
        try {
          await storage.createAuditLog({
            userId: adminId,
            action: "admin_login",
            resource: "auth",
            details: { email: ADMIN_EMAIL },
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
        
        res.json({ success: true, user: { id: adminId, email: ADMIN_EMAIL, firstName: "Admin", lastName: "User", role: "admin" } });
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Logout via POST (for SPA - clears session without redirect)
  app.post("/api/auth/logout", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId) {
        await storage.createAuditLog({
          userId,
          action: "user_logout",
          resource: "auth",
          details: {},
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null
        });
      }
      req.logout((err: any) => {
        if (err) {
          console.error("Logout error:", err);
        }
        res.json({ success: true });
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.json({ success: true });
    }
  });

  // Get current authenticated user
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // Check if user is authenticated via passport session
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const userId = req.user.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
