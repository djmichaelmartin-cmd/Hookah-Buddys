import { useLocation, useParams, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import {  
  useGetBusinessByHandle,
  useGetBusinessDashboard,
  getGetBusinessDashboardQueryKey,
  getGetBusinessByHandleQueryKey,
  BusinessServiceItem, BusinessProductItem, BusinessOfferItem, BusinessConversationItem, BusinessMessageItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  LayoutDashboard, Settings, FileText, MessageSquare, Users, 
  BarChart3, Star, Calendar, Bell, AtSign
} from "lucide-react";
import { SettingsForm } from "@/components/business/DashboardSettings";
import { DashboardPosts } from "@/components/business/DashboardPosts";
import { DashboardTeam } from "@/components/business/DashboardTeam";
import { DashboardAppointments } from "@/components/business/DashboardAppointments";
import { DashboardReviews } from "@/components/business/DashboardReviews";
import { DashboardInsights } from "@/components/business/DashboardInsights";
import { DashboardNotifications } from "@/components/business/DashboardNotifications";
import { DashboardMedia } from "@/components/business/DashboardMedia";
import { DashboardEvents } from "@/components/business/DashboardEvents";
import { DashboardEngagement } from "@/components/business/DashboardEngagement";
import { DashboardVerification } from "@/components/business/DashboardVerification";
import { DashboardMentions } from "@/components/business/DashboardMentions";

// We'll keep the inline managers for Services, Products, Offers, Inbox for now to limit file rewrites,
// or we can just import them if we split them. Actually, wait, they are currently in BusinessDashboard.tsx.
// Let's bring them back in or copy them to a DashboardContent file. Since they were at the bottom of the original file, I'll put them in here.
import { useState } from "react";
import { BusinessDetail } from "@workspace/api-client-react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { 
  useListBusinessServices, useUpsertBusinessService, useDeleteBusinessService, getListBusinessServicesQueryKey,
  useListBusinessProducts, useUpsertBusinessProduct, useDeleteBusinessProduct, getListBusinessProductsQueryKey,
  useListBusinessOffers, useUpsertBusinessOffer, useDeleteBusinessOffer, getListBusinessOffersQueryKey,
  useListBusinessConversations, useListBusinessMessages, useSendBusinessMessage, getListBusinessConversationsQueryKey, getListBusinessMessagesQueryKey
} from "@workspace/api-client-react";

