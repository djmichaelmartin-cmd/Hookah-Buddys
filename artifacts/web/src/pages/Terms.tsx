import { Layout } from "@/components/Layout";
import { Link } from "wouter";

export default function Terms() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl prose prose-invert">
        <h1 className="font-serif text-4xl text-primary mb-8">Terms of Service</h1>
        <p className="lead text-muted-foreground">Welcome to HookahDolls.com. By accessing or using our platform, you agree to be bound by these Terms of Service.</p>
        
        <h3>1. Age Restriction</h3>
        <p>HookahDolls.com is strictly for users who are 21 years of age or older. By registering for an account, you represent and warrant that you are at least 21 years old.</p>
        
        <h3>2. Content Policy & Hookah Requirement</h3>
        <p>This is a premium hookah-centered lifestyle platform. All creator content MUST feature a visible hookah. Explicit, illegal, or non-consensual content is strictly prohibited and will result in immediate account termination.</p>
        
        <h3>3. Payments & Subscriptions</h3>
        <p>All payments are final. Subscriptions automatically renew unless canceled. You are responsible for all charges incurred under your account.</p>
        
        <div className="mt-12 flex gap-4 not-prose">
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link href="/content-rules" className="text-primary hover:underline">Content Guidelines</Link>
        </div>
      </div>
    </Layout>
  );
}
