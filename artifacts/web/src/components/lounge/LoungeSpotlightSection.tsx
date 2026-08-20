import { useState, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLocalLoungeSpotlight,
  useToggleBusinessFollow,
  useStartBusinessConversation,
  getGetLocalLoungeSpotlightQueryKey,
  type LoungeSpotlightCard
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/error";
import { MapPin, Star, BadgeCheck, MessageCircle, UserPlus, UserCheck, Clock, CheckCircle } from "lucide-react";

function SpotlightCard({ business, onRequireAuth }: { business: LoungeSpotlightCard; onRequireAuth: () => boolean }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const toggleFollow = useToggleBusinessFollow({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLocalLoungeSpotlightQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Failed to update follow status", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const startMessage = useStartBusinessConversation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Conversation started" });
        setLocation("/messages");
      },
      onError: (err) => {
        toast({ title: "Failed to message", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleFollow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRequireAuth()) return;
    toggleFollow.mutate({ handle: business.handle });
  };

  const handleMessage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRequireAuth()) return;
    startMessage.mutate({ handle: business.handle });
  };

  return (
    <div 
      className="relative group overflow-hidden rounded-2xl bg-card border border-white/10 hover:border-primary/40 transition-colors flex flex-col h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" 
      data-testid={`card-spotlight-${business.handle}`}
      role="link"
      aria-label={`View ${business.name} business page`}
      tabIndex={0}
      onClick={() => setLocation(`/business/${business.handle}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setLocation(`/business/${business.handle}`);
        }
      }}
    >
      {/* Cover / Logo Header */}
      <div className="h-32 relative bg-muted shrink-0">
        {business.coverUrl ? (
          <img src={business.coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
        <div className="absolute -bottom-6 left-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-card bg-background relative z-10">
            {business.logoUrl ? (
              <img src={business.logoUrl} alt={business.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-primary/20 flex items-center justify-center text-xl font-serif text-primary">
                {business.name.charAt(0)}
              </div>
            )}
          </div>
        </div>
        <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
          {business.featured && (
            <span className="bg-[#D6B56D] text-background text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shadow-sm">
              Featured
            </span>
          )}
          {business.openNow !== null && business.openNow !== undefined && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shadow-sm flex items-center gap-1 ${business.openNow ? 'bg-[#31C48D] text-background' : 'bg-muted text-muted-foreground'}`}>
              <Clock className="w-3 h-3" />
              {business.openNow ? 'Open' : 'Closed'}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 pt-8 flex flex-col flex-1">
        <div className="flex justify-between items-start gap-2 mb-1">
          <h3 className="font-serif text-lg font-bold text-white flex items-center gap-1.5 leading-tight">
            <span className="group-hover:text-primary transition-colors">
              {business.name}
            </span>
            {business.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" />}
          </h3>
          <span className="shrink-0 bg-primary/15 text-primary text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
            {business.distanceMiles.toFixed(1)} mi
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-3">
          <span className="uppercase tracking-wider">{business.category || business.businessType}</span>
          {business.city && business.state && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {business.city}, {business.state}
            </span>
          )}
          {typeof business.averageRating === 'number' && (
            <span className="flex items-center gap-1 text-primary">
              <Star className="w-3 h-3 fill-primary" />
              {business.averageRating.toFixed(1)} ({business.reviewCount})
            </span>
          )}
        </div>

        {business.tagline && (
          <p className="text-sm text-white/80 line-clamp-2 mb-4 flex-1">
            {business.tagline}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 mt-auto pt-4 border-t border-white/5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFollow}
            disabled={toggleFollow.isPending}
            className={`w-full ${business.followed ? 'text-primary border-primary/30 bg-primary/5 hover:bg-primary/10 hover:text-primary' : 'text-white border-white/20 hover:bg-white/5'}`}
            data-testid={`button-follow-${business.handle}`}
          >
            {business.followed ? (
              <><UserCheck className="w-4 h-4 mr-1.5" /> Following</>
            ) : (
              <><UserPlus className="w-4 h-4 mr-1.5" /> Follow</>
            )}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleMessage}
            disabled={startMessage.isPending}
            className="w-full"
            data-testid={`button-message-${business.handle}`}
          >
            <MessageCircle className="w-4 h-4 mr-1.5" /> Message
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full col-span-2 text-muted-foreground hover:text-white"
            onClick={(e) => { e.stopPropagation(); }}
            asChild
          >
            <Link href={`/business/${business.handle}`} data-testid={`link-business-${business.handle}`}>
              View Business
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LoungeSpotlightSection() {
  const { data: spotlight, isLoading, isError } = useGetLocalLoungeSpotlight();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleRequireAuth = useCallback(() => {
    if (spotlight?.state === "login_required") {
      toast({ title: "Sign in required", description: "Please log in to perform this action.", variant: "destructive" });
      setLocation("/login");
      return false;
    }
    return true;
  }, [spotlight, toast, setLocation]);

  if (isLoading) {
    return (
      <div className="py-8 animate-pulse" data-testid="page-spotlight-loading">
        <div className="h-8 w-64 bg-white/10 rounded mb-2"></div>
        <div className="h-4 w-48 bg-white/10 rounded mb-6"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-80 bg-card rounded-2xl border border-white/10"></div>)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-6 mb-8" data-testid="page-spotlight-error">
        <div className="bg-card border border-destructive/30 bg-destructive/10 rounded-2xl p-6 text-center">
          <p className="text-sm text-destructive font-medium mb-2">Unable to load Lounge Spotlight</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="#all-lounges">Browse All Lounges</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!spotlight) return null;

  return (
    <div className="py-6 mb-8" data-testid="section-lounge-spotlight">
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
          <Star className="w-6 h-6 text-[#D6B56D] fill-[#D6B56D]" />
          Today's Lounge Spotlight Near You
        </h2>
        <p className="text-muted-foreground text-sm">
          Top-rated businesses within {spotlight.radiusMiles || 25} miles of your location.
        </p>
      </div>

      {(spotlight.state === "location_required" || spotlight.state === "login_required" || spotlight.state === "empty") && spotlight.businesses.length === 0 ? (
        <div className="bg-card border border-white/10 rounded-2xl p-8 text-center flex flex-col items-center" data-testid={`page-spotlight-${spotlight.state}`}>
          <MapPin className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          {spotlight.state === "empty" ? (
            <h3 className="text-lg font-bold text-white mb-4">
              {spotlight.message === `No local Lounge Spotlights found within ${spotlight.radiusMiles || 25} miles.` 
                ? spotlight.message 
                : `No local Lounge Spotlights found within ${spotlight.radiusMiles || 25} miles.`}
            </h3>
          ) : (
            <>
              <h3 className="text-lg font-bold text-white mb-2">
                {spotlight.state === "login_required"
                  ? "Log in or add your city to see Lounge Spotlights near you."
                  : "Add your city to see local Lounge Spotlights near you."}
              </h3>
              {spotlight.message !== "Log in or add your city to see Lounge Spotlights near you." && 
               spotlight.message !== "Add your city to see local Lounge Spotlights near you." && (
                 <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
                   {spotlight.message}
                 </p>
               )}
            </>
          )}
          
          <div className="flex gap-3">
            {spotlight.state === "empty" ? (
              <Button asChild>
                <a href="#all-lounges">Browse All Lounges</a>
              </Button>
            ) : null}
            {spotlight.state === "login_required" ? (
              <Button asChild>
                <Link href="/login">Log in</Link>
              </Button>
            ) : null}
            {(spotlight.state === "location_required" || spotlight.state === "login_required") ? (
              <Button variant="outline" asChild>
                <Link href="/profile/edit">Update Profile City</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {spotlight.businesses.map(business => (
              <SpotlightCard 
                key={business.id} 
                business={business} 
                onRequireAuth={handleRequireAuth} 
              />
            ))}
          </div>
          
          {spotlight.state === "partial" && (
            <div className="mt-6 text-center text-sm text-muted-foreground" data-testid="page-spotlight-partial">
              <CheckCircle className="w-4 h-4 inline-block mr-1.5 opacity-70" />
              More local Lounge Spotlights coming soon.
            </div>
          )}
        </>
      )}
    </div>
  );
}