export default function BusinessDashboard() {
  const { handle } = useParams<{ handle: string }>();
  const [_, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const currentTab = searchParams.get("tab") || "overview";
  
  const { data: business, isLoading } = useGetBusinessByHandle(handle || "", {
    query: { enabled: !!handle, queryKey: getGetBusinessByHandleQueryKey(handle || "") }
  });

  const { data: dashboard } = useGetBusinessDashboard(business?.handle || "", {
    query: { enabled: !!business?.handle, queryKey: getGetBusinessDashboardQueryKey(business?.handle || "") }
  });

  if (isLoading) {
    return <Layout><div className="p-12 text-center text-white/50">Loading workspace...</div></Layout>;
  }

  if (!business) {
    return <Layout><div className="p-12 text-center text-white/50">Business not found.</div></Layout>;
  }

  const handleTabChange = (val: string) => {
    setLocation(`/dashboard/business/${business.handle}?tab=${val}`);
  };

  const navItems = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4 mr-3" /> },
    { id: "insights", label: "Insights", icon: <BarChart3 className="w-4 h-4 mr-3" /> },
    { id: "engagement", label: "Followers & Visits", icon: <Users className="w-4 h-4 mr-3" /> },
    { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4 mr-3" /> },
    { id: "settings", label: "Page Settings", icon: <Settings className="w-4 h-4 mr-3" /> },
    { id: "verification", label: "Verification", icon: <Star className="w-4 h-4 mr-3" /> },
    { id: "content", label: "Content & Services", icon: <FileText className="w-4 h-4 mr-3" /> },
    { id: "media", label: "Media & Albums", icon: <FileText className="w-4 h-4 mr-3" /> },
    { id: "mentions", label: "Mentions", icon: <AtSign className="w-4 h-4 mr-3" /> },
    { id: "events", label: "Events", icon: <Calendar className="w-4 h-4 mr-3" /> },
    { id: "posts", label: "Posts & Updates", icon: <MessageSquare className="w-4 h-4 mr-3" /> },
    { id: "appointments", label: "Appointments", icon: <Calendar className="w-4 h-4 mr-3" /> },
    { id: "inbox", label: "Inbox", icon: <MessageSquare className="w-4 h-4 mr-3" /> },
    { id: "reviews", label: "Reviews", icon: <Star className="w-4 h-4 mr-3" /> },
    { id: "team", label: "Team", icon: <Users className="w-4 h-4 mr-3" /> },
  ];

  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <div className="w-64 bg-card border-r border-white/10 hidden md:flex flex-col h-[calc(100vh-4rem)] sticky top-16">
          <div className="p-6 border-b border-white/10 shrink-0">
            <h2 className="text-xl font-bold text-white truncate">{business.name}</h2>
            <p className="text-xs text-[#D6B56D]">Business Workspace</p>
          </div>
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            <nav className="px-4 space-y-1">
              <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3 ml-3 mt-2">Menu</div>
              {navItems.map(item => (
                <Button 
                  key={item.id}
                  variant="ghost" 
                  className={`w-full justify-start ${currentTab === item.id ? 'bg-[#D6B56D]/10 text-[#D6B56D]' : 'text-white/70 hover:text-white hover:bg-white/5'}`}
                  onClick={() => handleTabChange(item.id)}
                >
                  {item.icon} {item.label}
                </Button>
              ))}
            </nav>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-background overflow-y-auto h-[calc(100vh-4rem)]">
          <div className="p-6 md:p-10 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-serif text-white">Dashboard</h1>
              <Button variant="outline" onClick={() => setLocation(`/business/${business.handle}`)} className="border-white/20 text-white rounded-full">
                View Public Page
              </Button>
            </div>

            <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
              <TabsList className="bg-card border border-white/10 mb-8 md:hidden flex overflow-x-auto hide-scrollbar w-full h-auto p-1 sticky top-0 z-10">
                {navItems.map(item => (
                  <TabsTrigger key={item.id} value={item.id} className="whitespace-nowrap">{item.label}</TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview" className="space-y-6 animate-in fade-in">
                <DashboardInsights business={business} />
              </TabsContent>
              
              <TabsContent value="insights" className="animate-in fade-in">
                <DashboardInsights business={business} />
              </TabsContent>

              <TabsContent value="engagement" className="animate-in fade-in">
                <DashboardEngagement business={business} />
              </TabsContent>
              
              <TabsContent value="notifications" className="animate-in fade-in">
                <DashboardNotifications business={business} />
              </TabsContent>

              <TabsContent value="settings" className="animate-in fade-in">
                <SettingsForm business={business} />
              </TabsContent>

              <TabsContent value="verification" className="animate-in fade-in">
                <DashboardVerification business={business} />
              </TabsContent>

              <TabsContent value="content" className="space-y-12 animate-in fade-in">
                <ServicesManager business={business} />
                <ProductsManager business={business} />
                <OffersManager business={business} />
              </TabsContent>
              
              <TabsContent value="media" className="animate-in fade-in">
                <DashboardMedia business={business} />
              </TabsContent>
              
              <TabsContent value="mentions" className="animate-in fade-in">
                <DashboardMentions business={business} />
              </TabsContent>
              
              <TabsContent value="events" className="animate-in fade-in">
                <DashboardEvents business={business} />
              </TabsContent>
              
              <TabsContent value="posts" className="animate-in fade-in">
                <DashboardPosts business={business} />
              </TabsContent>
              
              <TabsContent value="appointments" className="animate-in fade-in">
                <DashboardAppointments business={business} />
              </TabsContent>
              
              <TabsContent value="reviews" className="animate-in fade-in">
                <DashboardReviews business={business} />
              </TabsContent>
              
              <TabsContent value="team" className="animate-in fade-in">
                <DashboardTeam business={business} />
              </TabsContent>

              <TabsContent value="inbox" className="animate-in fade-in">
                <InboxManager business={business} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// Keep the old inline managers for Content & Inbox below to prevent breaking.

function ServicesManager({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newSvc, setNewSvc] = useState({ name: "", priceLabel: "", description: "" });
  
  const { data: services } = useListBusinessServices(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessServicesQueryKey(business.handle) }
  });

  const upsertService = useUpsertBusinessService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service saved" });
        setIsAdding(false);
        setNewSvc({ name: "", priceLabel: "", description: "" });
        queryClient.invalidateQueries({ queryKey: getListBusinessServicesQueryKey(business.handle) });
      }
    }
  });

  const deleteService = useDeleteBusinessService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Service deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessServicesQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    upsertService.mutate({ handle: business.handle, data: { ...newSvc } });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white">Services</h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Add Service</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Service Name</label>
              <Input required value={newSvc.name} onChange={e => setNewSvc(p => ({...p, name: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. VIP Table Reservation" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Price Label</label>
              <Input value={newSvc.priceLabel} onChange={e => setNewSvc(p => ({...p, priceLabel: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. Starts at $200" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
              <Textarea value={newSvc.description} onChange={e => setNewSvc(p => ({...p, description: e.target.value}))} className="bg-background border-white/10" placeholder="Describe what's included..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={upsertService.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">Save Service</Button>
          </div>
        </form>
      )}

      {!services || services.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No services added yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {services.map((svc: BusinessServiceItem) => (
            <div key={svc.id} className="flex justify-between items-center bg-card border border-white/10 p-5 rounded-2xl group">
              <div>
                <h4 className="font-bold text-white text-lg">{svc.name}</h4>
                {svc.priceLabel && <p className="text-[#D6B56D] text-sm my-1">{svc.priceLabel}</p>}
                <p className="text-sm text-white/60 line-clamp-1">{svc.description}</p>
              </div>
              <Button 
                variant="ghost" 
                onClick={() => deleteService.mutate({ handle: business.handle, serviceId: svc.id })}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductsManager({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newProd, setNewProd] = useState({ name: "", priceLabel: "", description: "" });
  
  const { data: products } = useListBusinessProducts(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessProductsQueryKey(business.handle) }
  });

  const upsertProduct = useUpsertBusinessProduct({
    mutation: {
      onSuccess: () => {
        toast({ title: "Product saved" });
        setIsAdding(false);
        setNewProd({ name: "", priceLabel: "", description: "" });
        queryClient.invalidateQueries({ queryKey: getListBusinessProductsQueryKey(business.handle) });
      }
    }
  });

  const deleteProduct = useDeleteBusinessProduct({
    mutation: {
      onSuccess: () => {
        toast({ title: "Product deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessProductsQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    upsertProduct.mutate({ handle: business.handle, data: { ...newProd } });
  };

  return (
    <div className="space-y-6 pt-6 border-t border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white">Products</h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Add Product</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Product Name</label>
              <Input required value={newProd.name} onChange={e => setNewProd(p => ({...p, name: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. Al Fakher Mint" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Price Label</label>
              <Input value={newProd.priceLabel} onChange={e => setNewProd(p => ({...p, priceLabel: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. $19.99" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
              <Textarea value={newProd.description} onChange={e => setNewProd(p => ({...p, description: e.target.value}))} className="bg-background border-white/10" placeholder="Product details..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={upsertProduct.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">Save Product</Button>
          </div>
        </form>
      )}

      {!products || products.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No products added yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {products.map((prod: BusinessProductItem) => (
            <div key={prod.id} className="flex justify-between items-center bg-card border border-white/10 p-5 rounded-2xl group">
              <div>
                <h4 className="font-bold text-white text-lg">{prod.name}</h4>
                {prod.priceLabel && <p className="text-[#D6B56D] text-sm my-1">{prod.priceLabel}</p>}
                <p className="text-sm text-white/60 line-clamp-1">{prod.description}</p>
              </div>
              <Button 
                variant="ghost" 
                onClick={() => deleteProduct.mutate({ handle: business.handle, productId: prod.id })}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OffersManager({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newOffer, setNewOffer] = useState({ title: "", description: "", code: "" });
  
  const { data: offers } = useListBusinessOffers(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessOffersQueryKey(business.handle) }
  });

  const upsertOffer = useUpsertBusinessOffer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Offer saved" });
        setIsAdding(false);
        setNewOffer({ title: "", description: "", code: "" });
        queryClient.invalidateQueries({ queryKey: getListBusinessOffersQueryKey(business.handle) });
      }
    }
  });

  const deleteOffer = useDeleteBusinessOffer({
    mutation: {
      onSuccess: () => {
        toast({ title: "Offer deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessOffersQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    upsertOffer.mutate({ handle: business.handle, data: { ...newOffer } });
  };

  return (
    <div className="space-y-6 pt-6 border-t border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white">Offers & Promos</h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Add Offer</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Offer Title</label>
              <Input required value={newOffer.title} onChange={e => setNewOffer(p => ({...p, title: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. 20% Off Hookah" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Promo Code</label>
              <Input value={newOffer.code} onChange={e => setNewOffer(p => ({...p, code: e.target.value}))} className="bg-background border-white/10" placeholder="e.g. SUMMER20" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
              <Textarea value={newOffer.description} onChange={e => setNewOffer(p => ({...p, description: e.target.value}))} className="bg-background border-white/10" placeholder="Offer details..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={upsertOffer.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">Save Offer</Button>
          </div>
        </form>
      )}

      {!offers || offers.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No offers added yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {offers.map((offer: BusinessOfferItem) => (
            <div key={offer.id} className="flex justify-between items-center bg-gradient-to-r from-card to-card/50 border border-[#D6B56D]/30 p-5 rounded-2xl group">
              <div>
                <h4 className="font-bold text-[#D6B56D] text-lg">{offer.title}</h4>
                {offer.code && <p className="font-mono text-xs text-white/80 my-1 bg-background/50 px-2 py-1 inline-block rounded">{offer.code}</p>}
                <p className="text-sm text-white/60 line-clamp-1">{offer.description}</p>
              </div>
              <Button 
                variant="ghost" 
                onClick={() => deleteOffer.mutate({ handle: business.handle, offerId: offer.id })}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InboxManager({ business }: { business: BusinessDetail }) {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: conversations } = useListBusinessConversations(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessConversationsQueryKey(business.handle) }
  });

  const { data: messages } = useListBusinessMessages(business.handle, activeConversationId || 0, {
    query: { 
      enabled: !!business.handle && !!activeConversationId, 
      queryKey: getListBusinessMessagesQueryKey(business.handle, activeConversationId || 0),
      refetchInterval: 5000
    }
  });

  const sendMessage = useSendBusinessMessage({
    mutation: {
      onSuccess: () => {
        setMessage("");
        queryClient.invalidateQueries({ queryKey: getListBusinessMessagesQueryKey(business.handle, activeConversationId || 0) });
      },
      onError: (err: unknown) => toast({ title: "Failed to send", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversationId || !message.trim()) return;
    sendMessage.mutate({ handle: business.handle, conversationId: activeConversationId, data: { body: message } });
  };

  return (
    <div className="bg-card border border-white/10 rounded-3xl overflow-hidden flex h-[600px]">
      {/* Conversations List */}
      <div className="w-1/3 border-r border-white/10 flex flex-col">
        <div className="p-4 border-b border-white/10 bg-background/50">
          <h3 className="font-bold text-white">Inbox</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!conversations || conversations.length === 0 ? (
            <div className="p-6 text-center text-white/40 text-sm">No conversations yet.</div>
          ) : (
            conversations.map((conv: BusinessConversationItem) => (
              <button 
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-colors ${activeConversationId === conv.id ? "bg-white/5 border-l-2 border-l-primary" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background overflow-hidden border border-white/10 shrink-0">
                    {conv.userPhotoUrl ? <img src={conv.userPhotoUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-white/20"><Users className="w-4 h-4"/></div>}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="font-bold text-white text-sm truncate">{conv.userName}</p>
                    <p className="text-xs text-white/50 truncate mt-0.5">{conv.lastMessageAt || "New conversation"}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 flex flex-col bg-background/50">
        {!activeConversationId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-white/40">
            <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
            <p>Select a conversation to start messaging</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {messages?.map((msg: BusinessMessageItem) => (
                <div key={msg.id} className={`flex flex-col max-w-[80%] ${msg.senderType === 'business' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                  <div className={`p-3 rounded-2xl ${msg.senderType === 'business' ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-card border border-white/10 text-white rounded-tl-sm'}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                    {msg.mediaUrl && <img src={msg.mediaUrl} className="mt-2 rounded-lg max-w-full" />}
                  </div>
                  <span className="text-[10px] text-white/40 mt-1 px-1">{new Date(msg.createdAt || "").toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSend} className="p-4 bg-card border-t border-white/10 flex gap-2">
              <Input 
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-background border-white/10"
              />
              <Button type="submit" disabled={!message.trim() || sendMessage.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">Send</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
