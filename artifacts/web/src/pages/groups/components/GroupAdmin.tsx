import { useState } from "react";

import { useListGroupInvites, useInviteToGroup, useCancelGroupInvite, getListGroupInvitesQueryKey } from "@workspace/api-client-react";

function GroupAdminInvites({ groupId }: { groupId: number }) {
  const { data: invites, isLoading } = useListGroupInvites(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteUserIdStr, setInviteUserIdStr] = useState("");

  const inviteToGroup = useInviteToGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation sent" });
        queryClient.invalidateQueries({ queryKey: getListGroupInvitesQueryKey(groupId) });
        setInviteUserIdStr("");
      },
      onError: () => toast({ title: "Failed to send invitation", variant: "destructive" })
    }
  });

  const cancelInvite = useCancelGroupInvite({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation canceled" });
        queryClient.invalidateQueries({ queryKey: getListGroupInvitesQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to cancel invitation", variant: "destructive" })
    }
  });

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-serif text-white mb-4">Invitations</h3>
      <div className="flex gap-2 max-w-sm">
        <Input 
          value={inviteUserIdStr} 
          onChange={e => setInviteUserIdStr(e.target.value)} 
          placeholder="User ID to invite" 
          className="bg-background/50 border-white/10" 
          type="number" 
        />
        <Button 
          onClick={() => {
            const id = parseInt(inviteUserIdStr);
            if (!isNaN(id)) {
              inviteToGroup.mutate({ groupId, data: { invitedUserId: id } });
            }
          }}
          disabled={!inviteUserIdStr || inviteToGroup.isPending}
        >
          Send Invite
        </Button>
      </div>

      <div className="pt-4 border-t border-white/10">
        <h4 className="font-bold text-white mb-4">Pending Invites</h4>
        {isLoading ? (
          <div className="animate-pulse h-24 bg-background/50 rounded-xl" />
        ) : !invites || invites.filter(i => i.status === 'pending').length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending invitations.</p>
        ) : (
          <div className="space-y-2">
            {invites.filter(i => i.status === 'pending').map(invite => (
              <div key={invite.id} className="flex items-center justify-between bg-background/30 border border-white/5 p-3 rounded-xl">
                <div>
                  <span className="font-bold text-white text-sm">User ID: {invite.invitedUserId}</span>
                  <span className="text-xs text-muted-foreground ml-2">Invited on {new Date(invite.createdAt).toLocaleDateString()}</span>
                </div>
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => cancelInvite.mutate({ groupId, inviteId: invite.id })}>
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useLocation } from "wouter";
import { 
  useListGroupJoinRequests, 
  useReviewGroupJoinRequest, 
  useListGroupReports, 
  useReviewGroupReport, 
  useUpdateGroup, 
  useListGroupQuestions, 
  useSetGroupQuestions,
  useListGroupKeywordAlerts,
  useCreateGroupKeywordAlert,
  useDeleteGroupKeywordAlert,
  useGetGroupInsights,
  useListGroupActivityLog,
  getGetGroupQueryKey,
  getListGroupJoinRequestsQueryKey,
  getListGroupReportsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Users, Activity, BarChart3, Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function GroupAdminSettings({ groupId, group }: { groupId: number, group: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateGroup = useUpdateGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Group updated successfully" });
        queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to update group", variant: "destructive" })
    }
  });

  const { data: questions, isLoading: loadingQs } = useListGroupQuestions(groupId);
  const setQuestions = useSetGroupQuestions({
    mutation: {
      onSuccess: () => toast({ title: "Questions updated" }),
      onError: () => toast({ title: "Failed to update questions", variant: "destructive" })
    }
  });

  const { data: alerts, isLoading: loadingAlerts } = useListGroupKeywordAlerts(groupId);
  const createAlert = useCreateGroupKeywordAlert({
    mutation: {
      onSuccess: () => {
        toast({ title: "Alert created" });
        queryClient.invalidateQueries({ queryKey: ['useListGroupKeywordAlerts'] });
      },
      onError: () => toast({ title: "Failed to create alert", variant: "destructive" })
    }
  });
  const deleteAlert = useDeleteGroupKeywordAlert({
    mutation: {
      onSuccess: () => {
        toast({ title: "Alert deleted" });
        queryClient.invalidateQueries({ queryKey: ['useListGroupKeywordAlerts'] });
      },
      onError: () => toast({ title: "Failed to delete alert", variant: "destructive" })
    }
  });

  const [newKeyword, setNewKeyword] = useState("");
  const [newAction, setNewAction] = useState<"flag" | "auto_hide" | "auto_remove">("flag");

  return (
    <div className="space-y-8">
      <div className="space-y-4 max-w-md">
        <h3 className="text-xl font-serif text-white mb-4">Basic Info</h3>
        <div>
          <label className="text-sm font-medium text-white">Group Name</label>
          <Input defaultValue={group.name} id="group-name" className="bg-background/50 border-white/10 mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium text-white">Description</label>
          <Textarea defaultValue={group.description || ""} id="group-description" className="bg-background/50 border-white/10 mt-1" />
        </div>
        <Button 
          onClick={() => {
            const name = (document.getElementById('group-name') as HTMLInputElement).value;
            const description = (document.getElementById('group-description') as HTMLTextAreaElement).value;
            updateGroup.mutate({ groupId, data: { name, description } });
          }} 
          disabled={updateGroup.isPending}
          data-testid="admin-save-btn"
        >
          Save Changes
        </Button>
      </div>

      <div className="space-y-4 pt-6 border-t border-white/10 max-w-md">
        <h3 className="text-xl font-serif text-white mb-4">Membership Questions</h3>
        <p className="text-sm text-muted-foreground mb-4">Ask users questions when they request to join.</p>
        <Textarea 
          defaultValue={questions?.map(q => q.questionText).join('\n') || ""} 
          id="group-questions" 
          placeholder="What is your favorite hookah flavor?"
          className="bg-background/50 border-white/10 min-h-[100px]" 
        />
        <Button 
          onClick={() => {
            const qs = (document.getElementById('group-questions') as HTMLTextAreaElement).value;
            const qsList = qs.split('\n').map(q => q.trim()).filter(Boolean);
            setQuestions.mutate({ groupId, data: { questions: qsList.map(q => ({ questionText: q, isRequired: true })) } });
          }} 
          disabled={setQuestions.isPending || loadingQs}
          data-testid="admin-save-qs-btn"
        >
          Update Questions
        </Button>
      </div>

      <div className="space-y-4 pt-6 border-t border-white/10 max-w-lg">
        <h3 className="text-xl font-serif text-white mb-4">Keyword Alerts</h3>
        <p className="text-sm text-muted-foreground mb-4">Automatically flag, hide, or remove posts containing specific words.</p>
        
        <div className="flex gap-2 mb-4">
          <Input 
            value={newKeyword} 
            onChange={(e) => setNewKeyword(e.target.value)} 
            placeholder="Keyword" 
            className="bg-background/50 border-white/10" 
          />
          <Select value={newAction} onValueChange={(val: any) => setNewAction(val)}>
            <SelectTrigger className="w-[150px] bg-background/50 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-white/10">
              <SelectItem value="flag">Flag</SelectItem>
              <SelectItem value="auto_hide">Auto Hide</SelectItem>
              <SelectItem value="auto_remove">Auto Remove</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            onClick={() => {
              if (newKeyword.trim()) {
                createAlert.mutate({ groupId, data: { keyword: newKeyword.trim(), action: newAction } });
                setNewKeyword("");
              }
            }}
            disabled={createAlert.isPending}
            data-testid="admin-add-alert-btn"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {loadingAlerts ? <div className="animate-pulse h-10 bg-background/50 rounded-xl" /> : (
          <div className="space-y-2">
            {alerts?.map(alert => (
              <div key={alert.id} className="flex items-center justify-between bg-background/30 border border-white/5 p-3 rounded-xl">
                <div>
                  <span className="font-bold text-white text-sm">{alert.keyword}</span>
                  <span className="text-xs text-muted-foreground ml-2 capitalize">({alert.action.replace('_', ' ')})</span>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteAlert.mutate({ groupId, alertId: alert.id })} data-testid="admin-del-alert-btn">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupAdminRequests({ groupId }: { groupId: number }) {
  const { data: requests, isLoading } = useListGroupJoinRequests(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const review = useReviewGroupJoinRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request reviewed" });
        queryClient.invalidateQueries({ queryKey: getListGroupJoinRequestsQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to review request", variant: "destructive" })
    }
  });

  if (isLoading) return <div className="animate-pulse h-24 bg-card border border-white/5 rounded-2xl" />;
  if (!requests || requests.length === 0) return <p className="text-muted-foreground">No pending requests.</p>;

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-serif text-white mb-4">Pending Requests</h3>
      {requests.filter(r => r.status === 'pending').map(req => (
        <div key={req.id} className="flex items-center justify-between bg-background/50 border border-white/5 p-4 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 overflow-hidden shrink-0">
              {req.userPhotoUrl ? <img src={req.userPhotoUrl} className="w-full h-full object-cover" /> : <Users className="w-5 h-5 m-auto mt-2.5 text-primary" />}
            </div>
            <div>
              <p className="font-bold text-white text-sm">{req.userName}</p>
              <p className="text-xs text-muted-foreground">Requested to join</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => review.mutate({ groupId, requestId: req.id, data: { action: 'approve' } })} disabled={review.isPending} data-testid="admin-approve-btn">Approve</Button>
            <Button size="sm" variant="outline" onClick={() => review.mutate({ groupId, requestId: req.id, data: { action: 'decline' } })} disabled={review.isPending} data-testid="admin-decline-btn">Decline</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupAdminReports({ groupId }: { groupId: number }) {
  const { data: reports, isLoading } = useListGroupReports(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const review = useReviewGroupReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report reviewed" });
        queryClient.invalidateQueries({ queryKey: getListGroupReportsQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to review report", variant: "destructive" })
    }
  });

  if (isLoading) return <div className="animate-pulse h-24 bg-card border border-white/5 rounded-2xl" />;
  if (!reports || reports.length === 0) return <p className="text-muted-foreground">No reported content.</p>;

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-serif text-white mb-4">Reported Content</h3>
      {reports.filter(r => r.status === 'pending').map(report => (
        <div key={report.id} className="bg-background/50 border border-white/5 p-4 rounded-xl">
          <p className="text-sm font-bold text-white mb-1">Reason: {report.reason}</p>
          <p className="text-xs text-muted-foreground mb-3">Target ID: {report.targetId} ({report.targetType})</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => review.mutate({ groupId, reportId: report.id, data: { action: 'action' } })} disabled={review.isPending} data-testid="admin-action-btn">Mark Action Taken</Button>
            <Button size="sm" variant="outline" onClick={() => review.mutate({ groupId, reportId: report.id, data: { action: 'dismiss' } })} disabled={review.isPending} data-testid="admin-dismiss-btn">Dismiss</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupAdminInsights({ groupId }: { groupId: number }) {
  const { data: insights, isLoading: loadingInsights } = useGetGroupInsights(groupId);
  const { data: activity, isLoading: loadingActivity } = useListGroupActivityLog(groupId, { limit: 10 });

  if (loadingInsights || loadingActivity) return <div className="animate-pulse h-32 bg-card border border-white/5 rounded-2xl" />;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-serif text-white mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /> Group Insights</h3>
        {insights ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-background/50 border border-white/5 p-4 rounded-xl text-center">
              <p className="text-sm text-muted-foreground">Total Members</p>
              <p className="text-2xl font-bold text-white mt-1">{insights.memberCount}</p>
            </div>
            <div className="bg-background/50 border border-white/5 p-4 rounded-xl text-center">
              <p className="text-sm text-muted-foreground">New Members (30d)</p>
              <p className="text-2xl font-bold text-white mt-1">{insights.newMembersLast30Days || 0}</p>
            </div>
            <div className="bg-background/50 border border-white/5 p-4 rounded-xl text-center">
              <p className="text-sm text-muted-foreground">Posts (30d)</p>
              <p className="text-2xl font-bold text-white mt-1">{insights.postsLast30Days}</p>
            </div>
            <div className="bg-background/50 border border-white/5 p-4 rounded-xl text-center">
              <p className="text-sm text-muted-foreground">New Members (7d)</p>
              <p className="text-2xl font-bold text-white mt-1">{insights.newMembersLast7Days || 0}</p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">No insights available.</p>
        )}
      </div>

      <div className="pt-6 border-t border-white/10">
        <h3 className="text-xl font-serif text-white mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Activity Log</h3>
        {!activity || activity.length === 0 ? (
          <p className="text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((log: any) => (
              <div key={log.id} className="bg-background/30 border border-white/5 p-3 rounded-xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-white"><span className="font-bold">{log.actorName}</span> {log.actionType} {log.targetType} #{log.targetId}</p>
                  <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupAdmin({ groupId, group, currentTab }: { groupId: number, group: any, currentTab: string }) {
  const adminTab = currentTab === "admin" ? "settings" : currentTab;
  const [_, setLocation] = useLocation();

  const handleTabChange = (tab: string) => {
    setLocation(`/groups/${groupId}/${tab}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex overflow-x-auto hide-scrollbar gap-2 bg-card/40 border border-white/5 p-2 rounded-2xl backdrop-blur-sm">
        {["settings", "member-requests", "invitations", "reported-content", "insights"].map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${
              adminTab === tab
                ? "bg-white/10 text-white shadow-md"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
            data-testid={`admin-tab-${tab}`}
          >
            {tab.replace("-", " ")}
          </button>
        ))}
      </div>

      <div className="bg-card border border-white/10 rounded-2xl p-6">
        {adminTab === "settings" && <GroupAdminSettings groupId={groupId} group={group} />}
        {adminTab === "member-requests" && <GroupAdminRequests groupId={groupId} />}
        {adminTab === "invitations" && <GroupAdminInvites groupId={groupId} />}
        {adminTab === "reported-content" && <GroupAdminReports groupId={groupId} />}
        {adminTab === "insights" && <GroupAdminInsights groupId={groupId} />}
      </div>
    </div>
  );
}
