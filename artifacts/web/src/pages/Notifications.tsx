import { Layout } from "@/components/Layout";
import { useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, getListNotificationsQueryKey, getGetUnreadNotificationCountQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Heart, MessageCircle, UserPlus, Info, Circle, CalendarClock, CalendarX, Megaphone, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Notifications() {
  const { data: notifications, isLoading } = useListNotifications();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const markRead = useMarkNotificationRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
      }
    }
  });

  const markAllRead = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
        toast({ title: "All caught up", description: "All notifications marked as read." });
      }
    }
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-2xl text-center text-muted-foreground">
          Loading notifications...
        </div>
      </Layout>
    );
  }

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

  const getIcon = (n: any) => {
    switch (n.type) {
      case "like": return <Heart className="w-5 h-5 text-primary fill-primary/20" />;
      case "comment": return <MessageCircle className="w-5 h-5 text-secondary fill-secondary/20" />;
      case "follow": return <UserPlus className="w-5 h-5 text-green-400" />;
      case "event_reminder": return <CalendarClock className="w-5 h-5 text-primary" />;
      case "event_cancelled": return <CalendarX className="w-5 h-5 text-destructive" />;
      case "event_update": return <Megaphone className="w-5 h-5 text-orange-400" />;
      default:
        if (n.relatedReelId) return <Zap className="w-5 h-5 text-primary fill-primary/20" />;
        return <Info className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getLink = (n: any) => {
    if (n.relatedReelId) return `/sparks/${n.relatedReelId}`;
    if (n.type === "event_update" && n.relatedGroupId) return `/meetups/${n.relatedGroupId}`;
    if (n.relatedEventId) return `/events/${n.relatedEventId}`;
    if (n.relatedPostId) return `/feed?post=${n.relatedPostId}`;
    if (n.relatedUserId) return `/bros/${n.relatedUserId}`;
    return "#";
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-3xl text-white flex items-center gap-3">
              <Bell className="w-6 h-6 text-primary" /> Notifications
            </h1>
            <p className="text-muted-foreground mt-1">You have {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}.</p>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate(undefined)}
              disabled={markAllRead.isPending}
              className="border-white/10 hover:bg-white/10 text-muted-foreground hover:text-white rounded-full"
            >
              <CheckCheck className="w-4 h-4 mr-2" /> Mark all read
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {notifications?.length === 0 ? (
            <div className="bg-card/30 backdrop-blur-md border border-white/5 rounded-2xl p-12 text-center">
              <Bell className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-serif text-white mb-2">You're all caught up!</h3>
              <p className="text-muted-foreground">When someone interacts with you, you'll see it here.</p>
            </div>
          ) : (
            notifications?.map(n => (
              <div
                key={n.id}
                className={`relative group bg-card/40 backdrop-blur-md border rounded-2xl p-4 md:p-5 transition-all ${
                  n.isRead ? "border-white/5 opacity-75" : "border-primary/20 bg-primary/5"
                }`}
              >
                {!n.isRead && (
                  <div className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 bg-primary rounded-full shadow-[0_0_10px_rgba(24,119,242,0.8)]" />
                )}
                <div className="flex gap-4 items-start">
                  <div className="shrink-0 mt-1">
                    {getIcon(n)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-medium mb-1">{n.title}</h4>
                    <p className="text-sm text-white/70 mb-2">{n.message}</p>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt))} ago</span>
                      {!n.isRead && (
                        <button
                          onClick={() => markRead.mutate({ id: n.id })}
                          className="text-xs text-primary hover:underline font-medium"
                        >
                          Mark as read
                        </button>
                      )}
                      {getLink(n) !== "#" && (
                        <Link href={getLink(n)} className="text-xs text-white hover:text-primary transition-colors">
                          View details &rarr;
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
