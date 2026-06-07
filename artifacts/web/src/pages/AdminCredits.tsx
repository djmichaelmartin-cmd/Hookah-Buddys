import { useMemo, useState } from "react";
import {
  useListAdminCreditPackages,
  useUpdateCreditPackage,
  useListAdminCreditTransactions,
  useCreateCreditAdjustment,
  getListAdminCreditPackagesQueryKey,
  getListAdminCreditTransactionsQueryKey,
  type CreditPackage,
  type ListAdminCreditTransactionsParams,
  type ListAdminCreditTransactionsType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, ReceiptText, UserCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

const TYPE_META: Record<string, { label: string; className: string }> = {
  purchase: { label: "Purchase", className: "bg-green-600/20 text-green-300 border-green-600/40" },
  spend: { label: "Spend", className: "bg-secondary/20 text-secondary border-secondary/40" },
  adjustment: { label: "Adjustment", className: "bg-primary/20 text-primary border-primary/40" },
};

function PackageRow({ pkg }: { pkg: CreditPackage }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(pkg.name);
  const [priceCents, setPriceCents] = useState(String(pkg.priceCents));
  const [credits, setCredits] = useState(String(pkg.credits));
  const [label, setLabel] = useState(pkg.label ?? "");

  const update = useUpdateCreditPackage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Package updated", description: `${name} saved.` });
        queryClient.invalidateQueries({ queryKey: getListAdminCreditPackagesQueryKey() });
      },
      onError: () => toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
    },
  });

  const save = () => {
    update.mutate({
      id: pkg.id,
      data: {
        name,
        priceCents: Number(priceCents),
        credits: Number(credits),
        label: label.trim() === "" ? null : label.trim(),
      },
    });
  };

  const toggleActive = (active: boolean) => {
    update.mutate({ id: pkg.id, data: { active } });
  };

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">/{pkg.slug}</span>
          {!pkg.active && <Badge variant="outline" className="border-white/10 text-muted-foreground">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`active-${pkg.id}`} className="text-xs text-muted-foreground">Active</Label>
          <Switch id={`active-${pkg.id}`} checked={pkg.active} onCheckedChange={toggleActive} disabled={update.isPending} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Price (cents)</Label>
          <Input type="number" value={priceCents} onChange={(e) => setPriceCents(e.target.value)} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Credits</Label>
          <Input type="number" value={credits} onChange={(e) => setCredits(e.target.value)} className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Badge label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="(none)" className="bg-background border-white/10" />
        </div>
      </div>
      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-muted-foreground">
          ${(Number(priceCents) / 100 || 0).toFixed(2)} for {Number(credits) || 0} credits
        </p>
        <Button size="sm" onClick={save} disabled={update.isPending} className="bg-primary text-primary-foreground">
          {update.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function AdjustmentForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const create = useCreateCreditAdjustment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Adjustment applied", description: `${amount} credits to member #${userId}.` });
        queryClient.invalidateQueries({ queryKey: getListAdminCreditTransactionsQueryKey() });
        setUserId("");
        setAmount("");
        setNote("");
      },
      onError: () => toast({ title: "Adjustment failed", description: "Check the member ID and try again.", variant: "destructive" }),
    },
  });

  const submit = () => {
    const uid = Number(userId);
    const amt = Number(amount);
    if (!uid || !amt) {
      toast({ title: "Missing values", description: "Enter a member ID and a non-zero amount.", variant: "destructive" });
      return;
    }
    create.mutate({ data: { userId: uid, amount: amt, note: note.trim() || undefined } });
  };

  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-5">
      <h3 className="text-lg font-serif text-white flex items-center gap-2 mb-1">
        <UserCog className="w-5 h-5 text-primary" /> Manual Credit Adjustment
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Grant or remove credits for a member. Use a negative amount to deduct.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <Label className="text-xs text-muted-foreground">Member user ID</Label>
          <Input type="number" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. 12" className="bg-background border-white/10" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Amount (credits)</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100 or -50" className="bg-background border-white/10" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs text-muted-foreground">Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for adjustment" className="bg-background border-white/10" />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={submit} disabled={create.isPending} className="bg-primary text-primary-foreground">
          {create.isPending ? "Applying..." : "Apply adjustment"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminCredits() {
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [page, setPage] = useState(0);

  const { data: packages } = useListAdminCreditPackages();

  const txParams: ListAdminCreditTransactionsParams = useMemo(
    () => ({
      type: (typeFilter || undefined) as ListAdminCreditTransactionsType | undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [typeFilter, page],
  );

  const { data: txPage } = useListAdminCreditTransactions(txParams);

  const sortedPackages = [...(packages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = txPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Tabs defaultValue="packages" className="w-full">
      <TabsList className="bg-card border border-white/10 mb-6">
        <TabsTrigger value="packages"><Package className="w-4 h-4 mr-2" /> Packages</TabsTrigger>
        <TabsTrigger value="adjustments"><UserCog className="w-4 h-4 mr-2" /> Adjustments</TabsTrigger>
        <TabsTrigger value="transactions"><ReceiptText className="w-4 h-4 mr-2" /> Transactions</TabsTrigger>
      </TabsList>

      <TabsContent value="packages" className="space-y-4">
        <h2 className="text-xl font-serif text-white">Credit Packages</h2>
        <p className="text-sm text-muted-foreground">Edit pricing, credit amounts, and availability. Changes apply to the public Buy Credits page immediately.</p>
        {sortedPackages.map((pkg) => <PackageRow key={pkg.id} pkg={pkg} />)}
        {sortedPackages.length === 0 && <p className="text-muted-foreground">No credit packages found.</p>}
      </TabsContent>

      <TabsContent value="adjustments" className="space-y-4">
        <AdjustmentForm />
      </TabsContent>

      <TabsContent value="transactions" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif text-white">Recent Transactions</h2>
          <Select value={typeFilter || "all"} onValueChange={(v) => { setTypeFilter(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-44 bg-background border-white/10"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="purchase">Purchases</SelectItem>
              <SelectItem value="spend">Spend</SelectItem>
              <SelectItem value="adjustment">Adjustments</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border border-white/10 rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead>Member</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txPage?.items.map((tx) => (
                <TableRow key={tx.id} className="border-white/10">
                  <TableCell>
                    <p className="text-sm text-white">{tx.userName || `User #${tx.userId}`}</p>
                    {tx.userEmail && <p className="text-xs text-muted-foreground">{tx.userEmail}</p>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">{tx.description || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TYPE_META[tx.type]?.className}>
                      {TYPE_META[tx.type]?.label ?? tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${tx.amount >= 0 ? "text-green-400" : "text-secondary"}`}>
                    {tx.amount >= 0 ? "+" : ""}{tx.amount}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {tx.amountCents != null && tx.amountCents > 0 ? `$${(tx.amountCents / 100).toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(!txPage || txPage.items.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No transactions yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border-white/10">Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="border-white/10">Next</Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
