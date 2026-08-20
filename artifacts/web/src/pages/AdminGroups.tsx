import { useState } from "react";
import { 
  useAdminListGroups,
  useAdminUpdateGroupStatus,
  getAdminListGroupsQueryKey,
  useAdminGetGroup,
  useAdminListGroupPosts,
  useAdminListGroupReports,
  useAdminModerateGroupPost,
  useAdminTransferGroupOwner,
  getAdminGetGroupQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Search, AlertTriangle, CheckCircle, ShieldCheck, ChevronLeft, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";

export default function AdminGroups() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [status, setStatus] = useState<string>("all");
  const [privacy, setPrivacy] = useState<string>("all");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  const { data: groupList, isLoading } = useAdminListGroups({
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    privacy: privacy !== "all" ? (privacy as any) : undefined,
    limit: 50,
  });

  const updateStatus = useAdminUpdateGroupStatus({
    mutation: {
      onSuccess: () => {
        toast({ title: "Group status updated" });
        queryClient.invalidateQueries({ queryKey: getAdminListGroupsQueryKey() });
        if (selectedGroupId) queryClient.invalidateQueries({ queryKey: getAdminGetGroupQueryKey(selectedGroupId) });
      },
      onError: () => toast({ title: "Failed to update group status", variant: "destructive" })
    }
  });

  if (selectedGroupId) {
    return <AdminGroupDetail groupId={selectedGroupId} onBack={() => setSelectedGroupId(null)} updateStatus={updateStatus} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search groups..."
            className="pl-9 bg-background/50 border-white/10"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px] bg-background/50 border-white/10">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-card border-white/10">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="hidden">Hidden</SelectItem>
          </SelectContent>
        </Select>
        <Select value={privacy} onValueChange={setPrivacy}>
          <SelectTrigger className="w-[150px] bg-background/50 border-white/10">
            <SelectValue placeholder="Privacy" />
          </SelectTrigger>
          <SelectContent className="bg-card border-white/10">
            <SelectItem value="all">All Privacy</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse bg-card/50 border border-white/10 rounded-xl" />
          ))}
        </div>
      ) : !groupList || groupList.groups.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <Users className="w-12 h-12 mx-auto text-white/20 mb-4" />
          <p className="text-muted-foreground">No groups found.</p>
        </div>
      ) : (
        <div className="bg-card/50 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-white/10 bg-black/20">
                  <th className="py-3 px-4 font-medium">Group</th>
                  <th className="py-3 px-4 font-medium">Privacy</th>
                  <th className="py-3 px-4 font-medium">Members</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupList.groups.map(group => (
                  <tr key={group.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setSelectedGroupId(group.id)}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded bg-[#171A21] flex items-center justify-center shrink-0 border border-white/10 overflow-hidden">
                          {group.iconUrl ? <img src={group.iconUrl} className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/30" />}
                        </div>
                        <div>
                          <span className="font-bold text-white group-hover:text-primary transition-colors">
                            {group.name}
                          </span>
                          {group.handle && <p className="text-xs text-muted-foreground">g/{group.handle}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-white/70 capitalize">{group.privacy}</td>
                    <td className="py-3 px-4 text-white/70">{group.memberCount}</td>
                    <td className="py-3 px-4">
                      {group.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                          <CheckCircle className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-destructive bg-destructive/10 px-2 py-1 rounded-md">
                          <AlertTriangle className="w-3 h-3" /> {group.status}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedGroupId(group.id); }}>Manage</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminGroupDetail({ groupId, onBack, updateStatus }: { groupId: number, onBack: () => void, updateStatus: any }) {
  const { data: group, isLoading } = useAdminGetGroup(groupId);
  const { data: reports } = useAdminListGroupReports(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const transferOwner = useAdminTransferGroupOwner({
    mutation: {
      onSuccess: () => {
        toast({ title: "Ownership transferred successfully" });
        queryClient.invalidateQueries({ queryKey: getAdminGetGroupQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to transfer ownership", variant: "destructive" })
    }
  });

  const moderatePost = useAdminModerateGroupPost({
    mutation: {
      onSuccess: () => {
        toast({ title: "Post moderated" });
        queryClient.invalidateQueries({ queryKey: getAdminGetGroupQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to moderate post", variant: "destructive" })
    }
  });

  if (isLoading) return <div className="animate-pulse h-64 bg-card/50 rounded-2xl" />;
  if (!group) return <div>Group not found</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack} className="mb-4 text-muted-foreground hover:text-white"><ChevronLeft className="w-4 h-4 mr-2" /> Back to Groups</Button>
      
      <div className="bg-card border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-background border border-white/10 overflow-hidden flex items-center justify-center">
              {group.iconUrl ? <img src={group.iconUrl} className="w-full h-full object-cover" /> : <Users className="w-8 h-8 text-white/30" />}
            </div>
            <div>
              <h2 className="text-2xl font-serif text-white">{group.name}</h2>
              <p className="text-muted-foreground">ID: {group.id} • {group.memberCount} members • Status: {group.status}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {group.status === 'active' ? (
              <>
                <Button variant="outline" className="border-orange-500/50 text-orange-500 hover:bg-orange-500 hover:text-white" onClick={() => updateStatus.mutate({ groupId, data: { action: 'hide' } })}>Hide</Button>
                <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive hover:text-white" onClick={() => updateStatus.mutate({ groupId, data: { action: 'suspend' } })}>Suspend</Button>
              </>
            ) : (
              <Button className="bg-green-500 hover:bg-green-600 text-white" onClick={() => updateStatus.mutate({ groupId, data: { action: 'restore' } })}>Restore</Button>
            )}
            <Button variant="destructive" onClick={() => updateStatus.mutate({ groupId, data: { action: 'delete' } })}>Delete</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <h4 className="font-bold text-white mb-2">Group Details</h4>
            <div className="space-y-1 text-sm text-white/70">
              <p>Description: {group.description || "N/A"}</p>
              <p>Privacy: {group.privacy}</p>
              <p>Visibility: {group.visibility}</p>
            </div>
          </div>
        </div>



        <div className="pt-6 border-t border-white/10 mb-8">
          <h4 className="font-bold text-white mb-4">Transfer Ownership</h4>
          <div className="flex gap-2 max-w-sm">
            <Input id="new-owner-id" placeholder="New Owner User ID" type="number" className="bg-background/50 border-white/10" />
            <Button onClick={() => {
              const val = (document.getElementById('new-owner-id') as HTMLInputElement).value;
              const newOwnerId = parseInt(val, 10);
              if (!isNaN(newOwnerId)) {
                transferOwner.mutate({ groupId, data: { newOwnerUserId: newOwnerId } });
              }
            }}>Transfer</Button>
          </div>
        </div>

        <div className="pt-6 border-t border-white/10">
          <h4 className="font-bold text-white mb-4 flex items-center gap-2"><Flag className="w-4 h-4 text-destructive" /> Reported Content</h4>
          {!reports || reports.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reported content in this group.</p>
          ) : (
            <div className="space-y-4">
              {reports.map(report => (
                <div key={report.id} className="bg-background/50 border border-white/5 p-4 rounded-xl">
                  <p className="text-sm font-bold text-white mb-1">Reason: {report.reason}</p>
                  <p className="text-xs text-muted-foreground mb-3">Target: {report.targetType} #{report.targetId}</p>
                  <Button size="sm" variant="outline" onClick={() => moderatePost.mutate({ groupId, postId: report.targetId, data: { action: 'remove' } })}>Delete Post</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
