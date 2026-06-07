import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useGetCredits, useListFavorites, type CreditTransaction } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BuyCreditsDialog } from "@/components/BuyCreditsDialog";
import { Coins, ArrowDownCircle, ArrowUpCircle, Settings2 } from "lucide-react";

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

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-serif text-white mb-8">Member Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" /> Available Credits
              </h3>
              <p className="text-3xl font-bold text-primary">{credits?.balance ?? 0}</p>
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
            <h3 className="text-sm text-muted-foreground mb-2">Lifetime Spent</h3>
            <p className="text-3xl font-bold text-white">
              {usage.reduce((sum, t) => sum + Math.min(0, t.amount), 0) * -1}
            </p>
            <p className="text-xs text-muted-foreground mt-1">credits used</p>
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
            <h3 className="text-sm text-muted-foreground mb-2">Saved Favorites</h3>
            <p className="text-3xl font-bold text-white">{favorites?.length ?? 0}</p>
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
