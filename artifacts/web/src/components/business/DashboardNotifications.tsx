import {  useListBusinessNotifications, getListBusinessNotificationsQueryKey , BusinessDetail, BusinessNotificationItem } from "@workspace/api-client-react";
import { Bell, Heart, Star, MessageSquare, MapPin } from "lucide-react";

export function DashboardNotifications({ business }: { business: BusinessDetail }) {
  const { data: notifications, isLoading } = useListBusinessNotifications(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessNotificationsQueryKey(business.handle) }
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'review': return <Star className="w-5 h-5 text-yellow-400" />;
      case 'message': return <MessageSquare className="w-5 h-5 text-blue-400" />;
      case 'checkin': return <MapPin className="w-5 h-5 text-green-400" />;
      case 'follow': return <Heart className="w-5 h-5 text-purple-400" />;
      default: return <Bell className="w-5 h-5 text-white/40" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><Bell className="w-5 h-5 text-[#D6B56D]" /> Notifications</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading notifications...</div>
      ) : !notifications || notifications.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <Bell className="w-12 h-12 mx-auto mb-4 text-white/10" />
          <p className="text-white/50">You're all caught up!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notif: BusinessNotificationItem) => (
            <div key={notif.id} className="flex items-start gap-4 p-4 bg-card border border-white/10 rounded-xl hover:bg-white/5 transition-colors">
              <div className="p-2 bg-background rounded-full border border-white/5 shrink-0 mt-0.5">
                {getIcon(notif.type)}
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">{notif.title}</h4>
                <p className="text-sm text-white/60 mt-1">{notif.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
