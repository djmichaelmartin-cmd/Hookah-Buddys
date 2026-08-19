import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {  
  useListBusinessReports, 
  useReviewBusinessReport, 
  getListBusinessReportsQueryKey,
  ListBusinessReportsStatus,
  ReviewBusinessReportBodyAction
, BusinessContentReportItem } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Flag, CheckCircle, Trash2, ShieldAlert } from "lucide-react";

export function AdminReports() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [statusFilter, setStatusFilter] = useState<ListBusinessReportsStatus>("open");
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const queryParams = {
    status: statusFilter,
    entityType: entityFilter !== "all" ? entityFilter : undefined
  };

  const { data: reportsResponse, isLoading } = useListBusinessReports(queryParams, {
    query: { queryKey: getListBusinessReportsQueryKey(queryParams) }
  });

  const reports = reportsResponse ?? [];

  const [selectedReport, setSelectedReport] = useState<BusinessContentReportItem | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewBusinessReportBodyAction | null>(null);
  const [reviewReason, setReviewReason] = useState("");

  const reviewReport = useReviewBusinessReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report reviewed successfully" });
        queryClient.invalidateQueries({ queryKey: getListBusinessReportsQueryKey(queryParams) });
        setReviewAction(null);
        setSelectedReport(null);
        setReviewReason("");
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to review", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const handleReview = () => {
    if (!selectedReport || !reviewAction) return;
    reviewReport.mutate({
      reportId: selectedReport.id,
      data: {
        action: reviewAction,
        reason: reviewReason || undefined
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-white/10 rounded-2xl p-4 flex flex-wrap gap-4">
        <Select value={statusFilter} onValueChange={(v: ListBusinessReportsStatus) => setStatusFilter(v)}>
          <SelectTrigger className="bg-background border-white/10 w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="actioned">Actioned</SelectItem>
          </SelectContent>
        </Select>

        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="bg-background border-white/10 w-[140px]">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="post">Post</SelectItem>
            <SelectItem value="comment">Comment</SelectItem>
            <SelectItem value="media">Media</SelectItem>
            <SelectItem value="event">Event</SelectItem>
            <SelectItem value="product">Product</SelectItem>
            <SelectItem value="offer">Offer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-background/50 text-white/50 uppercase text-xs">
            <tr>
              <th className="px-6 py-4 font-medium">Report</th>
              <th className="px-6 py-4 font-medium">Target</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {reports.map((report: BusinessContentReportItem) => (
              <tr key={report.id} className="hover:bg-white/5 transition-colors">
                <td className="px-6 py-4">
                  <p className="font-bold text-white text-base capitalize">{report.reason}</p>
                  {report.details && <p className="text-white/60 text-sm line-clamp-2 max-w-xs">{report.details}</p>}
                  <p className="text-xs text-white/40 mt-1">By User #{report.reporterUserId}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-block px-2 py-1 bg-white/5 border border-white/10 rounded text-xs font-mono text-white/80">
                    {report.entityType} #{report.entityId}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    report.status === 'open' ? 'bg-yellow-500/20 text-yellow-400' :
                    report.status === 'dismissed' ? 'bg-white/10 text-white/50' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {report.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {report.status === 'open' && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="border-white/10 text-white" onClick={() => {
                        setSelectedReport(report);
                        setReviewAction('dismiss');
                        setReviewReason("");
                      }}>
                        Dismiss
                      </Button>
                      <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" onClick={() => {
                        setSelectedReport(report);
                        setReviewAction('action');
                        setReviewReason("");
                      }}>
                        Take Action
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && reports.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-white/50">
                  No {statusFilter} reports found.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-white/50">
                  Loading reports...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!reviewAction} onOpenChange={(open) => !open && setReviewAction(null)}>
        <DialogContent className="bg-card border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'dismiss' ? 'Dismiss Report' : 'Take Action on Target'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm text-white/80">Admin Note (Optional)</label>
              <Textarea 
                value={reviewReason} 
                onChange={e => setReviewReason(e.target.value)} 
                placeholder="Explain the decision..."
                className="bg-background border-white/10"
              />
            </div>
            
            {reviewAction === 'action' && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-3 text-red-400 mt-4">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <p className="text-sm">This will apply an automated moderation action to the target entity (e.g. hiding the post/comment). Please confirm.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewAction(null)} className="text-white">Cancel</Button>
            <Button 
              onClick={handleReview} 
              disabled={reviewReport.isPending}
              className={`${reviewAction === 'action' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-primary text-primary-foreground'}`}
            >
              {reviewReport.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}