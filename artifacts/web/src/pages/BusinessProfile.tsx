import { useState } from "react";
import {
  BusinessDetail,
  BusinessServiceItem,
  BusinessProductItem,
  BusinessOfferItem,
  BusinessEvent,
  BusinessMediaItem,
  BusinessPostItem,
  BusinessPostComment,
  BusinessReviewItem,
} from "@workspace/api-client-react";
import { getErrorMessage } from "@/lib/error";
import { useLocation, useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { 
  useGetBusinessByHandle, 
  useListBusinessPosts, 
  useListBusinessServices, 
  useListBusinessProducts, 
  useListBusinessOffers, 
  useListBusinessReviews,
  useListBusinessEvents,
  useListBusinessMedia,
  useToggleBusinessFollow,
  useToggleBusinessSave,
  useCheckInToBusiness,
  useCreateBusinessReview,
  useCreateBusinessAppointment,
  useStartBusinessConversation,
  useGetCurrentUser,
  useToggleBusinessEventRsvp,
  useToggleBusinessPostLike,
  useToggleBusinessPostSave,
  useReportBusinessPost,
  useListBusinessPostComments,
  useDeleteBusinessPostComment,
  useCreateBusinessPostComment,
  useRecordBusinessMediaView,
  getGetBusinessByHandleQueryKey,
  getListBusinessPostsQueryKey,
  getListBusinessServicesQueryKey,
  getListBusinessProductsQueryKey,
  getListBusinessOffersQueryKey,
  getListBusinessReviewsQueryKey,
  getListBusinessEventsQueryKey,
  getListBusinessMediaQueryKey,
  getListBusinessPostCommentsQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  MapPin, Map, Star, Store, Heart, Bookmark, Edit, Info, Grid, Box, Gift, FileText, CheckCircle, XCircle, 
  Phone, Mail, Globe, User as UserIcon, MessageSquare, Share, Calendar, Image as ImageIcon, Film, Video, Flag, PlayCircle
} from "lucide-react";
import { ChildInteractions } from "@/components/business/ChildInteractions";
import { CustomerMediaUpload } from "@/components/business/CustomerMediaUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function BusinessProfile() {
  const { handle } = useParams<{ handle: string }>();
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: session } = useGetCurrentUser();
  const { data: business, isLoading, isError } = useGetBusinessByHandle(handle || "", {
    query: { enabled: !!handle, retry: false, queryKey: getGetBusinessByHandleQueryKey(handle || "") }
  });

  const { data: posts } = useListBusinessPosts(handle || "", { query: { enabled: !!business, queryKey: getListBusinessPostsQueryKey(handle || "") } });
  const { data: services } = useListBusinessServices(handle || "", { query: { enabled: !!business, queryKey: getListBusinessServicesQueryKey(handle || "") } });
  const { data: products } = useListBusinessProducts(handle || "", { query: { enabled: !!business, queryKey: getListBusinessProductsQueryKey(handle || "") } });
  const { data: offers } = useListBusinessOffers(handle || "", { query: { enabled: !!business, queryKey: getListBusinessOffersQueryKey(handle || "") } });
  const { data: reviews } = useListBusinessReviews(handle || "", { query: { enabled: !!business, queryKey: getListBusinessReviewsQueryKey(handle || "") } });
  
  const { data: events } = useListBusinessEvents(handle || "", { query: { enabled: !!business, queryKey: getListBusinessEventsQueryKey(handle || "") } });
  const { data: photos } = useListBusinessMedia(handle || "", { kind: "photo" }, { query: { enabled: !!business, queryKey: getListBusinessMediaQueryKey(handle || "", { kind: "photo" }) } });
  const { data: videos } = useListBusinessMedia(handle || "", { kind: "video" }, { query: { enabled: !!business, queryKey: getListBusinessMediaQueryKey(handle || "", { kind: "video" }) } });
  const { data: reels } = useListBusinessMedia(handle || "", { kind: "reel" }, { query: { enabled: !!business, queryKey: getListBusinessMediaQueryKey(handle || "", { kind: "reel" }) } });

  const toggleFollow = useToggleBusinessFollow({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBusinessByHandleQueryKey(handle || "") })
    }
  });

  const toggleSave = useToggleBusinessSave({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBusinessByHandleQueryKey(handle || "") })
    }
  });

  const checkIn = useCheckInToBusiness({
    mutation: {
      onSuccess: () => {
        toast({ title: "Checked in successfully!" });
        queryClient.invalidateQueries({ queryKey: getGetBusinessByHandleQueryKey(handle || "") });
      },
      onError: (err: unknown) => toast({ title: "Check-in failed", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const startConv = useStartBusinessConversation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Conversation started" });
      },
      onError: (err: unknown) => toast({ title: "Failed to message", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const requireAuth = (action: () => void) => {
    if (!session?.authenticated) {
      toast({ title: "Authentication required", description: "Please log in to perform this action.", variant: "destructive" });
      setLocation("/login");
    } else {
      action();
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: business?.name, url });
      } catch (e) {
        // Ignore aborts
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied to clipboard!" });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="animate-pulse h-[300px] bg-card/50" />
        <div className="container mx-auto px-4 max-w-5xl -mt-16 flex gap-6">
          <div className="w-32 h-32 rounded-2xl bg-card border-4 border-background" />
          <div className="flex-1 mt-16 space-y-4">
            <div className="h-8 bg-card/50 w-1/3 rounded" />
            <div className="h-4 bg-card/50 w-1/4 rounded" />
          </div>
        </div>
      </Layout>
    );
  }

  if (isError || !business) {
    return (
      <Layout>
        <div className="text-center py-32">
          <h2 className="text-2xl font-serif text-white mb-2">Business Not Found</h2>
          <p className="text-white/60 mb-6">The page you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/businesses")}>Browse Businesses</Button>
        </div>
      </Layout>
    );
  }

  const isOwner = business.viewerRole === 'owner';
  const isTeam = business.viewerIsTeam || isOwner;

  return (
    <Layout>
      {/* Cover Image */}
      <div className="h-[250px] md:h-[350px] w-full bg-[#171A21] relative border-b border-white/5">
        {business.coverUrl ? (
          <img src={business.coverUrl} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1877F2]/20 to-[#D6B56D]/20 opacity-30" />
        )}
      </div>

      <div className="container mx-auto px-4 max-w-6xl pb-24">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row gap-6 items-start relative -mt-16 md:-mt-24 mb-10">
          <div className="w-32 h-32 md:w-48 md:h-48 rounded-2xl border-4 border-[#0F1115] bg-[#171A21] shrink-0 overflow-hidden flex items-center justify-center shadow-2xl relative z-10">
            {business.logoUrl ? (
              <img src={business.logoUrl} alt={business.name} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-12 h-12 text-white/30" />
            )}
          </div>
          
          <div className="flex-1 w-full pt-4 md:pt-28 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-3xl md:text-4xl font-serif text-white tracking-tight">{business.name}</h1>
                {business.badges?.includes("verified") && (
                  <CheckCircle className="w-6 h-6 text-green-400 fill-current bg-background rounded-full" />
                )}
              </div>
              <p className="text-lg text-[#D6B56D] font-medium mb-3">@{business.handle}</p>
              
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/70">
                <span className="capitalize text-white/90 font-medium px-3 py-1 bg-white/5 rounded-full">{business.businessType}</span>
                {business.city && business.state && (
                  <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {business.city}, {business.state}</span>
                )}
                {(business.averageRating ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-[#D6B56D]"><Star className="w-4 h-4 fill-current" /> {business.averageRating?.toFixed(1)} ({business.reviewCount})</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              {isTeam ? (
                <Button 
                  onClick={() => setLocation(`/dashboard/business/${business.handle}`)}
                  className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] font-bold rounded-full w-full md:w-auto"
                >
                  <Edit className="w-4 h-4 mr-2" /> Manage Page
                </Button>
              ) : (
                <>
                  <Button 
                    variant={business.viewerFollows ? "secondary" : "default"}
                    onClick={() => requireAuth(() => toggleFollow.mutate({ handle: business.handle }))}
                    disabled={toggleFollow.isPending}
                    className={`rounded-full flex-1 md:flex-none ${business.viewerFollows ? "bg-white/10 text-white hover:bg-white/20" : "bg-[#1877F2] text-white hover:bg-[#166FE5]"}`}
                  >
                    <Heart className={`w-4 h-4 mr-2 ${business.viewerFollows ? "fill-current" : ""}`} /> 
                    {business.viewerFollows ? "Following" : "Follow"}
                  </Button>
                  
                  <Button 
                    onClick={() => requireAuth(() => startConv.mutate({ handle: business.handle }))}
                    disabled={startConv.isPending}
                    className="rounded-full bg-white text-black hover:bg-white/90 flex-1 md:flex-none"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" /> Message
                  </Button>

                  <Button 
                    variant="outline"
                    onClick={() => requireAuth(() => toggleSave.mutate({ handle: business.handle }))}
                    disabled={toggleSave.isPending}
                    className={`rounded-full border-white/20 flex-1 md:flex-none ${business.viewerSaved ? "text-[#D6B56D] border-[#D6B56D]/50" : "text-white"}`}
                  >
                    <Bookmark className={`w-4 h-4 mr-2 ${business.viewerSaved ? "fill-current" : ""}`} />
                    {business.viewerSaved ? "Saved" : "Save"}
                  </Button>

                  <Button 
                    variant="outline"
                    onClick={handleShare}
                    className="rounded-full border-white/20 text-white w-full md:w-auto flex-1 md:flex-none"
                  >
                    <Share className="w-4 h-4 mr-2" /> Share
                  </Button>
                  
                  {business.businessType === "lounge" && (
                    <Button 
                      variant="outline"
                      onClick={() => requireAuth(() => checkIn.mutate({ handle: business.handle, data: {} }))}
                      disabled={checkIn.isPending}
                      className="rounded-full border-[#D6B56D]/50 text-[#D6B56D] hover:bg-[#D6B56D]/10 w-full md:w-auto"
                    >
                      <Map className="w-4 h-4 mr-2" /> Check-in
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content Tabs */}
        <div className="mt-8">
          <Tabs defaultValue="about" className="w-full">
            <TabsList className="bg-transparent border-b border-white/10 w-full justify-start rounded-none h-14 p-0 space-x-6 overflow-x-auto hide-scrollbar flex-nowrap mb-8">
              <TabsTrigger value="about" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                <Info className="w-4 h-4 mr-2" /> About
              </TabsTrigger>
              <TabsTrigger value="posts" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                <Grid className="w-4 h-4 mr-2" /> Posts
              </TabsTrigger>
              <TabsTrigger value="services" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                <FileText className="w-4 h-4 mr-2" /> Services
              </TabsTrigger>
              {events && events.length > 0 && (
                <TabsTrigger value="events" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <Calendar className="w-4 h-4 mr-2" /> Events
                </TabsTrigger>
              )}
              {photos && photos.length > 0 && (
                <TabsTrigger value="photos" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <ImageIcon className="w-4 h-4 mr-2" /> Photos
                </TabsTrigger>
              )}
              {reels && reels.length > 0 && (
                <TabsTrigger value="reels" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <Film className="w-4 h-4 mr-2" /> Reels
                </TabsTrigger>
              )}
              {videos && videos.length > 0 && (
                <TabsTrigger value="videos" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <Video className="w-4 h-4 mr-2" /> Videos
                </TabsTrigger>
              )}
              {products && products.length > 0 && (
                <TabsTrigger value="products" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <Box className="w-4 h-4 mr-2" /> Products
                </TabsTrigger>
              )}
              {offers && offers.length > 0 && (
                <TabsTrigger value="offers" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                  <Gift className="w-4 h-4 mr-2" /> Offers
                </TabsTrigger>
              )}
              <TabsTrigger value="reviews" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#D6B56D] data-[state=active]:text-[#D6B56D] rounded-none h-full text-base px-2">
                <Star className="w-4 h-4 mr-2" /> Reviews
              </TabsTrigger>
            </TabsList>

            <TabsContent value="about" className="space-y-8 animate-in fade-in duration-500">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-2 space-y-8">
                  {business.tagline && (
                    <h2 className="text-2xl font-serif text-white leading-relaxed">{business.tagline}</h2>
                  )}
                  {business.description && (
                    <div className="prose prose-invert max-w-none text-white/80 leading-loose">
                      {business.description.split('\n').map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  )}
                  {business.mission && (
                    <div className="bg-card/30 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-[#D6B56D]" />
                      <h3 className="text-sm uppercase tracking-widest text-[#D6B56D] font-bold mb-3">Our Mission</h3>
                      <p className="text-lg text-white italic">"{business.mission}"</p>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="bg-card border border-white/10 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-white mb-4">Contact Info</h3>
                    <div className="space-y-4 text-sm text-white/80">
                      {business.address && (
                        <div className="flex gap-3">
                          <MapPin className="w-5 h-5 text-white/40 shrink-0" />
                          <span>
                            {business.address}<br />
                            {business.city}, {business.state} {business.zip}
                          </span>
                        </div>
                      )}
                      {business.phone && (
                        <div className="flex items-center gap-3">
                          <Phone className="w-5 h-5 text-white/40 shrink-0" />
                          <span>{business.phone}</span>
                        </div>
                      )}
                      {business.email && (
                        <div className="flex items-center gap-3">
                          <Mail className="w-5 h-5 text-white/40 shrink-0" />
                          <span>{business.email}</span>
                        </div>
                      )}
                      {business.website && (
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-white/40 shrink-0" />
                          <a href={business.website} target="_blank" rel="noreferrer" className="text-[#1877F2] hover:underline truncate">{business.website.replace(/^https?:\/\//, '')}</a>
                        </div>
                      )}
                    </div>
                  </div>

                  {business.hours && Object.keys(business.hours).length > 0 && (
                    <div className="bg-card border border-white/10 rounded-2xl p-6">
                      <h3 className="text-lg font-bold text-white mb-4">Hours</h3>
                      <div className="space-y-2 text-sm">
                        {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => {
                          const rawHours = business.hours?.[day];
                          const hrs = typeof rawHours === "string" ? rawHours : null;
                          if (!hrs) return null;
                          return (
                            <div key={day} className="flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                              <span className="capitalize text-white/60">{day}</span>
                              <span className="text-white font-medium">{hrs}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
                  <div className="bg-card border border-white/10 rounded-2xl p-6 flex justify-around">
                     <div className="text-center">
                       <p className="text-2xl font-bold text-white">{business.followerCount}</p>
                       <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Followers</p>
                     </div>
                     <div className="text-center">
                       <p className="text-2xl font-bold text-white">{business.checkInCount}</p>
                       <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Check-ins</p>
                     </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="posts" className="space-y-6">
              {!posts || posts.length === 0 ? (
                <div className="text-center py-20 bg-card/30 border border-white/5 rounded-3xl">
                  <Grid className="w-12 h-12 mx-auto text-white/20 mb-3" />
                  <p className="text-white/50">No posts yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {posts.map(post => (
                    <PostCard key={post.id} business={business} post={post} onRequireAuth={requireAuth} />
                  ))}
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="events" className="space-y-6">
              {!events || events.length === 0 ? (
                <div className="text-center py-20 bg-card/30 border border-white/5 rounded-3xl">
                  <Calendar className="w-12 h-12 mx-auto text-white/20 mb-3" />
                  <p className="text-white/50">No upcoming events.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {events.map((ev: BusinessEvent) => (
                    <div key={ev.id} className="bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors">
                      <h4 className="font-bold text-white text-lg">{ev.title}</h4>
                      <div className="space-y-2 mt-3 text-sm text-white/80">
                        <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#D6B56D]" /> {new Date(ev.startsAt).toLocaleString()}</p>
                        {ev.location && <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-[#D6B56D]" /> {ev.location}</p>}
                      </div>
                      {ev.description && <p className="mt-3 text-sm text-white/60 line-clamp-3">{ev.description}</p>}
                      <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-3">
                        <div className="flex justify-between items-center w-full">
                          <span className="text-xs text-white/40">{ev.rsvpCount || 0} RSVPs</span>
                          <EventRsvpButton business={business} event={ev} onRequireAuth={requireAuth} />
                        </div>
                        <ChildInteractions 
                          businessHandle={business.handle}
                          entityType="event"
                          entityId={ev.id}
                          initialLikes={ev.likeCount}
                          initialComments={ev.commentCount}
                          isLikedByViewer={ev.viewerLiked}
                          isSavedByViewer={ev.viewerSaved}
                          onRequireAuth={requireAuth}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="photos" className="space-y-6">
              <div className="flex justify-end">
                <CustomerMediaUpload businessHandle={business.handle} kind="photo" onRequireAuth={requireAuth} />
              </div>
              <MediaGrid business={business} mediaList={photos} kind="photo" onRequireAuth={requireAuth} />
            </TabsContent>

            <TabsContent value="videos" className="space-y-6">
              <div className="flex justify-end">
                <CustomerMediaUpload businessHandle={business.handle} kind="video" onRequireAuth={requireAuth} />
              </div>
              <MediaGrid business={business} mediaList={videos} kind="video" onRequireAuth={requireAuth} />
            </TabsContent>

            <TabsContent value="reels" className="space-y-6">
              <div className="flex justify-end">
                <CustomerMediaUpload businessHandle={business.handle} kind="reel" onRequireAuth={requireAuth} />
              </div>
              <MediaGrid business={business} mediaList={reels} kind="reel" onRequireAuth={requireAuth} />
            </TabsContent>
            
            <TabsContent value="services" className="space-y-6">
               {!services || services.length === 0 ? (
                 <p className="text-white/50 text-center py-10">No services listed.</p>
               ) : (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {services.map((svc: BusinessServiceItem) => (
                     <div key={svc.id} className="flex flex-col sm:flex-row gap-4 bg-card border border-white/10 p-5 rounded-2xl">
                        {svc.imageUrl ? (
                          <div className="w-full sm:w-24 h-40 sm:h-24 rounded-xl overflow-hidden shrink-0 bg-background"><img src={svc.imageUrl} className="w-full h-full object-cover" /></div>
                        ) : (
                          <div className="hidden sm:flex w-24 h-24 rounded-xl shrink-0 bg-background items-center justify-center"><FileText className="w-8 h-8 text-white/20"/></div>
                        )}
                        <div className="flex-1 flex flex-col">
                          <h4 className="font-bold text-white text-lg">{svc.name}</h4>
                          {svc.priceLabel && <p className="text-[#D6B56D] font-medium text-sm my-1">{svc.priceLabel}</p>}
                          {svc.description && <p className="text-sm text-white/60 line-clamp-2 mt-1 mb-4">{svc.description}</p>}
                          
                          <div className="mt-auto pt-2 border-t border-white/5">
                             <AppointmentRequestForm business={business} service={svc} onRequireAuth={() => requireAuth(() => {})} />
                          </div>
                        </div>
                     </div>
                   ))}
                 </div>
               )}
            </TabsContent>

            <TabsContent value="products" className="space-y-6">
               {!products || products.length === 0 ? (
                 <p className="text-white/50 text-center py-10">No products listed.</p>
               ) : (
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                   {products.map((prod: BusinessProductItem) => (
                     <div key={prod.id} className="bg-card border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                        {prod.imageUrl ? (
                          <div className="h-40 bg-background"><img src={prod.imageUrl} className="w-full h-full object-cover" /></div>
                        ) : (
                          <div className="h-40 bg-background flex items-center justify-center"><Box className="w-12 h-12 text-white/20"/></div>
                        )}
                        <div className="p-4 flex-1 flex flex-col">
                          <h4 className="font-bold text-white">{prod.name}</h4>
                          {prod.priceLabel && <p className="text-[#D6B56D] font-medium text-sm mt-1 mb-2">{prod.priceLabel}</p>}
                          {prod.description && <p className="text-sm text-white/60 line-clamp-2">{prod.description}</p>}
                          <div className="mt-auto pt-4">
                            <ChildInteractions 
                              businessHandle={business.handle}
                              entityType="product"
                              entityId={prod.id}
                              initialLikes={prod.likeCount}
                              initialComments={prod.commentCount}
                              isLikedByViewer={prod.viewerLiked}
                              isSavedByViewer={prod.viewerSaved}
                              onRequireAuth={requireAuth}
                            />
                          </div>
                        </div>
                     </div>
                   ))}
                 </div>
               )}
            </TabsContent>

            <TabsContent value="offers" className="space-y-6">
               {!offers || offers.length === 0 ? (
                 <p className="text-white/50 text-center py-10">No special offers.</p>
               ) : (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   {offers.map((offer: BusinessOfferItem) => (
                     <div key={offer.id} className="bg-gradient-to-br from-card to-card/50 border border-[#D6B56D]/30 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute -right-6 -top-6 w-24 h-24 bg-[#D6B56D]/10 rounded-full blur-2xl" />
                        <h4 className="font-serif text-2xl text-[#D6B56D] mb-2">{offer.title}</h4>
                        {offer.description && <p className="text-white/80 text-sm mb-4">{offer.description}</p>}
                        <div className="inline-flex items-center px-3 py-1.5 bg-background border border-white/10 rounded-lg text-sm font-mono text-white/90 uppercase tracking-widest mb-4">
                          {offer.code || "Redeem in person"}
                        </div>
                        <ChildInteractions 
                          businessHandle={business.handle}
                          entityType="offer"
                          entityId={offer.id}
                          initialLikes={offer.likeCount}
                          initialComments={offer.commentCount}
                          isLikedByViewer={offer.viewerLiked}
                          isSavedByViewer={offer.viewerSaved}
                          onRequireAuth={requireAuth}
                        />
                     </div>
                   ))}
                 </div>
               )}
            </TabsContent>

            <TabsContent value="reviews" className="space-y-6">
               <ReviewForm business={business} onRequireAuth={() => requireAuth(() => {})} />

               {!reviews || reviews.length === 0 ? (
                 <div className="text-center py-10 bg-card/30 border border-white/5 rounded-3xl mt-8">
                  <Star className="w-12 h-12 mx-auto text-white/20 mb-3" />
                  <p className="text-white/50">No reviews yet. Be the first to review!</p>
                </div>
               ) : (
                 <div className="space-y-6 mt-8">
                   <h3 className="text-xl font-bold text-white mb-4">Customer Reviews</h3>
                   {reviews.map((rev: BusinessReviewItem) => (
                     <div key={rev.id} className="bg-card border border-white/10 rounded-2xl p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-background overflow-hidden border border-white/10 shrink-0">
                              {rev.userPhotoUrl ? <img src={rev.userPhotoUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-white/40"><UserIcon className="w-5 h-5"/></div>}
                            </div>
                            <div>
                              <p className="font-bold text-white text-sm">{rev.userName || "Anonymous"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {[1,2,3,4,5].map(s => (
                              <Star key={s} className={`w-4 h-4 ${s <= rev.rating ? "text-[#D6B56D] fill-current" : "text-white/10"}`} />
                            ))}
                          </div>
                        </div>
                        <p className="text-white/80 text-sm leading-relaxed">{rev.text}</p>
                        {rev.reply && (
                          <div className="mt-4 pl-4 border-l-2 border-white/10 ml-4 py-3 bg-background/50 rounded-r-xl">
                            <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">Response from owner</p>
                            <p className="text-sm text-white/80">{rev.reply.text}</p>
                          </div>
                        )}
                     </div>
                   ))}
                 </div>
               )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Layout>
  );
}

function MediaGrid({ business, mediaList, kind, onRequireAuth }: { business: BusinessDetail, mediaList?: BusinessMediaItem[], kind: string, onRequireAuth: (cb: () => void) => void }) {
  const [selectedMedia, setSelectedMedia] = useState<BusinessMediaItem | null>(null);
  const recordView = useRecordBusinessMediaView();

  if (!mediaList || mediaList.length === 0) {
    return (
      <div className="text-center py-20 bg-card/30 border border-white/5 rounded-3xl">
        {kind === 'photo' && <ImageIcon className="w-12 h-12 mx-auto text-white/20 mb-3" />}
        {kind === 'video' && <Video className="w-12 h-12 mx-auto text-white/20 mb-3" />}
        {kind === 'reel' && <Film className="w-12 h-12 mx-auto text-white/20 mb-3" />}
        <p className="text-white/50 capitalize">No {kind}s uploaded.</p>
      </div>
    );
  }

  const handleOpen = (media: BusinessMediaItem) => {
    setSelectedMedia(media);
    if (kind === 'video' || kind === 'reel') {
      recordView.mutate({ handle: business.handle, mediaId: media.id });
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {mediaList.map((media: BusinessMediaItem) => (
          <div key={media.id} onClick={() => handleOpen(media)} className="bg-card border border-white/10 rounded-2xl overflow-hidden group relative aspect-square cursor-pointer">
            {kind === 'photo' ? (
              <img src={media.mediaUrl} className="w-full h-full object-cover" />
            ) : (
              <>
                <video src={media.mediaUrl} poster={media.posterUrl || undefined} className="w-full h-full object-cover" controls={false} />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <PlayCircle className="w-10 h-10 text-white/80" />
                </div>
              </>
            )}
            {media.caption && (
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs text-white line-clamp-2">{media.caption}</p>
              </div>
            )}
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-white drop-shadow-md">
              <span className="flex items-center gap-1"><Heart className="w-3 h-3"/> {media.likeCount || 0}</span>
              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3"/> {media.commentCount || 0}</span>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!selectedMedia} onOpenChange={(open) => !open && setSelectedMedia(null)}>
        <DialogContent className="bg-card border-white/10 text-white sm:max-w-2xl p-0 overflow-hidden">
          {selectedMedia && (
            <div className="flex flex-col max-h-[90vh]">
              <div className="bg-black relative flex items-center justify-center min-h-[300px] max-h-[60vh]">
                {selectedMedia.kind === "photo" ? (
                  <img src={selectedMedia.mediaUrl} className="max-w-full max-h-[60vh] object-contain" />
                ) : (
                  <video src={selectedMedia.mediaUrl} poster={selectedMedia.posterUrl || undefined} className="max-w-full max-h-[60vh] object-contain" controls autoPlay />
                )}
              </div>
              <div className="p-5 overflow-y-auto custom-scrollbar">
                {selectedMedia.caption && <p className="text-sm text-white/90 mb-2">{selectedMedia.caption}</p>}
                <p className="text-xs text-white/40 mb-4">
                  {selectedMedia.createdAt ? new Date(selectedMedia.createdAt).toLocaleString() : ""}
                </p>
                
                <ChildInteractions 
                  businessHandle={business.handle}
                  entityType="media"
                  entityId={selectedMedia.id}
                  initialLikes={selectedMedia.likeCount}
                  initialComments={selectedMedia.commentCount}
                  isLikedByViewer={selectedMedia.viewerLiked}
                  isSavedByViewer={selectedMedia.viewerSaved}
                  onRequireAuth={onRequireAuth}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EventRsvpButton({ business, event, onRequireAuth }: { business: BusinessDetail, event: BusinessEvent, onRequireAuth: (cb: () => void) => void }) {
  const queryClient = useQueryClient();
  const toggleRsvp = useToggleBusinessEventRsvp({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBusinessEventsQueryKey(business.handle) })
    }
  });

  const isGoing = event.viewerRsvp === "going";

  return (
    <Button 
      size="sm"
      variant={isGoing ? "default" : "outline"}
      onClick={() => onRequireAuth(() => toggleRsvp.mutate({ handle: business.handle, eventId: event.id, data: { status: isGoing ? undefined : 'going' } }))}
      disabled={toggleRsvp.isPending}
      className={`rounded-full h-8 ${isGoing ? "bg-[#D6B56D] hover:bg-[#C9A456] text-[#111]" : "border-[#D6B56D]/50 text-[#D6B56D] hover:bg-[#D6B56D]/10"}`}
    >
      {isGoing ? "Going" : "RSVP"}
    </Button>
  );
}

function PostCard({ business, post, onRequireAuth }: { business: BusinessDetail, post: BusinessPostItem, onRequireAuth: (cb: () => void) => void }) {
  const [showComments, setShowComments] = useState(false);
  const { data: session } = useGetCurrentUser();
  const { data: comments, isLoading: loadingComments } = useListBusinessPostComments(business.handle, post.id, {
    query: { enabled: !!business.handle && !!post.id && showComments, queryKey: getListBusinessPostCommentsQueryKey(business.handle, post.id) }
  });

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-background overflow-hidden border border-white/10 shrink-0">
          <img src={business.logoUrl || ""} className="w-full h-full object-cover" />
        </div>
        <div>
          <p className="font-bold text-white text-sm">{business.name}</p>
          <p className="text-xs text-white/40">{new Date(post.createdAt || "").toLocaleDateString()}</p>
        </div>
      </div>
      <p className="text-white/90 text-sm leading-relaxed mb-4">{post.text}</p>
      {post.mediaUrl && (
        <div className="rounded-xl overflow-hidden mb-4 bg-black">
          {post.mediaType === "video" ? (
            <video src={post.mediaUrl} poster={post.posterUrl || undefined} controls className="w-full max-h-80 object-contain" />
          ) : (
            <img src={post.mediaUrl} alt="Post media" className="w-full max-h-80 object-cover" />
          )}
        </div>
      )}
      <PostInteractions business={business} post={post} onRequireAuth={onRequireAuth} onToggleComments={() => setShowComments(!showComments)} />
      
      {showComments && (
        <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
          <CommentForm business={business} postId={post.id} onRequireAuth={onRequireAuth} />
          {loadingComments ? (
            <p className="text-xs text-white/40 text-center">Loading comments...</p>
          ) : !comments || comments.length === 0 ? (
            <p className="text-xs text-white/40 text-center">No comments yet.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {comments.map((comment: BusinessPostComment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-background overflow-hidden shrink-0 border border-white/10 flex items-center justify-center text-xs text-white/40">
                    {comment.userPhotoUrl ? <img src={comment.userPhotoUrl} className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4"/>}
                  </div>
                  <div className="flex-1 bg-background/50 rounded-xl p-3 border border-white/5">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-bold text-white text-xs">{comment.userName || `User #${comment.userId}`}</p>
                      {session?.user?.id === comment.userId && (
                        <DeleteCommentButton business={business} postId={post.id} commentId={comment.id} />
                      )}
                    </div>
                    <p className="text-sm text-white/80">{comment.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CommentForm({ business, postId, onRequireAuth }: { business: BusinessDetail, postId: number, onRequireAuth: (cb: () => void) => void }) {
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const createComment = useCreateBusinessPostComment({
    mutation: {
      onSuccess: () => {
        setText("");
        queryClient.invalidateQueries({ queryKey: getListBusinessPostCommentsQueryKey(business.handle, postId) });
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRequireAuth(() => {
      if (!text.trim()) return;
      createComment.mutate({ handle: business.handle, postId, data: { text } });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input 
        value={text} 
        onChange={e => setText(e.target.value)} 
        placeholder="Write a comment..." 
        className="h-9 bg-background/50 border-white/10 text-sm"
      />
      <Button size="sm" type="submit" disabled={!text.trim() || createComment.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] h-9">
        Post
      </Button>
    </form>
  );
}

function DeleteCommentButton({ business, postId, commentId }: { business: BusinessDetail, postId: number, commentId: number }) {
  const queryClient = useQueryClient();
  const del = useDeleteBusinessPostComment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessPostCommentsQueryKey(business.handle, postId) });
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  return (
    <button onClick={() => del.mutate({ handle: business.handle, postId, commentId })} className="text-white/30 hover:text-red-400">
      <XCircle className="w-3 h-3" />
    </button>
  );
}

function PostInteractions({ business, post, onRequireAuth, onToggleComments }: { business: BusinessDetail, post: BusinessPostItem, onRequireAuth: (cb: () => void) => void, onToggleComments: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleLike = useToggleBusinessPostLike({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) })
    }
  });

  const toggleSave = useToggleBusinessPostSave({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) })
    }
  });

  const reportPost = useReportBusinessPost({
    mutation: {
      onSuccess: () => toast({ title: "Post reported for review." }),
      onError: () => toast({ title: "Failed to report", variant: "destructive" })
    }
  });

  return (
    <div className="flex justify-between items-center text-sm text-white/50 pt-3 border-t border-white/5">
      <div className="flex gap-4">
        <button 
          onClick={() => onRequireAuth(() => toggleLike.mutate({ handle: business.handle, postId: post.id }))}
          disabled={toggleLike.isPending}
          className={`flex items-center gap-1.5 hover:text-white transition-colors ${post.viewerLiked ? 'text-red-500 hover:text-red-400' : ''}`}
        >
          <Heart className={`w-4 h-4 ${post.viewerLiked ? 'fill-current' : ''}`} /> {post.likeCount || 0}
        </button>
        <button onClick={onToggleComments} className="flex items-center gap-1.5 hover:text-white transition-colors">
          <MessageSquare className="w-4 h-4" /> {post.commentCount || 0}
        </button>
      </div>
      <div className="flex gap-4">
        <button 
          onClick={() => onRequireAuth(() => toggleSave.mutate({ handle: business.handle, postId: post.id }))}
          disabled={toggleSave.isPending}
          className={`hover:text-white transition-colors ${post.viewerSaved ? 'text-[#D6B56D] hover:text-[#C9A456]' : ''}`}
        >
          <Bookmark className={`w-4 h-4 ${post.viewerSaved ? 'fill-current' : ''}`} />
        </button>
        <button 
          onClick={() => onRequireAuth(() => {
            if (window.confirm("Report this post?")) reportPost.mutate({ handle: business.handle, postId: post.id, data: { reason: "Inappropriate" } });
          })} 
          disabled={reportPost.isPending}
          className="hover:text-white transition-colors"
        >
          <Flag className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ReviewForm({ business, onRequireAuth }: { business: BusinessDetail; onRequireAuth: () => void }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createReview = useCreateBusinessReview({
    mutation: {
      onSuccess: () => {
        toast({ title: "Review posted successfully!" });
        setRating(0);
        setText("");
        queryClient.invalidateQueries({ queryKey: getListBusinessReviewsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to post review", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRequireAuth();
    if (!rating) {
      toast({ title: "Please select a rating", variant: "destructive" });
      return;
    }
    createReview.mutate({ handle: business.handle, data: { rating, text } });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-white/10 rounded-3xl p-6 md:p-8 animate-in fade-in">
      <h3 className="text-xl font-bold text-white mb-6">Write a Review</h3>
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/60 mb-2">Rating</label>
        <div className="flex gap-2">
          {[1,2,3,4,5].map(s => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(s)}
              className="focus:outline-none"
            >
              <Star className={`w-8 h-8 transition-colors ${s <= (hoverRating || rating) ? "text-[#D6B56D] fill-current" : "text-white/20"}`} />
            </button>
          ))}
        </div>
      </div>
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/60 mb-2">Review (optional)</label>
        <Textarea 
          value={text} 
          onChange={e => setText(e.target.value)} 
          placeholder="Share your experience..." 
          className="bg-background border-white/10 min-h-[100px]"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={createReview.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-8">
          {createReview.isPending ? "Posting..." : "Post Review"}
        </Button>
      </div>
    </form>
  );
}

function AppointmentRequestForm({ business, service, onRequireAuth }: { business: BusinessDetail, service: BusinessServiceItem, onRequireAuth: () => void }) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const createAppt = useCreateBusinessAppointment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request sent successfully!" });
        setIsRequesting(false);
        setDate("");
        setTime("");
        setNotes("");
      },
      onError: (err: unknown) => toast({ title: "Request failed", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRequireAuth();
    if (!date || !time) return;
    
    // Combine date and time
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    
    createAppt.mutate({ 
      handle: business.handle, 
      data: { 
        serviceId: service.id, 
        scheduledAt,
        notes 
      } 
    });
  };

  if (!isRequesting) {
    return (
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => { onRequireAuth(); setIsRequesting(true); }}
        className="text-[#D6B56D] hover:bg-[#D6B56D]/10 hover:text-[#C9A456] -ml-2"
      >
        <Calendar className="w-4 h-4 mr-2" /> Request Appointment
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 bg-background p-4 rounded-xl border border-white/5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Date</label>
          <Input type="date" required value={date} onChange={e => setDate(e.target.value)} className="bg-card border-white/10 h-8 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Time</label>
          <Input type="time" required value={time} onChange={e => setTime(e.target.value)} className="bg-card border-white/10 h-8 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Notes (optional)</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requests?" className="bg-card border-white/10 min-h-[60px] text-sm" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsRequesting(false)} className="text-white/50">Cancel</Button>
        <Button type="submit" size="sm" disabled={createAppt.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111]">
          {createAppt.isPending ? "Sending..." : "Send Request"}
        </Button>
      </div>
    </form>
  );
}