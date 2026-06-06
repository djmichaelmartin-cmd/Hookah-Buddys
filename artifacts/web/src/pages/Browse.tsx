import { Layout } from "@/components/Layout";
import { useListDolls } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Star } from "lucide-react";

export default function Browse() {
  const { data: dolls, isLoading } = useListDolls();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-serif text-white mb-8">Browse the Lounge</h1>
        
        {/* Simple filters placeholder */}
        <div className="mb-8 p-4 bg-card/50 border border-white/10 rounded-xl backdrop-blur-sm">
          <p className="text-muted-foreground text-sm">Filters: (City, State, Online, Video Chat, etc.)</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : dolls?.map(doll => (
            <Link key={doll.id} href={`/dolls/${doll.id}`} className="group block">
              <div className="relative h-[300px] w-full rounded-2xl overflow-hidden mb-4 border border-white/5 group-hover:border-primary/50 transition-all duration-500 shadow-lg group-hover:shadow-[0_0_30px_rgba(212,175,55,0.2)] bg-card">
                {doll.profilePhotoUrl ? (
                  <img src={doll.profilePhotoUrl} alt={doll.stageName} className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity" />
                ) : (
                  <div className="w-full h-full bg-card flex items-center justify-center">
                    <Star className="w-12 h-12 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80" />
                <div className="absolute bottom-0 left-0 p-5 w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-serif text-xl font-bold text-white">{doll.stageName}</h3>
                    {doll.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{doll.city}, {doll.state}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
