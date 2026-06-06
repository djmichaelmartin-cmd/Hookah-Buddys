import { Layout } from "@/components/Layout";
import { useGetCredits, useListFavorites } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function DashboardMember() {
  const { data: credits } = useGetCredits();
  const { data: favorites } = useListFavorites();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-serif text-white mb-8">Member Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-card/50 border border-white/10 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-sm text-muted-foreground mb-2">Available Credits</h3>
              <p className="text-3xl font-bold text-primary">{credits?.balance || 0}</p>
            </div>
            <Link href="/checkout" className="mt-4 block"><Button size="sm" className="w-full bg-primary text-primary-foreground">Buy Credits</Button></Link>
          </div>
          
          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
             <h3 className="text-sm text-muted-foreground mb-2">Active Subscriptions</h3>
             <p className="text-3xl font-bold text-white">0</p>
          </div>

          <div className="bg-card/50 border border-white/10 rounded-xl p-6">
             <h3 className="text-sm text-muted-foreground mb-2">Saved Favorites</h3>
             <p className="text-3xl font-bold text-white">{favorites?.length || 0}</p>
          </div>
        </div>

        <div className="bg-card/50 border border-white/10 rounded-xl p-6">
          <h2 className="text-xl font-serif text-white mb-4">Recent Activity</h2>
          <p className="text-muted-foreground text-sm">No recent activity to show.</p>
        </div>
      </div>
    </Layout>
  );
}
