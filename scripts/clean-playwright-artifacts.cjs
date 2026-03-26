#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

for (const relativePath of ["playwright-report", "test-results"]) {
  fs.rmSync(path.join(process.cwd(), relativePath), { recursive: true, force: true });
}
