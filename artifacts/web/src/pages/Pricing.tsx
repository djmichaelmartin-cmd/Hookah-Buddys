import { Layout } from "@/components/Layout";
import {
  useListPlans,
  useGetCurrentUser,
  useListSubscriptions,
  getListSubscriptionsQueryKey,
  useCreateSubscription,
  type Plan,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Check, MessageSquare, ImageIcon, Video, Lock, Star, Crown, Coins } from "lucide-react";
import { CreditPackageGrid, CreditUsesList } from "@/components/BuyCreditsDialog";
import { isCheckoutRequired } from "@/lib/checkoutRequired";

const ADDITIONAL_FEATURES = [
  { icon: MessageSquare, label: "Direct messaging" },
  { icon: ImageIcon, label: "Premium photo access" },
  { icon: Video, label: "Premium video access" },
  { icon: Video, label: "Private video chats" },
  { icon: Star, label: "Content subscriptions" },
  { icon: Lock, label: "Exclusive content unlocks" },
];

export default function Pricing() {
  const { data: plans, isLoading } = useListPlans();
  const { data: session } = useGetCurrentUser();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const role = session?.user?.role;
  const isMember = role === "member";

  const { data: subscriptions } = useListSubscriptions({
    query: { enabled: isMember, queryKey: getListSubscriptionsQueryKey() },
  });
  const currentPlanId = (subscriptions ?? []).find(
    (s) => s.audience === "member" && s.status === "active" && !s.dollId,
  )?.planId;

  const subscribe = useCreateSubscription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Membership active", description: "Your membership has been updated." });
        queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
        navigate("/dashboard/member");
      },
      onError: (err) => {
        if (isCheckoutRequired(err)) {
          const slug = (plans ?? []).find((p) => p.id === subscribe.variables?.data.planId)?.slug;
          toast({
            title: "Payment required",
            description: "Complete secure checkout to activate this membership.",
          });
          navigate(slug ? `/checkout?type=membership&plan=${slug}` : "/pricing");
          return;
        }
        toast({ title: "Could not update membership", description: "Please try again.", variant: "destructive" });
      },
    },
  });

  const memberPlans = (plans ?? []).filter((p) => p.audience === "member");
  const dollPlans = (plans ?? []).filter((p) => p.audience === "doll");

  const handleSelect = (plan: Plan) => {
    if (!session?.user) {
      navigate(`/signup/bro?plan=${plan.slug}`);
      return;
    }
    if (plan.audience === "member" && role !== "member") {
      toast({ title: "Members only", description: "Sign in as a member to choose this plan.", variant: "destructive" });
      return;
    }
    if (plan.audience === "doll" && role !== "doll") {
      toast({ title: "For Buddys only", description: "This plan is for verified Buddys.", variant: "destructive" });
      return;
    }
    if (plan.audience === "doll") {
      navigate("/checkout");
      return;
    }
    if (plan.price === 0) {
      toast({ title: "You're all set", description: "Free membership is active by default." });
      navigate("/dashboard/member");
      return;
    }
    // Paid plans go through the membership checkout flow rather than
    // activating directly.
    navigate(`/checkout?type=membership&plan=${plan.slug}`);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-serif text-white mb-4">Memberships & Plans</h1>
          <p className="text-muted-foreground mb-4 max-w-2xl mx-auto">

            HookahBuddys is free to join. Paid plans are optional upgrades that include monthly
            credits for premium Buddy interactions.
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 mb-12 text-sm text-muted-foreground/80">
            <span>Free: profile, public feed, friends & follows, photos & reels, likes & comments</span>
            <span className="text-primary/80">Paid: monthly credits, Buddy messaging, premium unlocks, video chat, VIP features</span>
          </div>
        </div>

        <h2 className="text-2xl font-serif text-white text-center mb-8">Member Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          {isLoading ? (
            <p className="col-span-full text-center text-muted-foreground">Loading plans...</p>
          ) : (
            memberPlans.map((plan) => {
              const isCurrent = currentPlanId === plan.id || (isMember && !currentPlanId && plan.price === 0);
              const pending = subscribe.isPending && subscribe.variables?.data.planId === plan.id;
              const isPaid = plan.price > 0;
              const accentText = isPaid ? "text-[#D6B56D]" : "text-primary";
              const accentBg = isPaid ? "bg-[#D6B56D]" : "bg-primary";
              const accentHover = isPaid ? "hover:bg-[#C9A456]" : "hover:bg-primary/90";
              const accentTextForeground = isPaid ? "text-[#111111]" : "text-primary-foreground";
              const accentBorder = isPaid ? "border-[#D6B56D]/30" : "border-primary/30";
              const accentBgMuted = isPaid ? "bg-[#D6B56D]/10" : "bg-primary/10";
              const accentTextMuted = isPaid ? "text-[#D6B56D]/80" : "text-primary/80";

              return (
                <div
                  key={plan.id}
                  className={`bg-card/50 backdrop-blur-xl border ${
                    plan.highlighted ? "border-[#D6B56D] shadow-[0_0_30px_rgba(214,181,109,0.2)]" : "border-white/10"
                  } rounded-2xl p-8 flex flex-col relative`}
                >
                  {plan.highlighted && (
                    <span className={`absolute -top-3 left-1/2 -translate-x-1/2 ${accentBg} ${accentTextForeground} text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1`}>
                      <Crown className="w-3 h-3" /> Most Popular
                    </span>
                  )}
                  <h3 className="text-2xl font-serif font-bold text-white mb-2">{plan.name}</h3>
                  <div className={`text-3xl font-bold ${accentText} mb-4`}>
                    {plan.price === 0 ? (
                      "Free to Join"
                    ) : (
                      <>
                        ${plan.price}
                        <span className="text-sm text-muted-foreground font-normal">/{plan.interval}</span>
                      </>
                    )}
                  </div>
                  <p className="text-muted-foreground mb-6">{plan.description}</p>

                  <div className={`mb-6 rounded-xl border ${accentBorder} ${accentBgMuted} px-4 py-3`}>
                    <p className={`text-xs uppercase tracking-wide ${accentTextMuted} mb-1`}>
                      Monthly Credits Included
                    </p>
                    <p className="text-lg font-semibold text-white flex items-center gap-2">
                      <Coins className={`w-4 h-4 ${accentText}`} />
                      {plan.monthlyCredits > 0
                        ? `${plan.monthlyCredits} credits / month`
                        : "No included credits"}
                    </p>
                    {plan.monthlyCredits > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Refreshes every billing cycle &bull; no rollover
                      </p>
                    )}
                  </div>

                  <ul className="space-y-3 mb-8 text-left">
                    {plan.features?.map((f, i) => (
                      <li key={i} className="text-sm text-white flex items-start">
                        <Check className={`w-4 h-4 ${accentText} mr-2 mt-0.5 shrink-0`} /> {f}
                      </li>
                    ))}
                  </ul>

                  <Button
                    className={`w-full mt-auto ${
                      plan.highlighted
                        ? `${accentBg} ${accentHover} ${accentTextForeground}`
                        : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                    disabled={isCurrent || pending}
                    onClick={() => handleSelect(plan)}
                  >
                    {isCurrent
                      ? "Current Plan"
                      : pending
                        ? "Updating..."
                        : !session?.user
                          ? `Choose ${plan.name}`
                          : plan.price === 0
                            ? "Continue Free"
                            : "Upgrade Plan"}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <div className="max-w-6xl mx-auto mt-20">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-serif text-white mb-2 flex items-center justify-center gap-2">
              <Coins className="w-6 h-6 text-[#D6B56D]" /> Buy Credits
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Credits power messaging, content unlocks, and video chats — separate from your membership. Buy a pack and use them any time.
            </p>
          </div>
          <CreditPackageGrid />
          <div className="mt-8 max-w-2xl mx-auto bg-card/30 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-serif text-white text-center mb-4">How Credits Work</h3>
            <div className="max-w-sm mx-auto">
              <CreditUsesList />
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto mt-16 bg-card/30 border border-white/10 rounded-2xl p-8">
          <h2 className="text-2xl font-serif text-white text-center mb-2">Additional Paid Features</h2>
          <p className="text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
            Some interactions are paid separately with credits or one-off purchases, regardless of your membership.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {ADDITIONAL_FEATURES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 bg-background/40 border border-white/10 rounded-xl px-4 py-3">
                <Icon className="w-5 h-5 text-[#D6B56D] shrink-0" />
                <span className="text-sm text-white">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {dollPlans.length > 0 && (
          <>
            <h2 className="text-2xl font-serif text-white text-center mt-20 mb-8">Plans for Buddys</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              {dollPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`bg-card/50 backdrop-blur-xl border ${
                    plan.highlighted ? "border-secondary shadow-[0_0_30px_rgba(214,181,109,0.2)]" : "border-white/10"
                  } rounded-2xl p-6 flex flex-col`}
                >
                  <h3 className="text-xl font-serif font-bold text-white mb-2">{plan.name}</h3>
                  <div className="text-2xl font-bold text-secondary mb-4">
                    ${plan.price}
                    <span className="text-sm text-muted-foreground font-normal">/{plan.interval}</span>
                  </div>
                  <p className="text-muted-foreground text-sm mb-6">{plan.description}</p>
                  <ul className="space-y-2 mb-6 text-left">
                    {plan.features?.map((f, i) => (
                      <li key={i} className="text-sm text-white flex items-start">
                        <Check className="w-4 h-4 text-secondary mr-2 mt-0.5 shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                  {role === "doll" ? (
                    <Button
                      className="w-full mt-auto bg-white/10 hover:bg-white/20 text-white"
                      onClick={() => handleSelect(plan)}
                    >
                      Select Plan
                    </Button>
                  ) : (
                    <Link href="/signup/doll" className="w-full mt-auto">
                      <Button className="w-full bg-white/10 hover:bg-white/20 text-white">Apply as a Buddy</Button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
