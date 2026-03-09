import { db } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../server/utils/password";

async function ensureUser() {
    const email = "admin@gmail.com";
    const password = "123456";
    const hashedPassword = await hashPassword(password);

    try {
        const existing = await db.select().from(users).where(eq(users.email, email));
        if (existing.length > 0) {
            await db.update(users).set({ password: hashedPassword }).where(eq(users.email, email));
            console.log("User updated successfully");
        } else {
            await db.insert(users).values({
                email,
                password: hashedPassword,
                username: "admin",
                authProvider: "local",
                role: "admin",
                status: "active"
            });
            console.log("User created successfully");
        }
    } catch (error) {
        console.error("Error managing user:", error);
    } finally {
        process.exit(0);
    }
}

ensureUser();
