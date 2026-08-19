import { Layout } from "@/components/Layout";
import { Link } from "wouter";

export default function Privacy() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl prose prose-invert">
        <h1 className="font-serif text-4xl text-primary mb-8">Privacy Policy</h1>
        <p className="lead text-muted-foreground">Your privacy matters to us. This policy explains what we collect on HookahBuddys.com and how we use it.</p>

        <h3>1. Information We Collect</h3>
        <p>We collect account details (name, email, location), age confirmation, and for Buddies, verification documents used solely to confirm identity and eligibility. Payment activity is processed by our payment partner; we do not store full card numbers.</p>

        <h3>2. Age & Identity Verification</h3>
        <p>Because HookahBuddys.com is strictly 21+, we may store proof of age confirmation. Buddy verification materials (government ID, selfie, and a hookah verification photo/video) are retained only as long as needed to maintain a verified status.</p>

        <h3>3. How We Use Your Data</h3>
        <p>We use your data to operate the platform, process payments, prevent fraud and abuse, enforce our content rules, and communicate with you about your account.</p>

        <h3>4. Sharing</h3>
        <p>We do not sell your personal data. We share data only with service providers (payment processing, hosting) under contract, or when required by law.</p>

        <h3>5. Your Choices</h3>
        <p>You may request access to or deletion of your account data at any time via our <Link href="/contact" className="text-primary hover:underline">contact page</Link>.</p>

        <div className="mt-12 flex flex-wrap gap-4 not-prose">
          <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link href="/content-rules" className="text-primary hover:underline">Content Guidelines</Link>
          <Link href="/refund-policy" className="text-primary hover:underline">Refund Policy</Link>
        </div>
      </div>
    </Layout>
  );
}
