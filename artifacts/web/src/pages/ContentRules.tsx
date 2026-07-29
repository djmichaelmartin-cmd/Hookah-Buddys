import { Layout } from "@/components/Layout";
import { Link } from "wouter";

export default function ContentRules() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl prose prose-invert">
        <h1 className="font-serif text-4xl text-primary mb-8">Content Guidelines</h1>
        <p className="lead text-muted-foreground">HookahDolls.com is a premium hookah lifestyle platform. These rules keep our community safe, classy, and on-brand.</p>

        <h3>1. The Hookah Rule</h3>
        <p><strong>Every piece of Doll content must include a clearly visible hookah.</strong> This is the core of our brand. Content without a visible hookah will be rejected during moderation.</p>

        <h3>2. Strictly 21+</h3>
        <p>All Dolls must be verified adults aged 21 or older. Any content suggesting a minor, or any attempt to misrepresent age, results in an immediate permanent ban and may be reported to authorities.</p>

        <h3>3. Prohibited Content</h3>
        <p>No explicit sexual content, no illegal substances or activity, no hate speech, no harassment, and no non-consensual or impersonated content. Keep it tasteful and lounge-appropriate.</p>

        <h3>4. Moderation</h3>
        <p>All uploads are reviewed before going live. Our moderation team may remove content, issue warnings, or suspend accounts that violate these guidelines. You can report content using the report tools throughout the site.</p>

        <h3>5. Originality</h3>
        <p>Only upload content you own and have the right to share. Stolen or watermarked third-party content is prohibited.</p>

        <h3 className="text-secondary mt-12 pt-8 border-t border-white/10">6. Public Feed & Social Features</h3>
        <p>The public feed is the heart of the community. Posts, photos, and reels must be hookah-related.</p>
        <p><strong>Allowed:</strong> Lounges, setups, flavors, events, memes, reviews, photos, videos, discussion, profiles, friend posts.</p>
        <p><strong>Not Allowed:</strong> Spam, harassment, fake profiles, stolen content, illegal content, underage content, misleading posts, posting others' private information without consent, public street addresses, hate speech targeting individuals or groups.</p>
        <p className="text-sm text-muted-foreground"><em>Note: While Doll premium and verification content must show a visible hookah, general feed discussion only needs to be hookah-related. All reports are reviewed by administration.</em></p>

        <h3>7. Profile Guidelines</h3>
        <p>Your profile represents you on HookahDolls. Provide truthful information. Do not impersonate others. Do not steal photos from other accounts or the internet. Respect others' privacy settings — do not share private profile information without permission.</p>

        <h3>8. Enforcement</h3>
        <p>HookahDolls may remove violating content, issue warnings, temporarily suspend accounts, or permanently ban accounts that repeatedly violate these rules. We take safety and community standards seriously.</p>

        <div className="mt-12 flex flex-wrap gap-4 not-prose">
          <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link href="/refund-policy" className="text-primary hover:underline">Refund Policy</Link>
        </div>
      </div>
    </Layout>
  );
}
