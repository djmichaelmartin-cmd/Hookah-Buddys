import { useState, FormEvent } from "react";
import { getErrorMessage } from "@/lib/error";
import {  
  useToggleBusinessChildLike, 
  useToggleBusinessChildSave, 
  useListBusinessChildComments, 
  useCreateBusinessChildComment, 
  useDeleteBusinessChildComment, 
  useReportBusinessChild,
  getListBusinessChildCommentsQueryKey,
  useGetCurrentUser,
  ReportBusinessChildBody
, BusinessChildCommentItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Heart, Bookmark, Flag, XCircle, User as UserIcon, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

type EntityType = 'media' | 'event' | 'product' | 'offer' | 'checkin';

interface ChildInteractionsProps {
  businessHandle: string;
  entityType: EntityType;
  entityId: number;
  entityName?: string;
  initialLikes?: number;
  initialComments?: number;
  isLikedByViewer?: boolean;
  isSavedByViewer?: boolean;
  onRequireAuth: (cb: () => void) => void;
  onInvalidate?: () => void;
}

export function ChildInteractions({
  businessHandle,
  entityType,
  entityId,
  entityName,
  initialLikes = 0,
  initialComments = 0,
  isLikedByViewer = false,
  isSavedByViewer = false,
  onRequireAuth,
  onInvalidate
}: ChildInteractionsProps) {
  const [showComments, setShowComments] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleLike = useToggleBusinessChildLike({
    mutation: {
      onSuccess: () => {
        if (onInvalidate) onInvalidate();
      }
    }
  });

  const toggleSave = useToggleBusinessChildSave({
    mutation: {
      onSuccess: () => {
        if (onInvalidate) onInvalidate();
        toast({ title: "Saved successfully" });
      }
    }
  });

  const handleLike = () => onRequireAuth(() => {
    toggleLike.mutate({ handle: businessHandle, entityType, entityId });
  });

  const handleSave = () => onRequireAuth(() => {
    toggleSave.mutate({ handle: businessHandle, entityType, entityId });
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-white/70 py-3 border-t border-white/10 mt-4">
        <div className="flex items-center gap-4">
          <button onClick={handleLike} className={`flex items-center gap-1.5 transition-colors ${isLikedByViewer ? 'text-red-500' : 'hover:text-red-400'}`} disabled={toggleLike.isPending}>
            <Heart className={`w-4 h-4 ${isLikedByViewer ? 'fill-current' : ''}`} /> {initialLikes}
          </button>
          
          <button onClick={() => setShowComments(!showComments)} className="flex items-center gap-1.5 hover:text-white transition-colors">
            <MessageSquare className="w-4 h-4" /> {initialComments}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => setReportOpen(true)} className="flex items-center gap-1.5 hover:text-red-400 transition-colors">
            <Flag className="w-4 h-4" />
          </button>

          <button onClick={handleSave} className={`flex items-center gap-1.5 transition-colors ${isSavedByViewer ? 'text-[#D6B56D]' : 'hover:text-[#D6B56D]'}`} disabled={toggleSave.isPending}>
            <Bookmark className={`w-4 h-4 ${isSavedByViewer ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {showComments && (
        <ChildComments 
          businessHandle={businessHandle} 
          entityType={entityType} 
          entityId={entityId} 
          onRequireAuth={onRequireAuth} 
          onCommentAdded={onInvalidate} 
        />
      )}

      {reportOpen && (
        <ReportDialog 
          businessHandle={businessHandle} 
          entityType={entityType} 
          entityId={entityId} 
          entityName={entityName || `${entityType} #${entityId}`}
          isOpen={reportOpen} 
          setIsOpen={setReportOpen} 
        />
      )}
    </div>
  );
}

