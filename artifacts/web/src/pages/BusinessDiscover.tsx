import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { useListBusinesses, ListBusinessesSort, BusinessSummary } from "@workspace/api-client-react";
import { Search, MapPin, Star, Building2, Store, Filter, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebounce } from "@/hooks/use-debounce";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export default function BusinessDiscover() {
  const [_, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  
  // Basic filters
  const [category, setCategory] = useState<string>("all");
  const [businessType, setBusinessType] = useState<string>("all");
  
  // Advanced filters
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [sponsoredOnly, setSponsoredOnly] = useState(false);
  const [openNow, setOpenNow] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [minRating, setMinRating] = useState<string>("0");
  const [sortBy, setSortBy] = useState<ListBusinessesSort>("recommended");

  const queryParams = {
    q: debouncedSearch || undefined,
    category: category !== "all" ? category : undefined,
    businessType: businessType !== "all" ? businessType : undefined,
    verified: verifiedOnly ? "true" : undefined,
    featured: featuredOnly ? "true" : undefined,
    sponsored: sponsoredOnly ? "true" : undefined,
    openNow: openNow ? "true" : undefined,
    hasServices: hasContent ? "true" : undefined,
    minRating: minRating !== "0" ? Number(minRating) : undefined,
    sort: sortBy !== "recommended" ? sortBy : undefined,
  };

  const { data: businessesResponse, isLoading } = useListBusinesses(queryParams);

  const businesses = businessesResponse || [];

  return (
    <Layout>
      <div className="relative pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-20 mix-blend-screen bg-[radial-gradient(ellipse_at_top_right,var(--primary),transparent_50%),radial-gradient(ellipse_at_bottom_left,var(--secondary),transparent_50%)]" />
        
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-serif text-white mb-4 tracking-tight drop-shadow-sm">
              Discover <span className="text-[#D6B56D]">Businesses</span>
            </h1>
            <p className="text-lg text-white/70 max-w-2xl mx-auto">
              Find and connect with top lounges, brands, creators, and professional services.
            </p>
          </div>

          <div className="max-w-4xl mx-auto flex gap-3">
            <div className="relative flex-grow">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 h-5 w-5" />
              <Input 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search businesses..."
                className="pl-12 h-14 bg-card/60 backdrop-blur-xl border-white/10 text-white placeholder:text-white/40 rounded-full w-full text-base focus-visible:ring-[#D6B56D]"
              />
            </div>

            {/* Mobile Filters Sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-14 px-4 bg-card/60 border-white/10 text-white rounded-full flex items-center gap-2 lg:hidden shrink-0">
                  <Filter className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="bg-card border-white/10 text-white p-6 overflow-y-auto w-full sm:max-w-sm">
                <SheetHeader className="mb-6">
                  <SheetTitle className="text-white">Filters</SheetTitle>
                </SheetHeader>
                <AdvancedFilters 
                  category={category} setCategory={setCategory}
                  businessType={businessType} setBusinessType={setBusinessType}
                  verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
                  featuredOnly={featuredOnly} setFeaturedOnly={setFeaturedOnly}
                  sponsoredOnly={sponsoredOnly} setSponsoredOnly={setSponsoredOnly}
                  openNow={openNow} setOpenNow={setOpenNow}
                  hasContent={hasContent} setHasContent={setHasContent}
                  minRating={minRating} setMinRating={setMinRating}
                  sortBy={sortBy} setSortBy={setSortBy}
                />
              </SheetContent>
            </Sheet>
          </div>

          {/* Desktop Filters Row */}
          <div className="hidden lg:flex max-w-4xl mx-auto mt-6 bg-card/60 backdrop-blur-xl border border-white/10 rounded-3xl p-6 flex-wrap gap-x-8 gap-y-6">
            <AdvancedFilters 
              category={category} setCategory={setCategory}
              businessType={businessType} setBusinessType={setBusinessType}
              verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
              featuredOnly={featuredOnly} setFeaturedOnly={setFeaturedOnly}
              sponsoredOnly={sponsoredOnly} setSponsoredOnly={setSponsoredOnly}
              openNow={openNow} setOpenNow={setOpenNow}
              hasContent={hasContent} setHasContent={setHasContent}
              minRating={minRating} setMinRating={setMinRating}
              sortBy={sortBy} setSortBy={setSortBy}
            />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pb-24 max-w-6xl">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse bg-card/50 border border-white/5 rounded-2xl h-[320px]" />
            ))}
          </div>
        ) : businesses.length === 0 ? (
          <div className="text-center py-24 bg-card/30 border border-white/5 rounded-3xl">
            <Building2 className="w-16 h-16 mx-auto text-white/20 mb-4" />
            <h3 className="text-xl font-serif text-white mb-2">No businesses found</h3>
            <p className="text-white/60 mb-6 max-w-md mx-auto">
              We couldn't find any businesses matching your search criteria. Try adjusting your filters.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {businesses.map((business: BusinessSummary) => (
              <Link 
                key={business.id} 
                href={`/business/${business.handle}`}
                className="group relative flex flex-col bg-card border border-white/10 hover:border-[#D6B56D]/50 rounded-2xl overflow-hidden transition-all duration-300 hover-elevate shadow-lg"
              >
                {/* Badges overlay */}
                <div className="absolute top-3 right-3 z-20 flex gap-2">
                  {business.badges?.includes("sponsored") && <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest shadow-lg">Sponsored</span>}
                  {business.badges?.includes("featured") && <span className="bg-[#D6B56D] text-[#111] text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest shadow-lg">Featured</span>}
                </div>

                <div className="h-32 bg-[#171A21] relative overflow-hidden">
                  {business.coverUrl ? (
                    <img src={business.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
                  )}
                </div>

                <div className="p-5 pt-0 relative flex-grow flex flex-col">
                  <div className="h-16 w-16 rounded-xl overflow-hidden border-4 border-card bg-[#171A21] -mt-8 mb-3 shrink-0 flex items-center justify-center shadow-md relative">
                    {business.logoUrl ? (
                      <img src={business.logoUrl} className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-6 h-6 text-white/40" />
                    )}
                  </div>
                  
                  <div className="flex-grow">
                    <h3 className="text-lg font-bold text-white group-hover:text-[#D6B56D] transition-colors line-clamp-1 flex items-center gap-1.5">
                      {business.name}
                      {business.badges?.includes("verified") && <CheckCircle className="w-4 h-4 text-green-400 fill-current bg-background rounded-full shrink-0" />}
                    </h3>
                    <p className="text-sm text-white/50 mb-2">@{business.handle}</p>
                    
                    {business.tagline && (
                      <p className="text-sm text-white/80 line-clamp-2 mb-4 leading-relaxed">
                        {business.tagline}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/60 mt-4 pt-4 border-t border-white/5">
                    <div className="flex flex-col gap-1.5">
                      {business.city && business.state && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{business.city}, {business.state}</span>
                        </div>
                      )}
                    </div>
                    {(business.averageRating ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5 text-[#D6B56D]">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span className="font-medium">{business.averageRating?.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function AdvancedFilters({ 
  category, setCategory, businessType, setBusinessType, 
  verifiedOnly, setVerifiedOnly, featuredOnly, setFeaturedOnly, sponsoredOnly, setSponsoredOnly,
  openNow, setOpenNow, hasContent, setHasContent, minRating, setMinRating, sortBy, setSortBy 
}: {
  category: string, setCategory: (v: string) => void, businessType: string, setBusinessType: (v: string) => void, 
  verifiedOnly: boolean, setVerifiedOnly: (v: boolean) => void, featuredOnly: boolean, setFeaturedOnly: (v: boolean) => void, sponsoredOnly: boolean, setSponsoredOnly: (v: boolean) => void,
  openNow: boolean, setOpenNow: (v: boolean) => void, hasContent: boolean, setHasContent: (v: boolean) => void, minRating: string, setMinRating: (v: string) => void, sortBy: ListBusinessesSort, setSortBy: (v: ListBusinessesSort) => void
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:flex-wrap gap-x-8 gap-y-6 w-full">
      <div className="flex-1 min-w-[200px] space-y-2">
        <label className="text-xs font-medium text-white/50 uppercase tracking-widest">Type & Category</label>
        <div className="flex gap-2">
          <Select value={businessType} onValueChange={setBusinessType}>
            <SelectTrigger className="bg-background/50 border-white/10 text-white rounded-lg h-9">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="lounge">Lounge</SelectItem>
              <SelectItem value="brand">Brand</SelectItem>
              <SelectItem value="creator">Creator</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-background/50 border-white/10 text-white rounded-lg h-9">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="nightlife">Nightlife</SelectItem>
              <SelectItem value="tobacco">Tobacco</SelectItem>
              <SelectItem value="entertainment">Entertainment</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 min-w-[150px] space-y-2">
        <label className="text-xs font-medium text-white/50 uppercase tracking-widest">Rating & Sort</label>
        <div className="flex gap-2">
          <Select value={minRating} onValueChange={setMinRating}>
            <SelectTrigger className="bg-background/50 border-white/10 text-white rounded-lg h-9">
              <SelectValue placeholder="Rating" />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="0">Any Rating</SelectItem>
              <SelectItem value="4">4.0+ Stars</SelectItem>
              <SelectItem value="4.5">4.5+ Stars</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="bg-background/50 border-white/10 text-white rounded-lg h-9">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="recommended">Recommended</SelectItem>
               <SelectItem value="most_followed">Most Followed</SelectItem>
               <SelectItem value="most_recommended">Most Recommended</SelectItem>
               <SelectItem value="recently_active">Recently Active</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="w-full lg:w-auto space-y-3 lg:space-y-2 pt-2 lg:pt-0">
        <label className="text-xs font-medium text-white/50 uppercase tracking-widest block mb-1">Features</label>
        <div className="grid grid-cols-2 lg:flex lg:flex-row gap-4 lg:gap-6">
          <div className="flex items-center space-x-2">
            <Checkbox id="verified" checked={verifiedOnly} onCheckedChange={(c) => setVerifiedOnly(!!c)} className="border-white/20 data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]" />
            <label htmlFor="verified" className="text-sm font-medium text-white/80 cursor-pointer">Verified</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="featured" checked={featuredOnly} onCheckedChange={(c) => setFeaturedOnly(!!c)} className="border-white/20 data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]" />
            <label htmlFor="featured" className="text-sm font-medium text-white/80 cursor-pointer">Featured</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="sponsored" checked={sponsoredOnly} onCheckedChange={(c) => setSponsoredOnly(!!c)} className="border-white/20 data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]" />
            <label htmlFor="sponsored" className="text-sm font-medium text-white/80 cursor-pointer">Sponsored</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="open" checked={openNow} onCheckedChange={(c) => setOpenNow(!!c)} className="border-white/20 data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]" />
            <label htmlFor="open" className="text-sm font-medium text-white/80 cursor-pointer">Open Now</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="content" checked={hasContent} onCheckedChange={(c) => setHasContent(!!c)} className="border-white/20 data-[state=checked]:bg-[#D6B56D] data-[state=checked]:text-[#111]" />
            <label htmlFor="content" className="text-sm font-medium text-white/80 cursor-pointer">Has Content</label>
          </div>
        </div>
      </div>
    </div>
  );
}
