import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useListGroups, type GroupSummary } from "@workspace/api-client-react";
import { Search, Users, ShieldCheck, Lock, Globe, Plus, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import LoungeLeftSidebar from "@/components/lounge/LoungeLeftSidebar";
import LoungeRightSidebar from "@/components/lounge/LoungeRightSidebar";

export default function GroupsDiscover() {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [category, setCategory] = useState<string>("all");
  const [privacy, setPrivacy] = useState<string>("all");

  const queryParams = {
    search: debouncedSearch || undefined,
    category: category !== "all" ? category : undefined,
    privacy: privacy !== "all" ? (privacy as any) : undefined,
  };

  const { data: groupsData, isLoading } = useListGroups(queryParams);
  const groups = groupsData?.groups || [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-[1400px]">
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-serif text-4xl text-white font-bold flex items-center gap-3 drop-shadow-md">
              Groups
            </h1>
            <p className="text-muted-foreground mt-2 max-w-xl">
              Discover and join groups centered around your interests. Find locals, discuss flavors, or form private squads.
            </p>
          </div>
          <Link href="/groups/create">
            <Button className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] font-bold rounded-full h-11 px-6">
              <Plus className="h-5 w-5 mr-2" /> Create Group
            </Button>
          </Link>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_320px] lg:gap-6 lg:items-start">
          {/* Left sidebar */}
          <div className="hidden lg:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeLeftSidebar />
          </div>

          {/* Center content */}
          <div className="min-w-0">
            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-card/40 border border-white/5 p-3 rounded-2xl backdrop-blur-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search groups..."
                  className="pl-9 h-11 bg-background/50 border-white/10 rounded-xl"
                />
              </div>
              <div className="flex gap-2">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-[140px] h-11 bg-background/50 border-white/10 rounded-xl">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="Nightlife">Nightlife</SelectItem>
                    <SelectItem value="Tobacco">Tobacco</SelectItem>
                    <SelectItem value="Gaming">Gaming</SelectItem>
                    <SelectItem value="Local">Local</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={privacy} onValueChange={setPrivacy}>
                  <SelectTrigger className="w-[130px] h-11 bg-background/50 border-white/10 rounded-xl">
                    <SelectValue placeholder="Privacy" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="all">Any Privacy</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Group Grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-40 animate-pulse bg-card/50 border border-white/5 rounded-2xl" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="py-24 text-center bg-card/30 border border-white/5 rounded-3xl backdrop-blur-md">
                <Users className="w-16 h-16 mx-auto text-white/20 mb-4" />
                <h3 className="text-xl font-serif text-white mb-2">No groups found</h3>
                <p className="text-white/60 mb-6 max-w-md mx-auto">
                  Try adjusting your search or filters, or be the first to start a group for this topic.
                </p>
                <Link href="/groups/create">
                  <Button variant="outline" className="rounded-full border-white/20 hover:bg-white/10">
                    Create Group
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {groups.map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))}
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="hidden xl:block sticky top-[124px] max-h-[calc(100vh-140px)] overflow-y-auto hide-scrollbar">
            <LoungeRightSidebar />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <Link href={`/groups/${group.id}`}>
      <div className="group relative flex flex-col h-full bg-card border border-white/10 hover:border-primary/50 rounded-2xl overflow-hidden transition-all duration-300 hover-elevate shadow-md cursor-pointer">
        <div className="h-24 bg-[#171A21] relative overflow-hidden shrink-0">
          {group.coverUrl ? (
            <img src={group.coverUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
          )}
        </div>
        <div className="p-4 pt-0 relative flex-grow flex flex-col">
          <div className="h-14 w-14 rounded-xl overflow-hidden border-4 border-card bg-[#171A21] -mt-6 mb-3 shrink-0 flex items-center justify-center shadow-md relative">
            {group.iconUrl ? (
              <img src={group.iconUrl} className="w-full h-full object-cover" alt="" />
            ) : (
              <Users className="w-6 h-6 text-white/40" />
            )}
          </div>
          
          <div className="flex-grow">
            <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors line-clamp-1 flex items-center gap-1.5">
              {group.name}
            </h3>
            {group.handle && <p className="text-sm text-white/50 mb-2">g/{group.handle}</p>}
            
            <p className="text-sm text-white/80 line-clamp-2 mt-2 leading-relaxed">
              {group.description || "A HookahBuddys group."}
            </p>
          </div>

          <div className="flex items-center justify-between text-xs text-white/60 mt-4 pt-3 border-t border-white/5">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                {group.privacy === 'public' ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span className="capitalize">{group.privacy}</span>
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                <span>{group.memberCount}</span>
              </span>
            </div>
            {group.category && (
              <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10">
                {group.category}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
