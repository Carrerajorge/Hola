import { db } from "../db";
import { users } from "../../shared/schema";
import { hashPassword } from "../utils/password";
import { eq, sql } from "drizzle-orm";

async function setAdminCredentials() {
    const email = (process.env.ADMIN_EMAIL || "").trim();
    const passwordPlain = process.env.ADMIN_PASSWORD || "";
    if (!email || !passwordPlain) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set to run this script.");
        process.exit(1);
    }
    const normalizedEmail = email.toLowerCase().trim();
    const hashedPassword = await hashPassword(passwordPlain);

    console.log(`Setting admin credentials for ${normalizedEmail}...`);

    try {
        const [existingUser] = await db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${normalizedEmail}`)
            .limit(1);

        if (existingUser) {
            console.log("User exists. Updating password and role...");
            await db
                .update(users)
                .set({
                    email: normalizedEmail,
                    password: hashedPassword,
                    role: "admin",
                    status: "active",
                    emailVerified: "true",
                })
                .where(eq(users.id, existingUser.id));
            console.log("User updated successfully.");
        } else {
            console.log("User does not exist. Creating new admin user...");
            await db.insert(users).values({
                email: normalizedEmail,
                password: hashedPassword,
                username: normalizedEmail.split("@")[0],
                role: "admin",
                status: "active",
                emailVerified: "true",
                authProvider: "email",
            });
            console.log("User created successfully.");
        }
    } catch (error) {
        console.error("Database operation failed:", error);
        process.exit(1);
    }

    // Allow some time for db operations to flush if needed, though await should suffice.
    console.log("Done.");
    process.exit(0);
}

setAdminCredentials().catch((err) => {
    console.error("Error setting admin credentials:", err);
    process.exit(1);
});
