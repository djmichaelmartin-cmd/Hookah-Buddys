import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Pin, EyeOff, Image as ImageIcon } from "lucide-react";
import { uploadImage } from "@/lib/uploadImage";
import {  
  useListBusinessPosts,
  useCreateBusinessPost,
  useDeleteBusinessPost,
  usePinBusinessPost,
  useHideBusinessPost,
  getListBusinessPostsQueryKey
, BusinessDetail, BusinessPostItem } from "@workspace/api-client-react";

export function DashboardPosts({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  const { data: posts, isLoading } = useListBusinessPosts(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessPostsQueryKey(business.handle) }
  });

  const createPost = useCreateBusinessPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post created" });
        setIsAdding(false);
        setText("");
        setImageFile(null);
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  const deletePost = useDeleteBusinessPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  const pinPost = usePinBusinessPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  const hidePost = useHideBusinessPost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessPostsQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !imageFile) return;
    
    let mediaUrl = undefined;
    if (imageFile) {
      try {
        mediaUrl = await uploadImage(imageFile);
      } catch (err: unknown) {
        toast({ title: "Image upload failed", description: getErrorMessage(err), variant: "destructive" });
        return;
      }
    }
    
    createPost.mutate({ handle: business.handle, data: { text, mediaUrl, mediaType: mediaUrl ? "image" : "none" } });
  };

  return (
    <div className="space-y-6 pt-6 border-t border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-white">Posts & Updates</h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> New Post</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Update Text</label>
              <Textarea required={!imageFile} value={text} onChange={e => setText(e.target.value)} className="bg-background border-white/10 min-h-[100px]" placeholder="What's new?" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Image (optional)</label>
              <div className="flex items-center gap-4">
                {imageFile && (
                  <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-white/10">
                    <img src={URL.createObjectURL(imageFile)} className="w-full h-full object-cover" />
                  </div>
                )}
                <Input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] || null)} className="bg-background border-white/10" />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={createPost.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">
              {createPost.isPending ? "Posting..." : "Publish Post"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading posts...</div>
      ) : !posts || posts.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No posts yet. Keep your customers updated!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {posts.map((post: BusinessPostItem) => (
            <div key={post.id} className={`bg-card border ${post.isPinned ? 'border-[#D6B56D]' : 'border-white/10'} p-5 rounded-2xl`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>{new Date(post.createdAt || "").toLocaleDateString()}</span>
                  {post.isPinned && <span className="bg-[#D6B56D]/20 text-[#D6B56D] px-2 py-0.5 rounded text-[10px] font-bold">PINNED</span>}
                  {post.status === "hidden" && <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold">HIDDEN</span>}
                </div>
                <div className="flex gap-1">
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={() => pinPost.mutate({ handle: business.handle, postId: post.id })}
                    className={post.isPinned ? "text-[#D6B56D]" : "text-white/40 hover:text-white"}
                    title="Toggle Pin"
                  >
                    <Pin className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={() => hidePost.mutate({ handle: business.handle, postId: post.id })}
                    className={post.status === "hidden" ? "text-red-400" : "text-white/40 hover:text-white"}
                    title="Toggle Hide"
                  >
                    <EyeOff className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={() => deletePost.mutate({ handle: business.handle, postId: post.id })}
                    className="text-white/40 hover:text-destructive hover:bg-destructive/10"
                    title="Delete Post"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <p className="text-white text-sm whitespace-pre-wrap">{post.text}</p>
              
              {post.mediaUrl && (
                <div className="mt-4 rounded-xl overflow-hidden border border-white/10 max-h-64">
                  <img src={post.mediaUrl} className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
