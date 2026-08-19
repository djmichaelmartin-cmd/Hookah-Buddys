import { useState } from "react";
import { getErrorMessage } from "@/lib/error";
import {
  useListAdminPlans,
  useUpdateAdminPlan,
  getListAdminPlansQueryKey,
  type Plan,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function PlanRow({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [features, setFeatures] = useState<string[]>(plan.features ?? []);

  const update = useUpdateAdminPlan({
    mutation: {
      onSuccess: (updated) => {
        toast({ title: "Plan updated", description: `${updated.name} saved. Changes are live immediately.` });
        queryClient.invalidateQueries({ queryKey: getListAdminPlansQueryKey() });
      },
      onError: () =>
        toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
    },
  });

  const save = () => {
    if (name.trim() === "") {
      toast({ title: "Name required", description: "Plan name cannot be empty.", variant: "destructive" });
      return;
    }
    update.mutate({
      id: plan.id,
      data: {
        name: name.trim(),
        description,
        features: features.map((f) => f.trim()).filter((f) => f !== ""),
      },
    });
  };

  const setFeature = (i: number, value: string) =>
    setFeatures((prev) => prev.map((f, idx) => (idx === i ? value : f)));
  const removeFeature = (i: number) => setFeatures((prev) => prev.filter((_, idx) => idx !== i));
  const addFeature = () => setFeatures((prev) => [...prev, ""]);

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-white/10 text-muted-foreground capitalize">
            {plan.audience}
          </Badge>
          <Badge variant="outline" className="border-white/10 text-muted-foreground capitalize">
            {plan.tier}
          </Badge>
          {plan.highlighted && (
            <Badge variant="outline" className="bg-primary/20 text-primary border-primary/40">Highlighted</Badge>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}/${plan.interval || "month"}`}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="bg-background border-white/10"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Features</Label>
          <div className="space-y-2 mt-1">
            {features.map((feature, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={feature}
                  onChange={(e) => setFeature(i, e.target.value)}
                  className="bg-background border-white/10"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFeature(i)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="Remove feature"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addFeature} className="border-white/10">
              <Plus className="w-4 h-4 mr-1" /> Add feature
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <Button size="sm" onClick={save} disabled={update.isPending} className="bg-primary text-primary-foreground">
          {update.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminPlans() {
  const { data: plans, isLoading } = useListAdminPlans();

  const memberPlans = (plans ?? []).filter((p) => p.audience === "member");
  const dollPlans = (plans ?? []).filter((p) => p.audience === "doll");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-serif text-white">Pricing Plans</h2>
        <p className="text-sm text-muted-foreground">
          Edit plan names, descriptions, and feature lists. Changes appear on the public pricing pages
          immediately — no redeploy needed. Prices and credits stay code-managed.
        </p>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading plans…</p>}

      {memberPlans.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-serif text-white">Member Plans</h3>
          {memberPlans.map((plan) => <PlanRow key={plan.id} plan={plan} />)}
        </div>
      )}

      {dollPlans.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-serif text-white">Buddy Plans</h3>
          {dollPlans.map((plan) => <PlanRow key={plan.id} plan={plan} />)}
        </div>
      )}

      {!isLoading && (plans ?? []).length === 0 && <p className="text-muted-foreground">No plans found.</p>}
    </div>
  );
}
