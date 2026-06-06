import { Layout } from "@/components/Layout";
import { useGetDoll } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldCheck, MessageSquare, Video, Star } from "lucide-react";

export default function DollProfile() {
  const { id } = useParams();
  const dollId = parseInt(id || "0", 10);
  const { data: doll, isLoading } = useGetDoll(dollId, { query: { enabled: !!dollId } });

  if (isLoading) return <Layout><div className="container p-12 text-center text-muted-foreground">Loading...</div></Layout>;
  if (!doll) return <Layout><div className="container p-12 text-center text-muted-foreground">Doll not found</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col md:flex-row gap-12">
          {/* Profile Sidebar */}
          <div className="w-full md:w-1/3 space-y-6">
            <div className="rounded-2xl overflow-hidden border border-white/10 aspect-[3/4] bg-card relative">
               {doll.profilePhotoUrl ? (
                  <img src={doll.profilePhotoUrl} alt={doll.stageName} className="object-cover w-full h-full" />
                ) : (
                  <div className="w-full h-full bg-card flex items-center justify-center">
                    <Star className="w-12 h-12 text-muted-foreground/30" />
                  </div>
                )}
            </div>
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-3xl font-serif text-white font-bold">{doll.stageName}</h1>
                {doll.verified && <ShieldCheck className="w-6 h-6 text-primary" />}
              </div>
              <p className="text-muted-foreground mb-4">{doll.city}, {doll.state} &bull; {doll.age} yrs</p>
              <div className="space-y-3">
                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Star className="w-4 h-4 mr-2" /> Subscribe
                </Button>
                <Button variant="outline" className="w-full border-primary/50 text-primary hover:bg-primary/10">
                  <MessageSquare className="w-4 h-4 mr-2" /> Message
                </Button>
                <Button variant="outline" className="w-full border-secondary/50 text-secondary hover:bg-secondary/10">
                  <Video className="w-4 h-4 mr-2" /> Request Video Chat
                </Button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="w-full md:w-2/3 space-y-8">
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <h2 className="text-xl font-serif text-white mb-4">About Me</h2>
              <p className="text-muted-foreground whitespace-pre-wrap">{doll.bio || "No bio provided."}</p>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Favorite Flavor</p>
                  <p className="text-white font-medium">{doll.favoriteFlavor || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Experience</p>
                  <p className="text-white font-medium">{doll.experienceLevel || "N/A"}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-xl p-6 min-h-[400px]">
               <h2 className="text-xl font-serif text-white mb-4">Content</h2>
               <p className="text-muted-foreground">Media gallery placeholder...</p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
