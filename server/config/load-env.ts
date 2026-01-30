import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const rootDir = path.resolve(__dirname, "../..");
const envFiles: string[] = [];

if (process.env.NODE_ENV === "production") {
  envFiles.push(".env.production", ".env");
} else {
  envFiles.push(".env");
}

envFiles.forEach((envFile) => {
  const envPath = path.join(rootDir, envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
});
