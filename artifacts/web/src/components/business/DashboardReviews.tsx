import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, MessageCircle, Reply } from "lucide-react";
import {  
  useListBusinessReviews,
  useReplyToBusinessReview,
  getListBusinessReviewsQueryKey
, BusinessDetail, BusinessReviewItem } from "@workspace/api-client-react";

export function DashboardReviews({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  
  const { data: reviews, isLoading } = useListBusinessReviews(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessReviewsQueryKey(business.handle) }
  });

  const replyMutation = useReplyToBusinessReview({
    mutation: {
      onSuccess: () => {
        toast({ title: "Reply sent" });
        setReplyingTo(null);
        setReplyText("");
        queryClient.invalidateQueries({ queryKey: getListBusinessReviewsQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to reply", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const handleReply = (e: React.FormEvent, reviewId: number) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyMutation.mutate({ handle: business.handle, reviewId, data: { text: replyText } });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><Star className="w-5 h-5 text-[#D6B56D]" /> Reviews</h3>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading reviews...</div>
      ) : !reviews || reviews.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <Star className="w-12 h-12 mx-auto mb-4 text-white/10" />
          <p className="text-white/50">No reviews yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {reviews.map((review: BusinessReviewItem) => (
            <div key={review.id} className="bg-card border border-white/10 p-6 rounded-2xl">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-background overflow-hidden border border-white/10">
                    {review.userPhotoUrl ? <img src={review.userPhotoUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-white/5 text-white/20">{review.userName?.[0] || "?"}</div>}
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">{review.userName || "Anonymous"}</h4>
                    <div className="flex text-[#D6B56D]">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? 'fill-current' : 'text-white/20'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                {/* We don't have a createdAt in the summary? */}
              </div>
              
              <p className="text-white/80 text-sm mb-4 leading-relaxed">{review.text}</p>
              
              {review.reply && (
                <div className="mt-4 pl-4 border-l-2 border-white/10 ml-4 py-3 bg-background/50 rounded-r-xl">
                  <p className="text-xs font-bold text-white/60 uppercase tracking-wider mb-1">Your Response</p>
                  <p className="text-sm text-white/80">{review.reply.text}</p>
                </div>
              )}
              
              {!review.reply && replyingTo === review.id ? (
                <form onSubmit={(e) => handleReply(e, review.id)} className="mt-4 bg-background/50 p-4 rounded-xl border border-white/5">
                  <Textarea 
                    value={replyText} 
                    onChange={e => setReplyText(e.target.value)} 
                    placeholder="Write your response..."
                    className="bg-background border-white/10 mb-3"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setReplyingTo(null)} className="text-white/60">Cancel</Button>
                    <Button type="submit" size="sm" disabled={replyMutation.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111]">
                      {replyMutation.isPending ? "Sending..." : "Post Reply"}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => { setReplyingTo(review.id); setReplyText(""); }}
                    className="text-[#D6B56D] hover:text-[#C9A456] hover:bg-[#D6B56D]/10 -ml-3"
                  >
                    <Reply className="w-4 h-4 mr-2" /> Reply to Review
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
