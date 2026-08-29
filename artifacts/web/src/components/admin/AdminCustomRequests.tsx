import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminListCustomRequestsQueryKey,
  useAdminDisableCreatorRequests,
  useAdminListCustomRequests,
  useAdminRefundCustomRequest,
  useAdminResolveCustomRequest,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export function AdminCustomRequests() {
  const [status, setStatus] = useState("all");
  const params = status === "all" ? undefined : { status };
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: requests, isLoading } = useAdminListCustomRequests(params, {
    query: { queryKey: getAdminListCustomRequestsQueryKey(params) },
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/custom-requests"],
    });
  const mutationOptions = {
    onSuccess: () => {
      toast({ title: "Custom request updated" });
      refresh();
    },
    onError: () =>
      toast({
        title: "Custom request not updated",
        description: "Please try again.",
        variant: "destructive" as const,
      }),
  };
  const refund = useAdminRefundCustomRequest({ mutation: mutationOptions });
  const resolve = useAdminResolveCustomRequest({ mutation: mutationOptions });
  const disable = useAdminDisableCreatorRequests({ mutation: mutationOptions });

  return (
    <section className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-serif text-white">Custom Requests</h2>
          <p className="text-sm text-muted-foreground">
            Review deadlines, disputes, settlements, refunds, and Creator access.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger
            className="w-full sm:w-56"
            data-testid="select-admin-custom-request-status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending_creator_response">Awaiting response</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="disputed">Disputed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading custom requests…</p>
      ) : requests?.length ? (
        <div className="space-y-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="rounded-xl border border-white/10 bg-card/50 p-4"
              data-testid={`admin-custom-request-${request.id}`}
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">Request #{request.id}</span>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-muted-foreground">
                      {request.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm text-primary">
                      {request.priceCredits} credits
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Creator #{request.creatorUserId} · Member #{request.customerUserId} ·{" "}
                    {request.requestType.replace(/_/g, " ")}
                  </p>
                  <p className="max-w-3xl text-sm text-white/80">
                    {request.requestText}
                  </p>
                  {request.disputeReason && (
                    <p className="text-sm text-red-300">
                      Dispute: {request.disputeReason}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                  {!["refunded", "completed"].includes(request.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`button-admin-refund-request-${request.id}`}
                      onClick={() => refund.mutate({ id: request.id })}
                      disabled={refund.isPending}
                    >
                      Refund
                    </Button>
                  )}
                  {request.status === "disputed" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`button-admin-resolve-refund-${request.id}`}
                        onClick={() =>
                          resolve.mutate({
                            id: request.id,
                            data: { resolution: "refund" },
                          })
                        }
                        disabled={resolve.isPending}
                      >
                        Resolve with refund
                      </Button>
                      <Button
                        size="sm"
                        data-testid={`button-admin-resolve-complete-${request.id}`}
                        onClick={() =>
                          resolve.mutate({
                            id: request.id,
                            data: { resolution: "complete" },
                          })
                        }
                        disabled={resolve.isPending}
                      >
                        Resolve as complete
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    data-testid={`button-admin-disable-creator-${request.creatorUserId}`}
                    onClick={() =>
                      disable.mutate({ creatorUserId: request.creatorUserId })
                    }
                    disabled={disable.isPending}
                  >
                    Disable Creator requests
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-card/40 p-8 text-center text-muted-foreground">
          No custom requests match this filter.
        </div>
      )}
    </section>
  );
}