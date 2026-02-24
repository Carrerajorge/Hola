#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "worker.mjs")).href).catch(err => {
  console.error("Failed to start worker:", err);
  process.exit(1);
});
