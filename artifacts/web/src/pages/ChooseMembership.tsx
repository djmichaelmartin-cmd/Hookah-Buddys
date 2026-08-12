import { useListPlans, getListPlansQueryKey, useGetCurrentUser, Plan } from "@workspace/api-client-react";
import { CREDIT_COST_ITEMS } from "@workspace/pricing";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Crown, Check, Coins } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

export default function ChooseMembership() {
  const { data: session } = useGetCurrentUser();
  const isMember = session?.authenticated && session.user?.role === "member";
  const { data: plans, isLoading } = useListPlans(
    { audience: "member" },
    { query: { queryKey: getListPlansQueryKey({ audience: "member" }) } }
  );

  const getBadgeText = (slug: string) => {
    switch (slug) {
      case "bronze": return "Free Social Profile";
      case "silver": return "Social Plus";
      case "gold": return "Most Popular";
      case "platinum": return "VIP Access";
      default: return "";
    }
  };

  const getButtonText = (slug: string) => {
    if (slug === "bronze") return "Create Free Profile";
    return `Upgrade to ${slug.charAt(0).toUpperCase() + slug.slice(1)}`;
  };

  const memberPlans = (plans ?? []).filter(p => p.audience === "member");

  // Re-order to bronze, silver, gold, platinum if needed, assuming API returns in order of tier/price.
  const orderedPlans = memberPlans.sort((a, b) => a.price - b.price);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-serif text-white mb-4">Create Your Profile</h1>
          <p className="text-muted-foreground mb-4 max-w-2xl mx-auto">
            Join the HookahDolls social community for free. Create your profile, post hookah
            content, follow users, make friends, and explore the feed. Upgrade anytime for
            credits, premium access, and VIP features.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-8 max-w-2xl mx-auto">
            HookahDolls is free to join. Create a profile, post in the hookah feed, follow users,
            add friends, and explore the community. Paid plans are optional upgrades that include
            monthly credits and premium Doll access.
          </p>
          <h2 className="text-xl font-serif text-white mb-10">Choose how you want to join</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {isLoading ? (
            <p className="col-span-full text-center text-muted-foreground">Loading plans...</p>
          ) : (
            orderedPlans.map((plan) => {
              const slug = plan.slug || "";
              return (
                <div
                  key={plan.id}
                  className={`bg-card/50 backdrop-blur-xl border ${
                    plan.highlighted ? "border-primary shadow-[0_0_30px_rgba(212,175,55,0.2)]" : "border-white/10"
                  } rounded-2xl p-8 flex flex-col relative`}
                >
                  {getBadgeText(slug) && (
                    <span className={`absolute -top-3 left-1/2 -translate-x-1/2 ${plan.highlighted ? "bg-primary text-primary-foreground" : "bg-white/10 text-white"} text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1`}>
                      {plan.highlighted && <Crown className="w-3 h-3" />} {getBadgeText(slug)}
                    </span>
                  )}
                  <h3 className="text-2xl font-serif font-bold text-white mb-2">{plan.name}</h3>
                  <div className="text-3xl font-bold text-primary mb-4">
                    {plan.price === 0 ? (
                      "Free to Join"
                    ) : (
                      <>
                        ${plan.price}
                        <span className="text-sm text-muted-foreground font-normal">/{plan.interval || "mo"}</span>
                      </>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm mb-6">{plan.description}</p>

                  <div className="mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-primary/80 mb-1">
                      Monthly Credits
                    </p>
                    <p className="text-lg font-semibold text-white flex items-center gap-2">
                      <Coins className="w-4 h-4 text-primary" />
                      {plan.monthlyCredits > 0
                        ? `${plan.monthlyCredits} included`
                        : "Pay as you go"}
                    </p>
                  </div>

                  <ul className="space-y-3 mb-8 text-left">
                    {plan.features?.map((f, i) => (
                      <li key={i} className="text-sm text-white flex items-start">
                        <Check className="w-4 h-4 text-primary mr-2 mt-0.5 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={
                      isMember
                        ? plan.price > 0
                          ? `/checkout?type=membership&plan=${slug}`
                          : "/dashboard/member"
                        : `/signup/bro?plan=${slug}`
                    }
                    className="w-full mt-auto block"
                  >
                    <Button
                      className={`w-full ${
                        plan.highlighted
                          ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                          : "bg-white/10 hover:bg-white/20 text-white"
                      }`}
                    >
                      {getButtonText(slug)}
                    </Button>
                  </Link>
                </div>
              );
            })
          )}
        </div>

        <div className="max-w-4xl mx-auto mt-20 bg-card/30 border border-white/10 rounded-2xl p-8">
          <h2 className="text-2xl font-serif text-white text-center mb-6">Free vs. Paid Access</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">Free profile access includes</h3>
              <ul className="space-y-2">
                {["Public social feed", "Profile creation", "Friends and follows", "Likes and comments", "Public photos and reels", "Basic profile browsing"].map((f) => (
                  <li key={f} className="text-sm text-muted-foreground flex items-start">
                    <Check className="w-4 h-4 text-primary mr-2 mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">Paid upgrades include</h3>
              <ul className="space-y-2">
                {["Monthly credits", "Paid Doll messaging", "Premium photo/video unlocks", "Video chat credits", "Enhanced discovery", "VIP badges and access"].map((f) => (
                  <li key={f} className="text-sm text-muted-foreground flex items-start">
                    <Crown className="w-4 h-4 text-primary mr-2 mt-0.5 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mt-12 bg-card/30 border border-white/10 rounded-2xl p-8">
          <h2 className="text-2xl font-serif text-white text-center mb-6">How Credits Work</h2>
          <div className="space-y-3">
            {CREDIT_COST_ITEMS.map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-white text-sm">{item.label}</span>
                <span className="text-primary font-medium text-sm">
                  {item.credits} {item.unit || "credits"}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
              <span className="text-white text-sm">Buy more credits anytime</span>
              <span className="text-primary font-medium text-sm">Packages available</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
