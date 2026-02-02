import Stripe from 'stripe';

// Stripe credentials from environment variables
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripeClient = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia',
    });
  }
  return stripeClient;
}

// Alias for backwards compatibility
export async function getUncachableStripeClient(): Promise<Stripe> {
  return getStripeClient();
}

export function getStripePublishableKey(): string {
  if (!STRIPE_PUBLISHABLE_KEY) {
    throw new Error('STRIPE_PUBLISHABLE_KEY not configured');
  }
  return STRIPE_PUBLISHABLE_KEY;
}

export function getStripeSecretKey(): string {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  return STRIPE_SECRET_KEY;
}

// Plan configuration
export const STRIPE_PLANS = {
  go: {
    name: 'Go',
    price: 5,
    priceId: process.env.STRIPE_PRICE_GO || '', // Will be created in Stripe
  },
  plus: {
    name: 'Plus',
    price: 10,
    priceId: process.env.STRIPE_PRICE_PLUS || '',
  },
  pro: {
    name: 'Pro',
    price: 200,
    priceId: process.env.STRIPE_PRICE_PRO || '',
  },
  business: {
    name: 'Business',
    price: 25,
    priceId: process.env.STRIPE_PRICE_BUSINESS || '',
  },
};

export type PlanType = keyof typeof STRIPE_PLANS;
