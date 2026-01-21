import "dotenv/config";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { hashPassword } from "../server/utils/password";
import { eq } from "drizzle-orm";

async function main() {
    const email = "carrerajorge874@gmail.com";
    const password = "123456";

    console.log(`Hashing password for ${email}...`);
    const hashed = await hashPassword(password);

    console.log(`Creating/Updating user...`);

    try {
        const existing = await db.select().from(users).where(eq(users.email, email));
        if (existing.length > 0) {
            console.log("User exists, updating password and role...");
            await db.update(users).set({
                password: hashed,
                role: "admin",
                status: "active",
                emailVerified: "true"
            }).where(eq(users.email, email));
        } else {
            console.log("User does not exist, creating...");
            await db.insert(users).values({
                email,
                password: hashed,
                role: "admin",
                username: "admin",
                firstName: "Admin",
                lastName: "User",
                status: "active",
                emailVerified: "true",
                authProvider: "email"
            });
        }
        console.log("Done.");
        process.exit(0);
    } catch (e) {
        console.error("Error creating admin user:", e);
        process.exit(1);
    }
}

main();
