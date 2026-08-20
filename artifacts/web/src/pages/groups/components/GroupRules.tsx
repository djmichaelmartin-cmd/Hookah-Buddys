import { useState } from "react";
import { 
  useListGroupRules, 
  useCreateGroupRule,
  useUpdateGroupRule,
  useDeleteGroupRule,
  getListGroupRulesQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Edit2, Check, X, Plus } from "lucide-react";

export function GroupRules({ groupId, isAdmin }: { groupId: number, isAdmin: boolean }) {
  const { data: rules, isLoading } = useListGroupRules(groupId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const createRule = useCreateGroupRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule added" });
        queryClient.invalidateQueries({ queryKey: getListGroupRulesQueryKey(groupId) });
        setIsAdding(false);
        setNewTitle("");
        setNewDesc("");
      },
      onError: () => toast({ title: "Failed to add rule", variant: "destructive" })
    }
  });

  const updateRule = useUpdateGroupRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule updated" });
        queryClient.invalidateQueries({ queryKey: getListGroupRulesQueryKey(groupId) });
        setEditingId(null);
      },
      onError: () => toast({ title: "Failed to update rule", variant: "destructive" })
    }
  });

  const deleteRule = useDeleteGroupRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule deleted" });
        queryClient.invalidateQueries({ queryKey: getListGroupRulesQueryKey(groupId) });
      },
      onError: () => toast({ title: "Failed to delete rule", variant: "destructive" })
    }
  });

  if (isLoading) {
    return <div className="p-6 bg-card border border-white/10 rounded-2xl animate-pulse h-32" />;
  }

  return (
    <div className="bg-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-serif text-white">Group Rules</h3>
        {isAdmin && !isAdding && (
          <Button size="sm" onClick={() => setIsAdding(true)} data-testid="add-rule-btn">
            <Plus className="w-4 h-4 mr-2" /> Add Rule
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="bg-background/50 border border-white/5 p-4 rounded-xl mb-4 space-y-3">
          <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Rule Title" className="bg-card border-white/10" />
          <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" className="bg-card border-white/10" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createRule.mutate({ groupId, data: { title: newTitle, description: newDesc || undefined } })} disabled={!newTitle.trim() || createRule.isPending} data-testid="save-new-rule-btn">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {!rules || rules.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">No specific rules set for this group.</div>
      ) : (
        <div className="space-y-4">
          {rules.map((rule, idx) => (
            <div key={rule.id} className="flex gap-4 bg-background/30 p-4 rounded-xl border border-white/5">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1">
                {editingId === rule.id ? (
                  <div className="space-y-3">
                    <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="bg-card border-white/10" />
                    <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} className="bg-card border-white/10" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateRule.mutate({ groupId, ruleId: rule.id, data: { title: editTitle, description: editDesc || undefined } })} disabled={!editTitle.trim() || updateRule.isPending} data-testid="save-edit-rule-btn">Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <h4 className="font-bold text-white text-sm mb-1">{rule.title}</h4>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <button onClick={() => { setEditingId(rule.id); setEditTitle(rule.title); setEditDesc(rule.description || ""); }} className="text-muted-foreground hover:text-white p-1" data-testid="edit-rule-btn"><Edit2 className="w-3 h-3" /></button>
                          <button onClick={() => deleteRule.mutate({ groupId, ruleId: rule.id })} className="text-muted-foreground hover:text-destructive p-1" data-testid="delete-rule-btn"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                    {rule.description && <p className="text-sm text-white/70">{rule.description}</p>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
