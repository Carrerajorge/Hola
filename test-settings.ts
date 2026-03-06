import { db } from './server/db';
import * as schema from '@shared/schema';

async function run() {
  if (schema.modelProviders) {
    const res = await db.query.modelProviders.findMany();
    console.log("Model Providers:", res);
  }
  if (schema.userSettings) {
    const res = await db.query.userSettings.findMany();
    console.log("User Settings:", res);
  }
  process.exit(0);
}
run();
