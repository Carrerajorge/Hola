
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TARGET_EMAIL = "Carrerajorge874@gmail.com"; // Fixing potential typo in user request based on seed file
const TARGET_PASSWORD = "2022212"; // New password requested by user

async function restoreAdmin() {
    console.log(`[restore] Starting admin restoration for ${TARGET_EMAIL}...`);

    try {
        const hashedPassword = await bcrypt.hash(TARGET_PASSWORD, 12);

        // Check if user exists
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.email, TARGET_EMAIL))
            .limit(1);

        if (existingUser.length > 0) {
            console.log(`[restore] User found. Updating password and role...`);
            await db
                .update(users)
                .set({
                    role: "admin",
                    password: hashedPassword,
                    status: "active",
                    emailVerified: "true"
                })
                .where(eq(users.email, TARGET_EMAIL));
            console.log(`[restore] ✅ SUCCESS: User ${TARGET_EMAIL} updated to admin with new password.`);
        } else {
            console.log(`[restore] User NOT found. Creating new admin user...`);
            await db.insert(users).values({
                email: TARGET_EMAIL,
                password: hashedPassword,
                role: "admin",
                username: "admin_restored",
                firstName: "Admin",
                lastName: "User",
                status: "active",
                emailVerified: "true",
                authProvider: "email"
            });
            console.log(`[restore] ✅ SUCCESS: Created new admin user ${TARGET_EMAIL}.`);
        }

    } catch (error) {
        console.error(`[restore] ❌ ERROR: Failed to restore admin:`, error);
        process.exit(1);
    }

    process.exit(0);
}

restoreAdmin();
