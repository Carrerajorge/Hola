#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");

// Polyfill browser globals needed by pdf-parse and canvas libraries in Node.js
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.m11=1;this.m12=0;this.m13=0;this.m14=0;this.m21=0;this.m22=1;this.m23=0;this.m24=0;this.m31=0;this.m32=0;this.m33=1;this.m34=0;this.m41=0;this.m42=0;this.m43=0;this.m44=1;this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; }
  };
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData { constructor(w,h) { this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4); } };
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D { constructor() {} };
}

console.log("[Wrapper] Starting application...");
const modulePath = join(__dirname, "index.mjs");
console.log("[Wrapper] Loading ESM module from:", modulePath);

import(pathToFileURL(modulePath).href)
  .then(() => console.log("[Wrapper] Module loaded successfully"))
  .catch(err => {
    console.error("[Wrapper] Failed to start application:", err);
    process.exit(1);
  });
