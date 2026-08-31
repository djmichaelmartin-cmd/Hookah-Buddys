import {
  useListPlans,
  getListPlansQueryKey,
  useListCreditPackages,
  Plan,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import {
  User,
  Sparkles,
  Coins,
  Crown,
  Check,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";

export default function ChooseMembership() {
  const { data: memberPlans, isLoading: isLoadingMember } = useListPlans(
    { audience: "member" },
    { query: { queryKey: getListPlansQueryKey({ audience: "member" }) } },
  );

  const { data: dollPlans } = useListPlans(
    { audience: "doll" },
    { query: { queryKey: getListPlansQueryKey({ audience: "doll" }) } },
  );

  const { data: packages, isLoading: isLoadingPackages } =
    useListCreditPackages();

  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const type = searchParams.get("type");
  const plan = searchParams.get("plan");

  const setParams = (params: Record<string, string | undefined>) => {
    const url = new URL(window.location.href);
    Object.keys(params).forEach((key) => {
      if (params[key] === undefined) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, params[key]!);
      }
    });
    setLocation(url.pathname + url.search);
  };

  const handleBack = () => {
    if (plan) {
      setParams({ plan: undefined });
    } else if (type) {
      setParams({ type: undefined });
    }
  };

  const step = type === "male" && plan === "bronze" ? 3 : type ? 2 : 1;
  const isMale = type === "male";
  const isFemale = type === "female";

  const orderedMemberPlans = (memberPlans ?? []).sort(
    (a, b) => a.price - b.price,
  );
  const featuredDollPlan =
    (dollPlans ?? []).find((p) => p.highlighted) || (dollPlans ?? [])[0];
  const orderedPackages = (packages ?? []).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const ProgressIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-12">
      <div
        className={`h-1.5 w-16 rounded-full transition-colors duration-300 ${step >= 1 ? (isFemale ? "bg-pink-500" : isMale ? "bg-blue-500" : "bg-white") : "bg-white/20"}`}
      />
      <div
        className={`h-1.5 w-16 rounded-full transition-colors duration-300 ${step >= 2 ? (isFemale ? "bg-pink-500" : "bg-blue-500") : "bg-white/20"}`}
      />
      <div
        className={`h-1.5 w-16 rounded-full transition-colors duration-300 ${step >= 3 ? (isFemale ? "bg-pink-500" : "bg-blue-500") : "bg-white/20"}`}
      />
    </div>
  );

  const Step1 = () => (
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-serif text-white mb-4">
          Create Your Free Profile
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Start free as a Buddy. You can upgrade anytime for more access,
          credits, and premium features.
        </p>
        <h2 className="mt-8 text-xl font-semibold text-white">
          Are you a Male Buddy or Female Buddy?
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <button
          onClick={() => setParams({ type: "male" })}
          className="group relative flex flex-col items-center text-left bg-card/40 backdrop-blur-xl border border-white/5 hover:border-blue-500/50 rounded-[2rem] p-10 transition-all duration-300 hover:shadow-[0_0_40px_rgba(59,130,246,0.15)] overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="w-24 h-24 rounded-full bg-blue-500/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
            <User className="w-12 h-12 text-blue-400" />
          </div>
          <h2 className="text-3xl font-serif text-white mb-4">Male Buddy</h2>
          <p className="text-muted-foreground text-center mb-10 text-lg">
            Join the HookahBuddys social community, browse Buddys, post in The
            Lounge, join Groups, attend Meetups, and use credits for premium
            interactions.
          </p>
          <div className="mt-auto flex items-center text-blue-400 font-semibold group-hover:translate-x-2 transition-transform duration-300">
            I&apos;m a Male Buddy <ChevronRight className="w-5 h-5 ml-1" />
          </div>
        </button>

        <button
          onClick={() => setParams({ type: "female" })}
          className="group relative flex flex-col items-center text-left bg-card/40 backdrop-blur-xl border border-white/5 hover:border-pink-500/50 rounded-[2rem] p-10 transition-all duration-300 hover:shadow-[0_0_40px_rgba(236,72,153,0.15)] overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="w-24 h-24 rounded-full bg-pink-500/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-500">
            <Sparkles className="w-12 h-12 text-pink-400" />
          </div>
          <h2 className="text-3xl font-serif text-white mb-4">Female Buddy</h2>
          <p className="text-muted-foreground text-center mb-10 text-lg">
            Join the HookahBuddys social community, post content, connect with
            Buddys, and optionally upgrade to become a Creative Buddy.
          </p>
          <div className="mt-auto flex items-center text-pink-400 font-semibold group-hover:translate-x-2 transition-transform duration-300">
            I&apos;m a Female Buddy <ChevronRight className="w-5 h-5 ml-1" />
          </div>
        </button>
      </div>
    </div>
  );

  const PlanCard = ({
    plan,
    onSelect,
  }: {
    plan: Plan;
    onSelect: () => void;
  }) => {
    const isFree = plan.price === 0;
    const isHighlighted = plan.highlighted;

    const borderClass = isHighlighted
      ? "border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.15)]"
      : "border-white/10";
    const badgeClass = isHighlighted
      ? "bg-blue-500 text-white"
      : "bg-white/10 text-white";
    const btnClass = isHighlighted
      ? "bg-blue-600 hover:bg-blue-700 text-white"
      : "bg-white/10 hover:bg-white/20 text-white";

    return (
      <div
        className={`relative bg-card/40 backdrop-blur-xl border ${borderClass} rounded-3xl p-8 flex flex-col`}
      >
        {isHighlighted && (
          <span
            className={`absolute -top-3 left-1/2 -translate-x-1/2 ${badgeClass} text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-full flex items-center gap-1 whitespace-nowrap`}
          >
            <Crown className="w-3 h-3" /> Most Popular
          </span>
        )}
        <h3 className="text-xl font-serif text-white mb-2">{plan.name}</h3>
        <div className="mb-4">
          {isFree ? (
            <span className="text-3xl font-bold text-white">Free</span>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">
                ${plan.price}
              </span>
              <span className="text-muted-foreground">
                /{plan.interval || "mo"}
              </span>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-6 min-h-[40px]">
          {plan.description}
        </p>

        {!isFree && (
          <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-blue-400 mb-1">
              Monthly Credits
            </p>
            <p className="text-lg font-semibold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-blue-400" />
              {plan.monthlyCredits} included
            </p>
          </div>
        )}

        <ul className="space-y-3 mb-8 flex-1">
          {plan.features?.map((f, i) => (
            <li
              key={i}
              className="text-sm text-zinc-300 flex items-start gap-2"
            >
              <Check
                className={`w-4 h-4 mt-0.5 shrink-0 ${isHighlighted ? "text-blue-400" : "text-zinc-500"}`}
              />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Button
          onClick={onSelect}
          className={`w-full ${btnClass} h-12 rounded-xl font-semibold`}
        >
          {isFree ? "Stay Free" : `Choose ${plan.name.split("—")[0].trim()}`}
        </Button>
      </div>
    );
  };

  const Step2Male = () => (
    <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-right-8 duration-500 relative">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-serif text-white mb-4">
          Upgrade Your Membership?
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Stay free or upgrade for monthly credits, better access, and premium
          features.
        </p>
        <p className="mt-3 text-sm text-blue-300">
          You can stay free and still use the social side of HookahBuddys.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {isLoadingMember ? (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            Loading plans...
          </div>
        ) : (
          orderedMemberPlans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              onSelect={() => {
                if (p.price === 0) setParams({ plan: "bronze" });
                else setLocation(`/signup/member?type=male&plan=${p.slug}`);
              }}
            />
          ))
        )}
      </div>
    </div>
  );

  const Step2Female = () => {
    const creatorPlan = featuredDollPlan;

    return (
      <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-right-8 duration-500 relative">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-serif text-white mb-4">
            Become a Creative Buddy?
          </h1>
          <p className="text-muted-foreground text-lg">
            Create a free Buddy profile or upgrade to Creative Buddy to earn
            from premium content, private messages, video sessions, and custom
            content.
          </p>
          <p className="mt-3 text-sm text-pink-300">
            You can create a free Female Buddy profile now and upgrade to
            Creative Buddy anytime.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Stay Free */}
          <div className="bg-card/40 backdrop-blur-xl border border-pink-500/20 rounded-[2rem] p-10 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
              <Sparkles className="w-48 h-48 text-pink-500" />
            </div>
            <h2 className="text-3xl font-serif text-white mb-2">Stay Free</h2>
            <div className="text-3xl font-bold text-pink-400 mb-6">Free</div>
            <p className="text-muted-foreground mb-8 text-lg">
              Create a standard profile. Browse the lounge, follow your favorite
              creators, and make Buddys.
            </p>
            <ul className="space-y-4 mb-10 flex-1">
              <li className="text-zinc-300 flex items-start gap-3">
                <Check className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />{" "}
                Public Lounge access
              </li>
              <li className="text-zinc-300 flex items-start gap-3">
                <Check className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />{" "}
                Follow and like content
              </li>
              <li className="text-zinc-300 flex items-start gap-3">
                <Check className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />{" "}
                Direct messaging
              </li>
            </ul>
            <Button
              onClick={() =>
                setLocation("/signup/member?type=female&plan=bronze")
              }
              className="w-full bg-pink-600 hover:bg-pink-700 text-white h-14 rounded-xl font-bold text-lg"
            >
              Create Free Profile
            </Button>
          </div>

          {/* Creative Buddy */}
          <div className="min-h-[680px] bg-card/40 backdrop-blur-xl border border-[#E85D75]/50 shadow-[0_0_40px_rgba(232,93,117,0.18)] rounded-[2rem] px-10 py-12 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
              <Crown className="w-48 h-48 text-[#E85D75]" />
            </div>
            <span className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#E85D75] text-white text-[10px] uppercase tracking-wider font-bold px-4 py-1 rounded-full flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Creator Program
            </span>
            <h2 className="text-3xl font-serif text-white mt-4 mb-2 relative z-10">
              Creative Buddy
            </h2>
            <div className="flex items-baseline gap-1 mb-6 relative z-10">
              <span className="text-3xl font-bold text-[#E85D75]">
                {creatorPlan ? `$${creatorPlan.price}` : "Loading…"}
              </span>
              {creatorPlan && (
                <span className="text-muted-foreground">
                  /{creatorPlan.interval || "month"}
                </span>
              )}
            </div>
            <p className="text-muted-foreground mb-8 text-lg relative z-10">
              {creatorPlan?.description || "Loading the Creative Buddy option…"}
            </p>
            <ul className="space-y-4 mb-10 flex-1 relative z-10">
              {creatorPlan?.features?.map((f, i) => (
                <li key={i} className="text-zinc-300 flex items-start gap-3">
                  <Check className="w-5 h-5 text-[#E85D75] shrink-0 mt-0.5" />{" "}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={
                creatorPlan
                  ? `/signup/doll?type=female&planId=${creatorPlan.id}`
                  : "#"
              }
              className="relative z-10 block"
            >
              <Button
                disabled={!creatorPlan}
                className="w-full bg-[#E85D75] hover:bg-[#D94A66] text-white font-bold h-14 rounded-xl text-lg"
              >
                Upgrade to Creative Buddy
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  };

  const Step3Credits = () => {
    const accentClass = isFemale ? "text-pink-400" : "text-blue-400";
    const btnClass = isFemale
      ? "bg-pink-600 hover:bg-pink-700"
      : "bg-blue-600 hover:bg-blue-700";
    const borderClass = isFemale ? "border-pink-500/30" : "border-blue-500/30";
    const bgClass = isFemale ? "bg-pink-500" : "bg-blue-500";

    return (
      <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-right-8 duration-500 relative">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-serif text-white mb-4">
            Want to Add Credits?
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Your free profile does not include monthly credits, but you can add
            a credit bundle now or skip and stay free.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {isLoadingPackages ? (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              Loading packages...
            </div>
          ) : (
            orderedPackages.map((pkg) => (
              <div
                key={pkg.id}
                className={`bg-card/40 backdrop-blur-xl border ${pkg.label ? borderClass + " shadow-[0_0_30px_rgba(0,0,0,0.2)]" : "border-white/10"} rounded-[1.5rem] p-8 flex flex-col relative`}
              >
                {pkg.label && (
                  <span
                    className={`absolute -top-3 left-1/2 -translate-x-1/2 ${bgClass} text-white text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-full whitespace-nowrap`}
                  >
                    {pkg.label}
                  </span>
                )}
                <h3 className="text-xl font-serif text-white mb-2">
                  {pkg.name}
                </h3>
                <div
                  className={`text-3xl font-bold mb-4 flex items-center gap-2 ${accentClass}`}
                >
                  <Coins className="w-6 h-6" /> {pkg.credits.toLocaleString()}
                </div>
                <div className="text-lg text-muted-foreground mb-8">
                  ${(pkg.priceCents / 100).toFixed(2)}
                </div>

                <Link
                  href={`/signup/member?type=${type}&plan=bronze&package=${pkg.id}`}
                  className="mt-auto block"
                >
                  <Button
                    className={`w-full h-12 rounded-xl font-semibold ${pkg.label ? btnClass + " text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
                  >
                    Select Package
                  </Button>
                </Link>
              </div>
            ))
          )}
        </div>

        <div className="text-center">
          <Link href={`/signup/member?type=${type}&plan=bronze`}>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-white h-12 px-8 rounded-xl"
            >
              Skip for now, continue to free profile
            </Button>
          </Link>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 min-h-[80vh] flex flex-col relative">
        {step > 1 && (
          <button
            onClick={handleBack}
            className="absolute top-16 left-4 md:left-8 flex items-center text-muted-foreground hover:text-white transition-colors z-50 font-medium"
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
          </button>
        )}

        <ProgressIndicator />

        <div className="flex-1 w-full">
          {step === 1 && <Step1 />}
          {step === 2 && isMale && <Step2Male />}
          {step === 2 && isFemale && <Step2Female />}
          {step === 3 && <Step3Credits />}
        </div>
      </div>
    </Layout>
  );
}