function ChildComments({ 
  businessHandle, 
  entityType, 
  entityId, 
  onRequireAuth,
  onCommentAdded
}: { 
  businessHandle: string, 
  entityType: EntityType, 
  entityId: number, 
  onRequireAuth: (cb: () => void) => void,
  onCommentAdded?: () => void
}) {
  const { data: session } = useGetCurrentUser();
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  
  const { data: commentsResponse, isLoading } = useListBusinessChildComments(businessHandle, entityType, entityId, {
    query: { queryKey: getListBusinessChildCommentsQueryKey(businessHandle, entityType, entityId) }
  });

  const comments = commentsResponse ?? [];

  const createComment = useCreateBusinessChildComment({
    mutation: {
      onSuccess: () => {
        setText("");
        queryClient.invalidateQueries({ queryKey: getListBusinessChildCommentsQueryKey(businessHandle, entityType, entityId) });
        if (onCommentAdded) onCommentAdded();
      }
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onRequireAuth(() => {
      if (!text.trim()) return;
      createComment.mutate({ handle: businessHandle, entityType, entityId, data: { text } });
    });
  };

  return (
    <div className="mt-2 pt-4 border-t border-white/10 space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input 
          value={text} 
          onChange={e => setText(e.target.value)} 
          placeholder="Write a comment..." 
          className="h-9 bg-background/50 border-white/10 text-sm"
        />
        <Button size="sm" type="submit" disabled={!text.trim() || createComment.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] h-9 w-9 p-0 flex items-center justify-center shrink-0">
          <Send className="w-4 h-4" />
        </Button>
      </form>
      
      {isLoading ? (
        <p className="text-xs text-white/40 text-center">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-white/40 text-center">No comments yet.</p>
      ) : (
        <div className="space-y-3 mt-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
          {comments.map((comment: BusinessChildCommentItem) => (
            <div key={comment.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-background overflow-hidden shrink-0 border border-white/10 flex items-center justify-center text-xs text-white/40">
                {comment.userPhotoUrl ? <img src={comment.userPhotoUrl} className="w-full h-full object-cover" /> : <UserIcon className="w-4 h-4"/>}
              </div>
              <div className="flex-1 bg-background/50 rounded-xl p-3 border border-white/5">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-bold text-white text-xs">{comment.userName || `User #${comment.userId}`}</p>
                  {session?.user?.id === comment.userId && (
                    <DeleteCommentButton businessHandle={businessHandle} entityType={entityType} entityId={entityId} commentId={comment.id} onDeleted={() => {
                      if (onCommentAdded) onCommentAdded();
                    }} />
                  )}
                </div>
                <p className="text-sm text-white/80">{comment.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteCommentButton({ businessHandle, entityType, entityId, commentId, onDeleted }: { businessHandle: string, entityType: EntityType, entityId: number, commentId: number, onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const del = useDeleteBusinessChildComment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessChildCommentsQueryKey(businessHandle, entityType, entityId) });
        if (onDeleted) onDeleted();
      }
    }
  });

  return (
    <button onClick={() => del.mutate({ handle: businessHandle, entityType, entityId, commentId })} className="text-white/30 hover:text-red-400">
      <XCircle className="w-3 h-3" />
    </button>
  );
}

function ReportDialog({ businessHandle, entityType, entityId, entityName, isOpen, setIsOpen }: { businessHandle: string, entityType: EntityType, entityId: number, entityName: string, isOpen: boolean, setIsOpen: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const { toast } = useToast();
  
  const report = useReportBusinessChild({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report submitted", description: "Thank you for your report." });
        setIsOpen(false);
      }
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    
    report.mutate({ 
      handle: businessHandle, 
      entityType, 
      entityId, 
      data: { reason, details } as ReportBusinessChildBody 
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="bg-card border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report {entityName}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm text-white/80">Reason</label>
            <select 
              value={reason} 
              onChange={e => setReason(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-md h-10 px-3 text-sm"
              required
            >
              <option value="">Select a reason</option>
              <option value="spam">Spam or misleading</option>
              <option value="inappropriate">Inappropriate content</option>
              <option value="harassment">Harassment or bullying</option>
              <option value="other">Other</option>
            </select>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm text-white/80">Details (Optional)</label>
            <Textarea 
              value={details} 
              onChange={e => setDetails(e.target.value)} 
              placeholder="Provide more context..."
              className="bg-background border-white/10"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!reason || report.isPending} className="bg-red-500 hover:bg-red-600 text-white">
              {report.isPending ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}