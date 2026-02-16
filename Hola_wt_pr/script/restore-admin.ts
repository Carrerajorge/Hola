import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../server/utils/password";

async function restoreAdmin() {
    const emailRaw = (process.env.ADMIN_EMAIL || "").trim();
    const passwordPlain = String(process.env.ADMIN_PASSWORD || "");
    if (!emailRaw || !passwordPlain) {
        console.error("[restore] ADMIN_EMAIL and ADMIN_PASSWORD must be set to run this script.");
        process.exit(1);
    }

    const normalizedEmail = emailRaw.toLowerCase().trim();
    console.log(`[restore] Ensuring admin user exists for ${normalizedEmail}...`);

    try {
        const hashedPassword = await hashPassword(passwordPlain);

        const [existingUser] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(sql`lower(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        if (existingUser?.id) {
            await db
                .update(users)
                .set({
                    email: normalizedEmail,
                    role: "admin",
                    password: hashedPassword,
                    status: "active",
                    emailVerified: "true",
                })
                .where(eq(users.id, existingUser.id));
            console.log(`[restore] ✅ Updated user ${normalizedEmail} to admin (password rotated).`);
        } else {
            await db.insert(users).values({
                email: normalizedEmail,
                password: hashedPassword,
                role: "admin",
                username: normalizedEmail.split("@")[0] || "admin",
                firstName: "Admin",
                lastName: "User",
                status: "active",
                emailVerified: "true",
                authProvider: "email",
            });
            console.log(`[restore] ✅ Created admin user ${normalizedEmail}.`);
        }
    } catch (error) {
        console.error("[restore] ❌ Failed to restore admin:", error);
        process.exit(1);
    }

    process.exit(0);
}

restoreAdmin();
