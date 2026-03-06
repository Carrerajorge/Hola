import { db } from './server/db';
import { users } from '@shared/schema';
async function run() {
  const result = await db.query.users.findMany();
  console.log(result);
  process.exit(0);
}
run();
