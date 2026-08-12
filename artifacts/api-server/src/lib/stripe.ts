import Stripe from "stripe";

/**
 * Returns a Stripe SDK client using the STRIPE_SECRET_KEY environment variable,
 * or null if the key is not configured. Callers should return 503 when null.
 *
 * The client is memoised per process lifetime. This is safe because API keys
 * are static (unlike OAuth tokens); the memoisation avoids creating a new
 * HTTP connection pool on every request.
 */
let _client: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_client) {
    _client = new Stripe(key);
  }
  return _client;
}
