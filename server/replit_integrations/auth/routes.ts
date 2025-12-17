import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

// Admin credentials
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "123456";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
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
      
      req.login(adminUser, (err: any) => {
        if (err) {
          console.error("Admin login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({ success: true, user: { id: adminId, email: ADMIN_EMAIL, firstName: "Admin", lastName: "User" } });
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
