import {  useListBusinessFollowers, useListBusinessRecentCheckins, getListBusinessFollowersQueryKey, getListBusinessRecentCheckinsQueryKey , BusinessDetail, BusinessFollower, BusinessCheckInPublic } from "@workspace/api-client-react";
import { Users, MapPin, User as UserIcon } from "lucide-react";

export function DashboardEngagement({ business }: { business: BusinessDetail }) {
  const { data: followerData, isLoading: followersLoading } = useListBusinessFollowers(business.handle, {}, {
    query: { enabled: !!business.handle, queryKey: getListBusinessFollowersQueryKey(business.handle, {}) }
  });

  const { data: checkins, isLoading: checkinsLoading } = useListBusinessRecentCheckins(business.handle, {}, {
    query: { enabled: !!business.handle, queryKey: getListBusinessRecentCheckinsQueryKey(business.handle, {}) }
  });

  const followers = followerData?.followers || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Followers */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-[#D6B56D]" />
          <h3 className="text-xl font-bold text-white">Recent Followers</h3>
        </div>
        
        <div className="bg-card border border-white/10 rounded-2xl overflow-hidden h-[400px] flex flex-col">
          {followersLoading ? (
            <div className="flex-1 flex items-center justify-center text-white/50">Loading followers...</div>
          ) : !followers || followers.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-white/50 text-sm">No followers yet.</div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {followers.map((f: BusinessFollower) => (
                <div key={f.userId} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl transition-colors">
                  <div className="w-10 h-10 rounded-full bg-background border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                    {f.userPhotoUrl ? <img src={f.userPhotoUrl} className="w-full h-full object-cover" /> : <UserIcon className="w-5 h-5 text-white/20"/>}
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">{f.userName || `User #${f.userId}`}</p>
                    <p className="text-xs text-white/40">Followed recently</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Check-ins */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-5 h-5 text-[#D6B56D]" />
          <h3 className="text-xl font-bold text-white">Recent Check-ins</h3>
        </div>
        
        <div className="bg-card border border-white/10 rounded-2xl overflow-hidden h-[400px] flex flex-col">
          {checkinsLoading ? (
            <div className="flex-1 flex items-center justify-center text-white/50">Loading check-ins...</div>
          ) : !checkins || checkins.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-white/50 text-sm">No recent check-ins.</div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {checkins.map((c: BusinessCheckInPublic) => (
                <div key={c.id} className="flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-background border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {c.userPhotoUrl ? <img src={c.userPhotoUrl} className="w-full h-full object-cover" /> : <UserIcon className="w-5 h-5 text-white/20"/>}
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{c.userName || `User #${c.userId}`}</p>
                      <p className="text-xs text-white/40">{new Date(c.createdAt || "").toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
