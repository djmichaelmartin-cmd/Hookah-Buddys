import { useState } from "react";
import {  BusinessDetail , BusinessMediaItem, BusinessAlbum } from "@workspace/api-client-react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Image as ImageIcon, Film, Video, FolderHeart, CheckCircle, XCircle } from "lucide-react";
import { uploadImage, uploadVideo } from "@/lib/uploadImage";
import { 
  useListBusinessAlbums,
  useUpsertBusinessAlbum,
  useDeleteBusinessAlbum,
  useListBusinessMedia,
  useCreateBusinessMedia,
  useDeleteBusinessMedia,
  useReviewBusinessCustomerMedia,
  getListBusinessAlbumsQueryKey,
  getListBusinessMediaQueryKey,
  BusinessMediaInputKind
} from "@workspace/api-client-react";

export function DashboardMedia({ business }: { business: BusinessDetail }) {
  const [currentTab, setCurrentTab] = useState<BusinessMediaInputKind | "album">("photo");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-[#D6B56D]" /> Media Manager
        </h3>
      </div>

      <Tabs
        value={currentTab}
        onValueChange={(value) => {
          if (value === "album" || value === "photo" || value === "reel" || value === "video") {
            setCurrentTab(value);
          }
        }}
        className="w-full"
      >
        <TabsList className="bg-card border border-white/10 mb-6 flex overflow-x-auto hide-scrollbar w-full h-auto p-1">
          <TabsTrigger value="photo"><ImageIcon className="w-4 h-4 mr-2" /> Photos</TabsTrigger>
          <TabsTrigger value="reel"><Film className="w-4 h-4 mr-2" /> Sparks</TabsTrigger>
          <TabsTrigger value="video"><Video className="w-4 h-4 mr-2" /> Videos</TabsTrigger>
          <TabsTrigger value="album"><FolderHeart className="w-4 h-4 mr-2" /> Albums</TabsTrigger>
        </TabsList>

        <TabsContent value="photo">
          <MediaManager business={business} kind="photo" />
        </TabsContent>
        <TabsContent value="reel">
          <MediaManager business={business} kind="reel" />
        </TabsContent>
        <TabsContent value="video">
          <MediaManager business={business} kind="video" />
        </TabsContent>
        <TabsContent value="album">
          <AlbumsManager business={business} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AlbumsManager({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const { data: albums, isLoading } = useListBusinessAlbums(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessAlbumsQueryKey(business.handle) }
  });

  const upsertAlbum = useUpsertBusinessAlbum({
    mutation: {
      onSuccess: () => {
        toast({ title: "Album saved" });
        setIsAdding(false);
        setTitle("");
        setDescription("");
        setCoverFile(null);
        queryClient.invalidateQueries({ queryKey: getListBusinessAlbumsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to save", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const deleteAlbum = useDeleteBusinessAlbum({
    mutation: {
      onSuccess: () => {
        toast({ title: "Album deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessAlbumsQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;
    
    let coverUrl = undefined;
    if (coverFile) {
      try {
        coverUrl = await uploadImage(coverFile);
      } catch (err: unknown) {
        toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
        return;
      }
    }

    upsertAlbum.mutate({ handle: business.handle, data: { title, description, coverUrl } });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-4">
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Add Album</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Title</label>
              <Input required value={title} onChange={e => setTitle(e.target.value)} className="bg-background border-white/10" placeholder="e.g. Summer Menu" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Cover Image (optional)</label>
              <Input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0] || null)} className="bg-background border-white/10" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} className="bg-background border-white/10" placeholder="About this album..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={upsertAlbum.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">Save Album</Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading albums...</div>
      ) : !albums || albums.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No albums added.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {albums.map((album: BusinessAlbum) => (
            <div key={album.id} className="bg-card border border-white/10 rounded-2xl overflow-hidden group">
              <div className="aspect-square bg-background relative">
                {album.coverUrl ? (
                  <img src={album.coverUrl} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20"><FolderHeart className="w-8 h-8"/></div>
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Button size="icon" variant="destructive" onClick={() => deleteAlbum.mutate({ handle: business.handle, albumId: album.id })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="p-3">
                <h4 className="font-bold text-white text-sm truncate">{album.title}</h4>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaManager({ business, kind }: { business: BusinessDetail, kind: BusinessMediaInputKind }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const mediaLabel = kind === "reel" ? "Spark" : kind;

  const { data: mediaList, isLoading } = useListBusinessMedia(business.handle, { kind }, {
    query: { enabled: !!business.handle, queryKey: getListBusinessMediaQueryKey(business.handle, { kind }) }
  });

  const createMedia = useCreateBusinessMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media uploaded" });
        setIsAdding(false);
        setFile(null);
        setCaption("");
        queryClient.invalidateQueries({ queryKey: getListBusinessMediaQueryKey(business.handle, { kind }) });
      },
      onError: (err: unknown) => toast({ title: "Failed to upload", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const deleteMedia = useDeleteBusinessMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media deleted" });
        queryClient.invalidateQueries({ queryKey: getListBusinessMediaQueryKey(business.handle, { kind }) });
      }
    }
  });

  const reviewMedia = useReviewBusinessCustomerMedia({
    mutation: {
      onSuccess: () => {
        toast({ title: "Media reviewed" });
        queryClient.invalidateQueries({ queryKey: getListBusinessMediaQueryKey(business.handle, { kind }) });
      }
    }
  });

  const handleReview = (mediaId: number, action: 'approve' | 'reject') => {
    reviewMedia.mutate({ handle: business.handle, mediaId, data: { action } });
  };

  const [isUploading, setIsUploading] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    
    setIsUploading(true);
    try {
      let mediaUrl = "";
      let posterUrl: string | undefined = undefined;

      if (kind === 'video' || kind === 'reel') {
        const result = await uploadVideo(file);
        mediaUrl = result.url;
        posterUrl = result.posterUrl;
      } else {
        mediaUrl = await uploadImage(file);
      }
      
      createMedia.mutate({ handle: business.handle, data: { kind, mediaUrl, posterUrl, caption } });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-4">
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Upload {mediaLabel}</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">File</label>
              <Input type="file" required accept={kind === 'photo' ? 'image/*' : 'video/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="bg-background border-white/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Caption (optional)</label>
              <Textarea value={caption} onChange={e => setCaption(e.target.value)} className="bg-background border-white/10 min-h-[80px]" placeholder="Add a caption..." />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={createMedia.isPending || isUploading || !file} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">
              {createMedia.isPending || isUploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading media...</div>
      ) : !mediaList || mediaList.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No {mediaLabel}s added yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {mediaList.map((media: BusinessMediaItem) => (
            <div key={media.id} className="bg-card border border-white/10 rounded-2xl overflow-hidden group relative aspect-square">
              {kind === 'photo' ? (
                <img src={media.mediaUrl} className="w-full h-full object-cover" />
              ) : (
                <video src={media.mediaUrl} className="w-full h-full object-cover" controls={false} />
              )}
              
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button size="icon" variant="destructive" onClick={() => deleteMedia.mutate({ handle: business.handle, mediaId: media.id })}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              
              {media.status === 'pending' && (
                <div className="absolute top-2 left-2 right-2 p-2 bg-black/80 backdrop-blur-md rounded-xl border border-yellow-500/30 flex flex-col gap-2 opacity-100">
                  <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider text-center">Pending Review</span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleReview(media.id, 'approve')} className="flex-1 bg-green-500 hover:bg-green-600 text-white h-7 text-[10px] px-1">
                      <CheckCircle className="w-3 h-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" onClick={() => handleReview(media.id, 'reject')} variant="destructive" className="flex-1 h-7 text-[10px] px-1">
                      <XCircle className="w-3 h-3 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {media.caption && (
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-xs text-white line-clamp-1">{media.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
