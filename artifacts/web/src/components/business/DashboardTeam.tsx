import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Users, UserPlus, UserMinus, Shield } from "lucide-react";
import {  
  useListBusinessTeam,
  useAddBusinessTeamMember,
  useRemoveBusinessTeamMember,
  getListBusinessTeamQueryKey,
  BusinessTeamMemberInputRole
, BusinessDetail, BusinessTeamMember } from "@workspace/api-client-react";

export function DashboardTeam({ business }: { business: BusinessDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<BusinessTeamMemberInputRole>("admin");
  
  const { data: team, isLoading } = useListBusinessTeam(business.handle, {
    query: { enabled: !!business.handle, queryKey: getListBusinessTeamQueryKey(business.handle) }
  });

  const addMember = useAddBusinessTeamMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Team member added" });
        setIsAdding(false);
        setNewUserId("");
        queryClient.invalidateQueries({ queryKey: getListBusinessTeamQueryKey(business.handle) });
      },
      onError: (err: unknown) => toast({ title: "Failed to add", description: getErrorMessage(err), variant: "destructive" })
    }
  });

  const removeMember = useRemoveBusinessTeamMember({
    mutation: {
      onSuccess: () => {
        toast({ title: "Team member removed" });
        queryClient.invalidateQueries({ queryKey: getListBusinessTeamQueryKey(business.handle) });
      }
    }
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId) return;
    addMember.mutate({ handle: business.handle, data: { userId: Number(newUserId), role: newRole } });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2"><Users className="w-5 h-5 text-[#D6B56D]" /> Team Management</h3>
        <Button onClick={() => setIsAdding(!isAdding)} variant="outline" className="rounded-full border-white/20 text-white">
          {isAdding ? "Cancel" : <><UserPlus className="w-4 h-4 mr-2" /> Add Member</>}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="bg-card/50 border border-[#D6B56D]/50 rounded-2xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">User ID</label>
              <Input type="number" required value={newUserId} onChange={e => setNewUserId(e.target.value)} className="bg-background border-white/10" placeholder="e.g. 123" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Role</label>
              <select 
                value={newRole} 
                onChange={e => setNewRole(e.target.value as BusinessTeamMemberInputRole)} 
                className="w-full h-10 px-3 py-2 bg-background border border-white/10 rounded-md text-sm text-white/80 focus:outline-none focus:ring-2 focus:ring-[#D6B56D]"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="moderator">Moderator</option>
                <option value="advertiser">Advertiser</option>
                <option value="analyst">Analyst</option>
                <option value="support_agent">Support Agent</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={addMember.isPending} className="bg-[#D6B56D] hover:bg-[#C9A456] text-[#111] rounded-full px-6">
              {addMember.isPending ? "Adding..." : "Add to Team"}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-white/50">Loading team...</div>
      ) : !team || team.length === 0 ? (
        <div className="text-center py-12 bg-card/30 border border-white/5 rounded-2xl">
          <p className="text-white/50">No team members found.</p>
        </div>
      ) : (
        <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-background/50 text-white/50 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Member</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {team.map((member: BusinessTeamMember) => (
                <tr key={member.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-background border border-white/10 overflow-hidden shrink-0">
                        {member.userPhotoUrl ? <img src={member.userPhotoUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Users className="w-4 h-4 text-white/20"/></div>}
                      </div>
                      <div>
                        <p className="font-medium text-white">{member.userName || `User #${member.userId}`}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      member.role === 'owner' ? 'bg-[#D6B56D]/20 text-[#D6B56D]' : 'bg-white/10 text-white/70'
                    }`}>
                      {member.role === 'owner' && <Shield className="w-3 h-3" />}
                      {member.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {member.role !== 'owner' && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => removeMember.mutate({ handle: business.handle, userId: member.userId })}
                        className="text-white/40 hover:text-destructive hover:bg-destructive/10"
                      >
                        <UserMinus className="w-4 h-4 mr-2" /> Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
