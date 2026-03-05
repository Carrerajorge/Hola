#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");

console.log("[Wrapper] Starting application...");
const modulePath = join(__dirname, "index.mjs");
console.log("[Wrapper] Loading ESM module from:", modulePath);

import(pathToFileURL(modulePath).href)
  .then(() => console.log("[Wrapper] Module loaded successfully"))
  .catch(err => {
    console.error("[Wrapper] Failed to start application:", err);
    process.exit(1);
  });
