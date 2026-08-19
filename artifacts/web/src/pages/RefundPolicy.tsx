import { Layout } from "@/components/Layout";
import { Link } from "wouter";

export default function RefundPolicy() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl prose prose-invert">
        <h1 className="font-serif text-4xl text-primary mb-8">Refund Policy</h1>
        <p className="lead text-muted-foreground">Please read this policy carefully before making any purchase on HookahBuddys.com.</p>

        <h3>1. Digital Goods Are Final</h3>
        <p>Subscriptions, message credits, premium content unlocks, video chat sessions, and profile boosts are digital goods delivered instantly. As such, all sales are final and non-refundable once delivered or consumed.</p>

        <h3>2. Subscriptions</h3>
        <p>Subscriptions renew automatically until canceled. You may cancel at any time from your dashboard; cancellation stops future charges but does not refund the current billing period.</p>

        <h3>3. Credits</h3>
        <p>Purchased credits are non-refundable and have no cash value. Unused credits remain available in your account balance.</p>

        <h3>4. Exceptions</h3>
        <p>If you were charged in error or experienced a verified technical failure that prevented delivery, contact us within 7 days and we will review your case individually.</p>

        <p className="text-sm text-muted-foreground">Note: This platform uses a placeholder checkout for demonstration. No real charges are processed.</p>

        <div className="mt-12 flex flex-wrap gap-4 not-prose">
          <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link href="/contact" className="text-primary hover:underline">Contact Support</Link>
        </div>
      </div>
    </Layout>
  );
}
