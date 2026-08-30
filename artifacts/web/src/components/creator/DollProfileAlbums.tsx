import { useState } from "react";
import { 
  useListCreatorAlbums, 
  getListCreatorAlbumsQueryKey,
  useUnlockCreatorAlbum,
  type CreatorAlbum,
  type CreatorAlbumMedia
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Lock, Video, Sparkles, CheckCircle2, WandSparkles } from "lucide-react";

const ALBUM_COPY = {
  free_preview: {
    title: "Free Album",
    description: "Browse this Creator's free photos.",
  },
  cloud_vibes: {
    title: "Cool Album",
    description: "Unlock permanent access to an album that may include both photos and videos.",
  },
  smokin_hot: {
    title: "Smokin Hot Album",
    description: "Unlock permanent access to photos and videos in this album, plus access to the Cool Album.",
  },
} as const;

export function DollProfileAlbums({
  creatorUserId,
  onUnlockError,
  onRequest,
  requestsAvailable,
  requestPrice,
}: {
  creatorUserId: number;
  onUnlockError: (err: unknown) => void;
  onRequest: () => void;
  requestsAvailable: boolean;
  requestPrice?: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: albums, isLoading } = useListCreatorAlbums(creatorUserId, {
    query: { enabled: !!creatorUserId, queryKey: getListCreatorAlbumsQueryKey(creatorUserId) }
  });

  const unlock = useUnlockCreatorAlbum({
    mutation: {
      onSuccess: () => {
        toast({ title: "Album unlocked!" });
        queryClient.invalidateQueries({ queryKey: getListCreatorAlbumsQueryKey(creatorUserId) });
      },
      onError: onUnlockError
    }
  });

  const [activeAlbum, setActiveAlbum] = useState<CreatorAlbum | null>(null);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading albums...</div>;

  const freePreview = albums?.find(a => a.albumType === "free_preview");
  const cloudVibes = albums?.find(a => a.albumType === "cloud_vibes");
  const smokinHot = albums?.find(a => a.albumType === "smokin_hot");
  const hasCloud = Boolean(cloudVibes?.unlocked || smokinHot?.unlocked);
  const smokinPrice = hasCloud ? 75 : 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {freePreview && (
          <AlbumCard 
            album={freePreview} 
            title={ALBUM_COPY.free_preview.title}
            description={ALBUM_COPY.free_preview.description}
            price={0} 
            available={freePreview.isActive}
            icon={<ImageIcon className="w-5 h-5 text-green-400" />}
            onOpen={() => setActiveAlbum(freePreview)}
          />
        )}
        {cloudVibes && (
          <AlbumCard 
            album={cloudVibes} 
            title={ALBUM_COPY.cloud_vibes.title}
            description={ALBUM_COPY.cloud_vibes.description}
            price={25} 
            available={cloudVibes.isActive}
            icon={<Sparkles className="w-5 h-5 text-blue-400" />}
            onOpen={() => setActiveAlbum(cloudVibes)}
          />
        )}
        {smokinHot && (
          <AlbumCard 
            album={smokinHot} 
            title={ALBUM_COPY.smokin_hot.title}
            description={ALBUM_COPY.smokin_hot.description}
            price={smokinPrice}
            available={smokinHot.isActive}
            icon={<Video className="w-5 h-5 text-red-400" />}
            onOpen={() => setActiveAlbum(smokinHot)}
          />
        )}
        <button
          type="button"
          data-testid="button-custom-content-request"
          className="bg-card/50 hover:bg-card/80 transition-colors border border-primary/30 rounded-xl p-5 text-left group flex flex-col h-full disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRequest}
          disabled={!requestsAvailable}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <WandSparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h4 className="font-bold text-white group-hover:text-primary transition-colors">Custom Photo/Video Request</h4>
              <p className="text-xs text-muted-foreground">
                {requestsAvailable
                  ? requestPrice
                    ? `From ${requestPrice} Credits`
                    : "Available now"
                  : "Creator is offline"}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground flex-1 mb-4">
            Send a private, structured request while this Creator is active.
          </p>
          <span className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 px-3 text-xs font-medium text-white">
            {requestsAvailable ? "Start Request" : "Unavailable"}
          </span>
        </button>
      </div>

      <Dialog open={!!activeAlbum} onOpenChange={(open) => !open && setActiveAlbum(null)}>
        <DialogContent className="bg-card border-white/10 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif text-white capitalize flex items-center gap-2">
              {activeAlbum ? ALBUM_COPY[activeAlbum.albumType].title : ""}
              {activeAlbum?.unlocked && <CheckCircle2 className="w-5 h-5 text-green-400" />}
            </DialogTitle>
          </DialogHeader>

          {activeAlbum && (
            <div className="space-y-6 pt-4">
              <p className="text-sm text-muted-foreground">{ALBUM_COPY[activeAlbum.albumType].description}</p>
              
              {!activeAlbum.unlocked ? (
                <div className="bg-background/50 rounded-xl p-8 text-center border border-white/5 flex flex-col items-center">
                  <Lock className="w-12 h-12 text-primary mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">Unlock this Album</h3>
                  <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                    Get permanent access to {activeAlbum.media?.length || 0} exclusive photos and videos in this album.
                  </p>
                  <Button 
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => unlock.mutate({ albumId: activeAlbum.id })}
                    disabled={unlock.isPending}
                  >
                    {unlock.isPending ? "Unlocking..." : `Unlock for ${activeAlbum.albumType === "cloud_vibes" ? 25 : smokinPrice} Credits`}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-2">
                  {activeAlbum.media?.map(m => (
                    <div key={m.id} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-black">
                      {m.mediaType === 'video' ? (
                        m.objectPath ? (
                          <video src={m.objectPath} controls className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center"><Video className="w-6 h-6 text-muted-foreground/30" /></div>
                        )
                      ) : (
                        m.objectPath ? (
                          <img src={m.objectPath} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center"><ImageIcon className="w-6 h-6 text-muted-foreground/30" /></div>
                        )
                      )}
                    </div>
                  ))}
                  {(!activeAlbum.media || activeAlbum.media.length === 0) && (
                    <div className="col-span-full py-8 text-center text-muted-foreground bg-background/30 rounded-lg">
                      No media in this album yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AlbumCard({ album, title, description, price, available, icon, onOpen }: { album: CreatorAlbum; title: string; description: string; price: number; available: boolean; icon: React.ReactNode; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid={`button-album-${album.albumType}`}
      className="bg-card/50 hover:bg-card/80 transition-colors border border-white/10 rounded-xl p-5 cursor-pointer group flex flex-col h-full"
      onClick={onOpen}
      disabled={!available}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-background/50 border border-white/5">
          {icon}
        </div>
        <div>
          <h4 className="font-bold text-white group-hover:text-primary transition-colors">{title}</h4>
          <p className="text-xs text-muted-foreground">{!available ? 'Unavailable' : album.unlocked ? 'Unlocked' : price > 0 ? `${price} Credits` : 'Free'}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground flex-1 mb-4">{description}</p>
      
      <span className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 px-3 text-xs font-medium text-white">
        {!available ? 'Unavailable' : album.unlocked ? 'View Album' : 'Unlock'}
      </span>
    </button>
  );
}