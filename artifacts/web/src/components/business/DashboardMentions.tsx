import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {  
  useListBusinessMentions, 
  useReviewBusinessMention, 
  getListBusinessMentionsQueryKey,
  ListBusinessMentionsStatus 
, BusinessDetail, BusinessMentionItem } from "@workspace/api-client-react";
import { CheckCircle, XCircle, AtSign } from "lucide-react";

export function DashboardMentions({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<ListBusinessMentionsStatus>("pending");

  const { data: mentionsResponse, isLoading } = useListBusinessMentions(business.handle, { status: statusFilter }, {
    query: { enabled: !!business.handle, queryKey: getListBusinessMentionsQueryKey(business.handle, { status: statusFilter }) }
  });

  const mentions = mentionsResponse ?? [];

  const reviewMention = useReviewBusinessMention({
    mutation: {
      onSuccess: () => {
        toast({ title: "Mention updated" });
        queryClient.invalidateQueries({ queryKey: getListBusinessMentionsQueryKey(business.handle, { status: statusFilter }) });
      }
    }
  });

  const handleReview = (mentionId: number, action: 'approve' | 'reject') => {
    reviewMention.mutate({ handle: business.handle, mentionId, data: { action } });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <AtSign className="w-5 h-5 text-[#D6B56D]" /> Mentions
        </h3>
        <Select value={statusFilter} onValueChange={(v: ListBusinessMentionsStatus) => setStatusFilter(v)}>
          <SelectTrigger className="w-[140px] bg-background border-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading mentions...</div>
      ) : mentions.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No {statusFilter} mentions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mentions.map((mention: BusinessMentionItem) => (
            <div key={mention.id} className="bg-card border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-white text-sm">User #{mention.authorUserId}</p>
                  <p className="text-xs text-white/50">Source: {mention.sourceType} #{mention.sourceId}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  mention.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                  mention.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {mention.status}
                </span>
              </div>
              
              {mention.status === 'pending' && (
                <div className="flex gap-2 mt-auto pt-4 border-t border-white/5">
                  <Button size="sm" onClick={() => handleReview(mention.id, 'approve')} className="flex-1 bg-green-500 hover:bg-green-600 text-white" disabled={reviewMention.isPending}>
                    <CheckCircle className="w-4 h-4 mr-2" /> Approve
                  </Button>
                  <Button size="sm" onClick={() => handleReview(mention.id, 'reject')} variant="destructive" className="flex-1" disabled={reviewMention.isPending}>
                    <XCircle className="w-4 h-4 mr-2" /> Reject
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