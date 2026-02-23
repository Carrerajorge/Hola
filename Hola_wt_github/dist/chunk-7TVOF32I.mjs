import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import n from"stripe";var r=null;function t(){let e=process.env.STRIPE_SECRET_KEY||"";if(!e)throw new Error("STRIPE_SECRET_KEY not configured");return e}function i(){return r||(r=new n(t(),{apiVersion:"2026-01-28.clover"})),r}async function p(){return i()}function s(){let e=process.env.STRIPE_PUBLISHABLE_KEY||"";if(!e)throw new Error("STRIPE_PUBLISHABLE_KEY not configured");return e}var c={go:{name:"Go",price:5,priceId:process.env.STRIPE_PRICE_GO||""},plus:{name:"Plus",price:10,priceId:process.env.STRIPE_PRICE_PLUS||""},pro:{name:"Pro",price:200,priceId:process.env.STRIPE_PRICE_PRO||""},business:{name:"Business",price:25,priceId:process.env.STRIPE_PRICE_BUSINESS||""}};export{i as a,p as b,s as c};
