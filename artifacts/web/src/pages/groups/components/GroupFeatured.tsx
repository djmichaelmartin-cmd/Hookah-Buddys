import { useState } from "react";
import { 
  useListGroupFeaturedContent, 
  useAddGroupFeaturedContent,
  useRemoveGroupFeaturedContent,
  getListGroupFeaturedContentQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, Trash2, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function GroupFeatured({ groupId, isAdmin }: { groupId: number, isAdmin: boolean }) {
  const { data: featured, isLoading } = useListGroupFeaturedContent(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAdding, setIsAdding] = useState(false);
  const [contentType, setContentType] = useState<"post" | "member" | "media">("post");
  const [contentIdStr, setContentIdStr] = useState("");
  
  const addFeatured = useAddGroupFeaturedContent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Featured content added" });
        queryClient.invalidateQueries({ queryKey: getListGroupFeaturedContentQueryKey(groupId) });
        setIsAdding(false);
        setContentIdStr("");
      },
      onError: () => toast({ title: "Failed to add featured content", variant: "destructive" })
    }
  });

  const removeFeatured = useRemoveGroupFeaturedContent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Featured content removed" });
        queryClient.invalidateQueries({ queryKey: getListGroupFeaturedContentQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to remove featured content", variant: "destructive" })
    }
  });

  if (isLoading) {
    return <div className="p-6 bg-card border border-white/10 rounded-2xl animate-pulse h-32" />;
  }

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-serif text-white flex items-center gap-2"><Star className="w-5 h-5 text-[#D6B56D]" /> Featured Content</h3>
        {isAdmin && !isAdding && (
          <Button size="sm" onClick={() => setIsAdding(true)} data-testid="add-featured-btn">
            <Plus className="w-4 h-4 mr-2" /> Add Featured
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="bg-background/50 border border-white/5 p-4 rounded-xl mb-4 flex flex-col sm:flex-row gap-3">
          <Select value={contentType} onValueChange={(val: any) => setContentType(val)}>
            <SelectTrigger className="w-[150px] bg-card border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="post">Post</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="media">Media</SelectItem>
            </SelectContent>
          </Select>
          <Input 
            value={contentIdStr} 
            onChange={e => setContentIdStr(e.target.value)} 
            placeholder={`${contentType} ID`} 
            className="bg-card border-white/10 flex-1" 
          />
          <div className="flex gap-2">
            <Button 
              onClick={() => {
                const id = parseInt(contentIdStr);
                if (!isNaN(id)) {
                  addFeatured.mutate({ groupId, data: { contentType, contentId: id, sortOrder: 0 } });
                }
              }} 
              disabled={!contentIdStr || addFeatured.isPending}
              data-testid="save-featured-btn"
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setIsAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {!featured || featured.length === 0 ? (
        <div className="p-12 bg-card/50 border border-dashed border-white/10 rounded-2xl text-center">
          <Star className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">No featured content yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {featured.map(f => (
            <div key={f.id} className="bg-background/30 border border-white/5 p-4 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-white capitalize">{f.contentType}</p>
                <p className="text-xs text-muted-foreground">ID: {f.contentId}</p>
              </div>
              {isAdmin && (
                <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => removeFeatured.mutate({ groupId, featuredId: f.id })} data-testid="remove-featured-btn">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
