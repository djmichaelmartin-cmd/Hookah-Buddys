import {  useGetBusinessInsights, getGetBusinessInsightsQueryKey , BusinessDetail } from "@workspace/api-client-react";
import { BarChart3, Users, Eye, Star, MapPin } from "lucide-react";

export function DashboardInsights({ business }: { business: BusinessDetail }) {
  const { data: insights, isLoading } = useGetBusinessInsights(business.handle, {
    query: { enabled: !!business.handle, queryKey: getGetBusinessInsightsQueryKey(business.handle) }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-[#D6B56D]" /> Insights & Analytics</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading insights...</div>
      ) : !insights ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No insights available.</p>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Profile Views" value={insights.profileViews} icon={<Eye className="w-5 h-5 text-blue-400" />} />
            <StatCard label="New Followers" value={insights.newFollowers} icon={<Users className="w-5 h-5 text-purple-400" />} />
            <StatCard label="Check-ins" value={insights.newCheckIns} icon={<MapPin className="w-5 h-5 text-green-400" />} />
            <StatCard label="New Reviews" value={insights.newReviews} icon={<Star className="w-5 h-5 text-yellow-400" />} />
          </div>
          
          <div className="bg-card border border-white/10 rounded-2xl p-6 h-64 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 flex items-end justify-between px-12 pt-12 pb-4">
              {/* Fake chart bars just for aesthetics since we don't have a charting library */}
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="w-12 bg-white rounded-t-sm" style={{ height: `${Math.max(20, Math.random() * 100)}%` }} />
              ))}
            </div>
            <div className="relative z-10 text-center text-white/40">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Detailed event breakdown available on premium plans.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value?: number; icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-white/10 p-5 rounded-2xl hover:border-white/20 transition-colors">
      <div className="flex justify-between items-start mb-2">
        <p className="text-sm font-medium text-white/60">{label}</p>
        <div className="p-2 bg-background rounded-lg">{icon}</div>
      </div>
      <h3 className="text-2xl font-bold text-white">{value || 0}</h3>
    </div>
  );
}
