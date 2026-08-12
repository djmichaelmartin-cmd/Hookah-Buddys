import { Link } from "wouter";
import {
  useListDolls,
  useListLounges,
  useGetCurrentUser,
} from "@workspace/api-client-react";
import { BadgeCheck, MapPin, Star, Crown } from "lucide-react";

type Props = {
  onSelectCategory?: (category: string) => void;
};

const TRENDING_TAGS: { tag: string; category: string }[] = [
  { tag: "#DoubleApple", category: "flavor" },
  { tag: "#HookahSetup", category: "setup" },
  { tag: "#LoungeNight", category: "lounge" },
  { tag: "#SmokeTricks", category: "discussion" },
  { tag: "#FridayNightSmoke", category: "event" },
  { tag: "#HookahMemes", category: "meme" },
];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card/30 border border-white/5 backdrop-blur-md p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function DollRow({ doll, online }: { doll: any; online?: boolean }) {
  return (
    <Link
      href={`/dolls/${doll.id}`}
      className="flex items-center gap-3 py-1.5 group"
    >
      <div className="relative shrink-0">
        {doll.profilePhotoUrl ? (
          <img
            src={doll.profilePhotoUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover border border-white/10"
          />
        ) : (
          <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20" />
        )}
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-white truncate group-hover:text-primary transition-colors flex items-center gap-1">
          {doll.stageName}
          {doll.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {doll.city}, {doll.state}
        </p>
      </div>
    </Link>
  );
}

export default function LoungeRightSidebar({ onSelectCategory }: Props) {
  const { data: session } = useGetCurrentUser();
  const { data: onlineDolls } = useListDolls({ online: true });
  const { data: featuredDolls } = useListDolls({ featured: true });
  const { data: lounges } = useListLounges({ limit: 3 });

  const onlineList = (onlineDolls ?? []).slice(0, 5);
  const onlineIds = new Set(onlineList.map((d) => d.id));
  const suggested = (featuredDolls ?? [])
    .filter((d) => !onlineIds.has(d.id))
    .slice(0, 4);

  return (
    <aside className="space-y-4">
      {onlineList.length > 0 && (
        <SectionCard title="Online Now">
          {onlineList.map((doll) => (
            <DollRow key={doll.id} doll={doll} online />
          ))}
        </SectionCard>
      )}

      {suggested.length > 0 && (
        <SectionCard title="Suggested Dolls">
          {suggested.map((doll) => (
            <DollRow key={doll.id} doll={doll} />
          ))}
          <Link
            href="/browse"
            className="block text-xs text-primary hover:underline mt-2"
          >
            Browse all Dolls →
          </Link>
        </SectionCard>
      )}

      <SectionCard title="Trending in The Lounge">
        <div className="flex flex-wrap gap-2">
          {TRENDING_TAGS.map(({ tag, category }) => (
            <button
              key={tag}
              onClick={() => onSelectCategory?.(category)}
              className="px-3 py-1 rounded-full text-xs bg-white/5 text-muted-foreground border border-white/5 hover:bg-white/10 hover:text-white transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      </SectionCard>

      {(lounges?.length ?? 0) > 0 && (
        <SectionCard title="Lounge Spotlight">
          {lounges!.slice(0, 3).map((lounge) => (
            <div key={lounge.id} className="py-1.5">
              <p className="text-sm text-white flex items-center gap-1.5">
                {lounge.name}
                {typeof lounge.rating === "number" && lounge.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-primary">
                    <Star className="h-3 w-3 fill-primary" />
                    {lounge.rating.toFixed(1)}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {lounge.city}, {lounge.state}
              </p>
            </div>
          ))}
        </SectionCard>
      )}

      {/* Sponsored / upgrade promo */}
      {session?.user?.role !== "doll" && (
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card/40 to-card/20 backdrop-blur-md p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">
            Sponsored
          </p>
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-1">
            <Crown className="h-4 w-4 text-primary" /> Go Gold
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Unlock premium Doll content, messaging credits, and VIP perks.
          </p>
          <Link
            href="/pricing"
            className="inline-block w-full text-center rounded-full bg-primary text-primary-foreground text-xs font-medium py-2 hover:opacity-90 transition-opacity"
          >
            Upgrade Now
          </Link>
        </div>
      )}
    </aside>
  );
}
