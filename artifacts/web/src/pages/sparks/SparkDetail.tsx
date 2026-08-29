import { useParams, useLocation } from "wouter";
import { useEffect } from "react";
import { useGetReel, useListReels, getGetReelQueryKey, getListReelsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { SparkPlayer } from "@/components/sparks/SparkPlayer";
import { SparkCard } from "@/components/sparks/SparkCard";
import { Loader2, ArrowLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SparkDetail() {
  const { id } = useParams();
  const numericId = Number(id);
  const [, setLocation] = useLocation();
  const { data: spark, isLoading } = useGetReel(numericId, {
    query: { enabled: !!numericId, queryKey: getGetReelQueryKey(numericId) }
  });

  const { data: relatedReels } = useListReels(
    { category: spark?.category, limit: 5 },
    { query: { enabled: !!spark?.category, queryKey: getListReelsQueryKey({ category: spark?.category, limit: 5 }) } }
  );

  const relatedSparks = relatedReels?.filter(r => r.id !== numericId).slice(0, 4) || [];

  useEffect(() => {
    if (spark) {
      document.title = `${spark.userName ? spark.userName + "'s " : ""}Spark | HookahBuddys`;
    } else {
      document.title = "Spark | HookahBuddys";
    }
  }, [spark]);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/sparks")}
          className="mb-8 rounded-full hover:bg-white/10 text-white/80 transition-colors font-bold px-6 py-5"
          data-testid="button-back-sparks"
        >
          <ArrowLeft className="w-5 h-5 mr-3" /> Back to Sparks
        </Button>
        
        {isLoading ? (
           <div className="flex justify-center items-center py-40" data-testid="loading-spark-detail">
             <Loader2 className="w-12 h-12 animate-spin text-primary" />
           </div>
        ) : spark ? (
           <div className="space-y-12">
             <div data-testid={`spark-detail-${spark.id}`}>
               <SparkPlayer spark={spark} onClose={() => setLocation("/sparks")} inline={true} />
             </div>
             
             {relatedSparks.length > 0 && (
               <div className="border-t border-white/10 pt-12">
                 <h2 className="text-2xl font-serif text-white font-bold mb-6 flex items-center gap-3">
                   <Zap className="w-6 h-6 text-primary fill-primary" /> Related Sparks
                 </h2>
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                   {relatedSparks.map(related => (
                     <SparkCard 
                       key={related.id} 
                       spark={related} 
                       onClick={() => setLocation(`/sparks/${related.id}`)} 
                     />
                   ))}
                 </div>
               </div>
             )}
           </div>
        ) : (
           <div className="bg-card/40 border border-white/5 rounded-3xl p-16 text-center max-w-xl mx-auto mt-12 shadow-2xl" data-testid="error-spark-not-found">
             <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/20">
               <Zap className="w-10 h-10 text-primary fill-primary/50" />
             </div>
             <h3 className="text-3xl font-serif text-white mb-3">Spark Not Found</h3>
             <p className="text-muted-foreground text-lg mb-8">This Spark may have been removed or doesn't exist.</p>
             <Button onClick={() => setLocation("/sparks")} className="rounded-full bg-white text-black hover:bg-white/90 font-bold px-8 shadow-lg">
               Discover Sparks
             </Button>
           </div>
        )}
      </div>
    </Layout>
  )
}
