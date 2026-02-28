#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "migrate.mjs")).href).catch(err => {
  console.error("Failed to run migrations:", err);
  process.exit(1);
});
