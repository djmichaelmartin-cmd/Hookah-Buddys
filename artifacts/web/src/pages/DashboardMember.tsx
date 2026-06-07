import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetCredits, useListFavorites, type CreditTransaction } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BuyCreditsDialog } from "@/components/BuyCreditsDialog";
import { Coins, ArrowDownCircle, ArrowUpCircle, Settings2, RefreshCw, CalendarClock } from "lucide-react";

function formatWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TransactionRow({ tx }: { tx: CreditTransaction }) {
  const positive = tx.amount >= 0;
  const Icon = tx.type === "adjustment" ? Settings2 : positive ? ArrowDownCircle : ArrowUpCircle;
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${positive ? "text-green-400" : "text-secondary"}`} />
        <div>
          <p className="text-sm text-white">{tx.description || (positive ? "Credits added" : "Credits spent")}</p>
          <p className="text-xs text-muted-foreground capitalize">{tx.type} &bull; {formatWhen(tx.createdAt)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold ${positive ? "text-green-400" : "text-secondary"}`}>
          {positive ? "+" : ""}{tx.amount} cr
        </p>
        {tx.amountCents != null && tx.amountCents > 0 && (
          <p className="text-xs text-muted-foreground">${(tx.amountCents / 100).toFixed(2)}</p>
        )}
      </div>
    </div>
  );
}

export default function DashboardMember() {
  const { data: credits } = useGetCredits();
  const { data: favorites } = useListFavorites();
  const [buyOpen, setBuyOpen] = useState(false);

  const transactions = credits?.transactions ?? [];
  const purchases = transactions.filter((t) => t.type === "purchase");
  const usage = transactions.filter((t) => t.type !== "purchase");

  const membershipBalance = credits?.membershipBalance ?? 0;
  const purchasedBalance = credits?.purchasedBalance ?? 0;
  const monthlyMembershipCredits = credits?.monthlyMembershipCredits ?? 0;
  const membershipPlanName = credits?.membershipPlanName ?? null;
  const nextRefreshAt = credits?.nextRefreshAt ?? null;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-serif text-white mb-8">Member Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" /> Current Balance
              </h3>
              <p className="text-3xl font-bold text-primary">{credits?.balance ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">membership + purchased credits</p>
            </div>
            <Button
              size="sm"
              className="mt-4 w-full bg-primary text-primary-foreground"
              onClick={() => setBuyOpen(true)}
            >
              Buy Credits
            </Button>
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" /> Membership Credits
            </h3>
            <p className="text-3xl font-bold text-white">
              {membershipBalance}
              {monthlyMembershipCredits > 0 && (
                <span className="text-base text-muted-foreground font-normal"> / {monthlyMembershipCredits}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthlyMembershipCredits > 0
                ? `Included with ${membershipPlanName ?? "your membership"} • expires each cycle`
                : "No active membership credits"}
            </p>
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
              <Coins className="w-4 h-4 text-primary" /> Purchased Credits
            </h3>
            <p className="text-3xl font-bold text-white">{purchasedBalance}</p>
            <p className="text-xs text-muted-foreground mt-1">never expire</p>
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" /> Next Refresh
            </h3>
            <p className="text-2xl font-bold text-white">
              {nextRefreshAt ? formatWhen(nextRefreshAt) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {nextRefreshAt ? "membership credits reset" : "subscribe for monthly credits"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h2 className="text-xl font-serif text-white mb-4">Purchase History</h2>
            {purchases.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No purchases yet. <button className="text-primary underline" onClick={() => setBuyOpen(true)}>Buy your first credits</button>.
              </p>
            ) : (
              <div>{purchases.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</div>
            )}
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h2 className="text-xl font-serif text-white mb-4">Usage History</h2>
            {usage.length === 0 ? (
              <p className="text-muted-foreground text-sm">No credit activity yet.</p>
            ) : (
              <div>{usage.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</div>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          Looking for memberships and plans? <Link href="/pricing" className="text-primary underline">View pricing</Link>.
        </p>
      </div>

      <BuyCreditsDialog open={buyOpen} onOpenChange={setBuyOpen} />
    </Layout>
  );
}
