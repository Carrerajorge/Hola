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
import{a,b,c,d,e,f,g,h,i,j,k,l,m}from"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{d as authTokens,m as consentLogs,i as featureFlagsSchema,f as insertUserSchema,l as insertUserSettingsSchema,b as magicLinks,c as oauthStates,j as privacySettingsSchema,g as responsePreferencesSchema,a as sessions,h as userProfileSchema,k as userSettings,e as users};
