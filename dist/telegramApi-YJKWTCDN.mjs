import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Some dependencies still reference CommonJS globals (module/exports) even when bundled.
// When output format is ESM, these are not defined by Node.
// Provide a minimal shim to avoid runtime crashes like:
//   ReferenceError: module is not defined in ES module scope
const module = { exports: {} };
const exports = module.exports;

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{e as a,f as b,g as c,h as d,i as e,j as f,k as g}from"./chunk-CZMRWI62.mjs";import"./chunk-RFZBR23N.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-JL5GVIQJ.mjs";export{f as downloadTelegramMedia,b as telegramSendDocument,a as telegramSendMessage,c as telegramSendPhoto,d as telegramSendVideo,e as telegramSendVoice,g as telegramSetWebhook};
