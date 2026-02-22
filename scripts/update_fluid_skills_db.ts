import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { customSkills } from "@shared/schema";
import { BUNDLED_SKILLS } from "../server/data/bundledSkills";

async function main() {
  console.log("Actualizando skills en la base de datos...");
  let count = 0;
  for (const skill of BUNDLED_SKILLS) {
    try {
      await db.update(customSkills)
        .set({
          description: skill.description,
          features: skill.features || []
        })
        .where(eq(customSkills.name, skill.name));
      count++;
      console.log(`Updated: ${skill.name}`);
    } catch (e) {
      console.error(`Error updating ${skill.name}:`, e);
    }
  }
  console.log(`Finalizado. Skills revisadas: ${count}`);
  process.exit(0);
}

main().catch(console.error);
