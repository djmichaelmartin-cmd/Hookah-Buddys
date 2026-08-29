import { Link } from "wouter";
import { Store, UserRound } from "lucide-react";

type EventHostData = {
  businessId?: number | null;
  businessName?: string | null;
  businessHandle?: string | null;
  businessLogoUrl?: string | null;
  organizerName?: string | null;
  organizerPhotoUrl?: string | null;
  createdByUserName?: string | null;
  createdByUserPhotoUrl?: string | null;
};

export function EventHost({
  event,
  fallbackName,
  fallbackHref,
  compact = false,
}: {
  event: unknown;
  fallbackName?: string | null;
  fallbackHref?: string;
  compact?: boolean;
}) {
  const host = event as EventHostData;

  if (host.businessId && host.businessHandle) {
    const name = host.businessName || host.businessHandle;
    return (
      <Link
        href={`/business/${host.businessHandle}`}
        className={`inline-flex items-center gap-2 text-[#D6B56D] hover:text-[#e2c681] transition-colors ${compact ? "text-xs" : "text-sm"}`}
        data-testid={`link-event-business-${host.businessId}`}
      >
        <span className={`${compact ? "h-6 w-6" : "h-8 w-8"} shrink-0 overflow-hidden rounded-full border border-[#D6B56D]/30 bg-[#D6B56D]/10 flex items-center justify-center`}>
          {host.businessLogoUrl ? (
            <img src={host.businessLogoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Store className={compact ? "h-3 w-3" : "h-4 w-4"} />
          )}
        </span>
        <span className="min-w-0">
          <span className="text-white/50">Hosted by </span>
          <span className="font-semibold">{name}</span>
        </span>
      </Link>
    );
  }

  const organizerName = host.organizerName || host.createdByUserName || fallbackName;
  if (!organizerName) return null;

  const content = (
    <>
      <span className={`${compact ? "h-6 w-6" : "h-8 w-8"} shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5 flex items-center justify-center`}>
        {host.organizerPhotoUrl || host.createdByUserPhotoUrl ? (
          <img
            src={host.organizerPhotoUrl || host.createdByUserPhotoUrl || ""}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <UserRound className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-white/50`} />
        )}
      </span>
      <span className="min-w-0">
        <span className="text-white/50">Hosted by </span>
        <span className="font-semibold text-white/80">{organizerName}</span>
      </span>
    </>
  );

  return fallbackHref ? (
    <Link
      href={fallbackHref}
      className={`inline-flex items-center gap-2 hover:text-white transition-colors ${compact ? "text-xs" : "text-sm"}`}
      data-testid="link-event-member-host"
    >
      {content}
    </Link>
  ) : (
    <div className={`inline-flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`} data-testid="event-member-host">
      {content}
    </div>
  );
}