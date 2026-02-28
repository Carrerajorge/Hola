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
import{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q}from"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{p as connectorUsageHourly,k as gmailOAuthTokens,q as insertConnectorUsageHourlySchema,l as insertGmailOAuthTokenSchema,d as insertIntegrationAccountSchema,h as insertIntegrationPolicySchema,b as insertIntegrationProviderSchema,f as insertIntegrationToolSchema,o as insertPareIdempotencyKeySchema,j as insertSharedLinkSchema,c as integrationAccounts,g as integrationPolicies,a as integrationProviders,e as integrationTools,n as pareIdempotencyKeys,m as pareIdempotencyStatusEnum,i as sharedLinks};
