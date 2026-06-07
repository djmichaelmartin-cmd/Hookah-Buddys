import { useMemo, useState } from "react";
import {
  useGetLeadsSummary,
  useListBusinessLeads,
  useListRejectedLeads,
  useGetCollectStatus,
  useStartCollect,
  getGetLeadsSummaryQueryKey,
  getListBusinessLeadsQueryKey,
  getGetCollectStatusQueryKey,
  type ListBusinessLeadsParams,
  type ListBusinessLeadsStatus,
  type CollectInputMarket,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  Download,
  Play,
  Loader2,
  Phone,
  Globe,
  MapPin,
  Star,
  Ban,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  confirmed: { label: "Confirmed", className: "bg-green-600/20 text-green-300 border-green-600/40" },
  likely: { label: "Likely", className: "bg-primary/20 text-primary border-primary/40" },
  needs_manual: { label: "Needs Manual", className: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  closed: { label: "Closed", className: "bg-destructive/20 text-destructive border-destructive/40" },
};

const REASON_LABELS: Record<string, string> = {
  duplicate_phone: "Duplicate (phone)",
  duplicate_name_address: "Duplicate (name+address)",
  out_of_scope: "Out of scope",
  non_hookah: "Not hookah-related",
};

function buildCsvHref(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return `/api/admin/leads/export.csv${s ? `?${s}` : ""}`;
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card/50 border border-white/10 rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground mb-1">{label}</h3>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export default function AdminLeads() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [state, setState] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [minConfidence, setMinConfidence] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [market, setMarket] = useState<CollectInputMarket>("las-vegas");

  const { data: summary } = useGetLeadsSummary();

  const listParams: ListBusinessLeadsParams = useMemo(
    () => ({
      state: state || undefined,
      city: city || undefined,
      category: category || undefined,
      status: (status || undefined) as ListBusinessLeadsStatus | undefined,
      minConfidence: minConfidence ? Number(minConfidence) : undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [state, city, category, status, minConfidence, q, page],
  );

  const { data: leadsPage, isFetching } = useListBusinessLeads(listParams);
  const { data: rejectedPage } = useListRejectedLeads({ limit: 200 });

  const { data: collect } = useGetCollectStatus({
    query: {
      queryKey: getGetCollectStatusQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.running ? 3000 : false,
    },
  });
  const startCollect = useStartCollect();

  const running = collect?.running ?? false;

  const handleRun = () => {
    startCollect.mutate(
      { data: { market } },
      {
        onSuccess: () => {
          toast({ title: "Collection started", description: `Market: ${market}` });
          queryClient.invalidateQueries({ queryKey: getGetCollectStatusQueryKey() });
        },
        onError: () => {
          toast({
            title: "Could not start collection",
            description: "A run may already be in progress.",
            variant: "destructive",
          });
        },
      },
    );
  };

  // When a run finishes, refresh the data views.
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetLeadsSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBusinessLeadsQueryKey() });
  };

  const resetFilters = () => {
    setState("");
    setCity("");
    setCategory("");
    setStatus("");
    setMinConfidence("");
    setQ("");
    setPage(0);
  };

  const csvFilters = {
    state: state || undefined,
    city: city || undefined,
    category: category || undefined,
    status: status || undefined,
    minConfidence: minConfidence || undefined,
    q: q || undefined,
  };

  const total = leadsPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Collection control */}
      <div className="bg-card/50 border border-white/10 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-serif text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" /> Data Collection
            </h3>
            <p className="text-sm text-muted-foreground">
              Collect hookah businesses from Google Places into the lead database.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={market} onValueChange={(v) => setMarket(v as CollectInputMarket)}>
              <SelectTrigger className="w-56 bg-background border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="las-vegas">Las Vegas / Clark County (test)</SelectItem>
                <SelectItem value="nationwide">Nationwide (major metros)</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleRun} disabled={running} className="bg-primary text-primary-foreground">
              {running ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running…</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Run Collection</>
              )}
            </Button>
          </div>
        </div>

        {collect && (collect.running || collect.finishedAt) && (
          <div className="mt-4 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
              <span>Market: <span className="text-white">{collect.market}</span></span>
              <span>Queries: <span className="text-white">{collect.queriesRun ?? 0}/{collect.totalQueries ?? 0}</span></span>
              <span>Fetched: <span className="text-white">{collect.fetched ?? 0}</span></span>
              <span>New: <span className="text-green-400">{collect.inserted ?? 0}</span></span>
              <span>Updated: <span className="text-white">{collect.updated ?? 0}</span></span>
              <span>Rejected: <span className="text-amber-400">{collect.rejected ?? 0}</span></span>
              {collect.running ? (
                <span className="text-primary">In progress…</span>
              ) : (
                <button onClick={refreshAll} className="text-primary underline">Run finished — refresh data</button>
              )}
            </div>
            {collect.error && <p className="text-destructive mt-1">Error: {collect.error}</p>}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Total Leads" value={summary?.total ?? 0} />
        {summary?.byStatus.map((s) => (
          <StatCard key={s.label} label={STATUS_META[s.label]?.label ?? s.label} value={s.count} />
        ))}
        <StatCard label="Rejected" value={summary?.rejectedTotal ?? 0} />
      </div>

      <Tabs defaultValue="database" className="w-full">
        <TabsList className="bg-card border border-white/10 mb-4">
          <TabsTrigger value="database"><Database className="w-4 h-4 mr-2" /> Lead Database</TabsTrigger>
          <TabsTrigger value="rejected"><Ban className="w-4 h-4 mr-2" /> Rejected / Duplicates</TabsTrigger>
        </TabsList>

        <TabsContent value="database" className="space-y-4">
          {/* CSV exports */}
          <div className="flex flex-wrap gap-2">
            <a href={buildCsvHref({ market: "las-vegas" })}>
              <Button variant="outline" size="sm" className="border-white/10"><Download className="w-4 h-4 mr-2" /> Las Vegas CSV</Button>
            </a>
            <a href={buildCsvHref({ market: "nationwide" })}>
              <Button variant="outline" size="sm" className="border-white/10"><Download className="w-4 h-4 mr-2" /> Nationwide Master CSV</Button>
            </a>
            <a href={buildCsvHref(csvFilters)}>
              <Button variant="outline" size="sm" className="border-white/10"><Download className="w-4 h-4 mr-2" /> Current View CSV</Button>
            </a>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Input placeholder="Search name/address…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="bg-background border-white/10" />
            <Input placeholder="State (e.g. NV)" value={state} onChange={(e) => { setState(e.target.value); setPage(0); }} className="bg-background border-white/10" />
            <Input placeholder="City" value={city} onChange={(e) => { setCity(e.target.value); setPage(0); }} className="bg-background border-white/10" />
            <Select value={category || "all"} onValueChange={(v) => { setCategory(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="bg-background border-white/10"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {summary?.byCategory.map((c) => (
                  <SelectItem key={c.label} value={c.label}>{c.label} ({c.count})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="bg-background border-white/10"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="likely">Likely</SelectItem>
                <SelectItem value="needs_manual">Needs Manual</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minConfidence || "0"} onValueChange={(v) => { setMinConfidence(v === "0" ? "" : v); setPage(0); }}>
              <SelectTrigger className="bg-background border-white/10"><SelectValue placeholder="Min confidence" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any confidence</SelectItem>
                <SelectItem value="40">40+</SelectItem>
                <SelectItem value="60">60+</SelectItem>
                <SelectItem value="80">80+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{total} matching leads{isFetching ? " · loading…" : ""}</p>
            <Button variant="ghost" size="sm" onClick={resetFilters}>Reset filters</Button>
          </div>

          {/* Table */}
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead>Business</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leadsPage?.leads.map((l) => (
                  <TableRow key={l.id} className="border-white/10">
                    <TableCell className="max-w-[220px]">
                      <a href={l.googleMapsUrl || "#"} target="_blank" rel="noreferrer" className="font-medium text-white hover:text-primary">{l.name}</a>
                      {l.address && <p className="text-xs text-muted-foreground truncate">{l.address}</p>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.category}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {l.city}{l.state ? `, ${l.state}` : ""}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col gap-0.5">
                        {l.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3 h-3" /> {l.phone}</span>}
                        {l.website && <a href={l.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary"><Globe className="w-3 h-3" /> Site</a>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.rating ? <span className="flex items-center gap-1"><Star className="w-3 h-3 text-primary" /> {l.rating} ({l.reviewCount})</span> : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-white">{l.confidence}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_META[l.validationStatus]?.className}>
                        {STATUS_META[l.validationStatus]?.label ?? l.validationStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(!leadsPage || leadsPage.leads.length === 0) && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No leads found. Run a collection to populate the database.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border-white/10">Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="border-white/10">Next</Button>
          </div>
        </TabsContent>

        <TabsContent value="rejected" className="space-y-4">
          <p className="text-sm text-muted-foreground">Records skipped during collection — duplicates, out-of-scope, or not hookah-related. ({rejectedPage?.total ?? 0} total)</p>
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead>Business</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Matched Lead</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rejectedPage?.rejected.map((r) => (
                  <TableRow key={r.id} className="border-white/10">
                    <TableCell className="text-white">{r.name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.city}{r.state ? `, ${r.state}` : ""}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.phone || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="border-white/10 text-muted-foreground">{REASON_LABELS[r.reason] ?? r.reason}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.matchedLeadId ? `#${r.matchedLeadId}` : "—"}</TableCell>
                  </TableRow>
                ))}
                {(!rejectedPage || rejectedPage.rejected.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No rejected records yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
