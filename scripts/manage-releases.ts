import { db } from "../server/db";
import { appReleases } from "../shared/schema/admin";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
export const APP_VERSION = `v${packageJson.version}`;

const EXAMPLES: typeof appReleases.$inferInsert[] = [
    {
        platform: "macOS",
        version: APP_VERSION,
        size: "~98 MB",
        requirements: "macOS 11+ (Big Sur o superior)",
        available: "true",
        fileName: `IliaGPT-${packageJson.version}-arm64.dmg`,
        downloadUrl: `https://github.com/Carrerajorge/Hola/releases/latest/download/IliaGPT-${packageJson.version}-arm64.dmg`,
        note: "Apple Silicon (M1/M2/M3/M4)",
        isActive: "true"
    },
    {
        platform: "Windows",
        version: APP_VERSION,
        size: "~112 MB",
        requirements: "Windows 10+ (64-bit)",
        available: "true",
        fileName: `IliaGPT-Setup-${packageJson.version}.exe`,
        downloadUrl: `https://github.com/Carrerajorge/Hola/releases/latest/download/IliaGPT-Setup-${packageJson.version}.exe`,
        note: "Instalador NSIS con auto-updater",
        isActive: "true"
    },
    {
        platform: "Linux",
        version: APP_VERSION,
        size: "~89 MB",
        requirements: "Ubuntu 22.04+, Fedora, Debian",
        available: "true",
        fileName: `IliaGPT-${packageJson.version}-x86_64.AppImage`,
        downloadUrl: `https://github.com/Carrerajorge/Hola/releases/latest/download/IliaGPT-${packageJson.version}-x86_64.AppImage`,
        note: "Formato AppImage universal",
        isActive: "true"
    }
];

async function run() {
    try {
        const existingReleases = await db.select().from(appReleases);
        console.log(`Current appReleases count: ${existingReleases.length}`);

        if (existingReleases.length === 0) {
            console.log("No releases found, inserting default releases...");
            await db.insert(appReleases).values(EXAMPLES);
            console.log("Releases seeded successfully using version:", APP_VERSION);
        } else {
            console.log("Updating existing releases to match current version:", APP_VERSION);
            for (const release of existingReleases) {
                const updatedFields: Partial<typeof appReleases.$inferSelect> = {
                    available: "true",
                    version: APP_VERSION
                };

                // Match the platform to update the download link logic
                const match = EXAMPLES.find(e => e.platform === release.platform);
                if (match) {
                    updatedFields.fileName = match.fileName;
                    updatedFields.downloadUrl = match.downloadUrl;
                }

                await db.update(appReleases)
                    .set(updatedFields)
                    .where(eq(appReleases.id, release.id));
                console.log(`Updated release ${release.platform} to available=true, version=${APP_VERSION}`);
            }
        }

        const finalReleases = await db.select().from(appReleases);
        console.log("Final active releases in DB:");
        console.dir(finalReleases, { depth: null });
        process.exit(0);
    } catch (err) {
        console.error("Error managing releases:", err);
        process.exit(1);
    }
}

run();
