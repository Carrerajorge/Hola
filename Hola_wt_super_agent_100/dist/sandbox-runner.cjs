#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "agent/sandboxRunner/index.mjs")).href).catch(err => {
  console.error("Failed to start sandbox runner:", err);
  process.exit(1);
});
