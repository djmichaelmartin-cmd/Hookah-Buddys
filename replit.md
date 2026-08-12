# HookahDolls.com

A premium, 21+ hookah-themed creator/social platform connecting verified women creators ("Dolls") with members ("I Love Dolls"), with full admin moderation. Built around a strict brand rule: all Doll content must feature a visible hookah.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/web run dev` — run the web app (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/web run typecheck` — typecheck just the web app
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — reset and seed the database (8 Dolls, admin, members, plans, media)
- Required env: `DATABASE_URL`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, session-cookie auth (express-session + connect-pg-simple + bcryptjs)
- Web: React + Vite + wouter + TanStack Query + shadcn/ui (Tailwind)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/` (one file per table, barrel in `index.ts`)
- API contract (source of truth): `lib/api-spec/openapi.yaml` → generates hooks + Zod schemas
- Generated client hooks/types: `lib/api-client-react/src/generated/`
- API routes: `artifacts/api-server/src/routes/` (registered in `routes/index.ts`)
- Auth/session: `artifacts/api-server/src/lib/auth.ts`
- Web pages: `artifacts/web/src/pages/`; shared layout in `src/components/`
- Seed script: `scripts/src/seed.ts`
- Seeded Doll images: `artifacts/web/public/dolls/`

## Architecture decisions

- Session auth via signed HTTP-only cookies; sessions persisted in the `user_sessions` Postgres table. That table is defined in Drizzle (`lib/db/src/schema/sessions.ts`) and pushed like any other table — connect-pg-simple's `createTableIfMissing` is disabled because it does not honor a custom `tableName`.
- Contract-first: edit `openapi.yaml`, run codegen, then implement server (validates with Zod) and client (uses generated hooks).
- Roles (`doll`/`member`/`admin`) gate routes via `requireAuth(...roles)`.
- Checkout is a placeholder (no real Stripe) — returns a placeholder session; refund policy notes no real charges occur.
- Brand rule enforced in data: Doll media requires `containsHookah = true`.

## Product

- Age gate (21+), browse/search verified Dolls, Doll profiles with free + premium (paid-unlock) media.
- Three roles: Dolls (verified creators), Members, Admins.
- Messaging costs credits; premium content unlocks; video chat; profile boosts.
- Doll & Member dashboards, Doll verification flow, admin moderation dashboard.
- Pricing/plans for both audiences; legal pages (Terms, Privacy, Content Rules, Refund Policy) and a working Contact form.
- Public hookah social feed (`/feed`): posts (photo/video, categories, required hookah-related confirmation), likes/comments/saves/reports, follows, notifications (`/notifications` + navbar bell), public Bro profiles (`/bros/:id` with badges), Doll profile posts tab, dashboard feed stats, admin feed moderation + analytics. Logged-out users can preview but not interact. Feed seed: `pnpm --filter @workspace/scripts run seed-feed` (idempotent, run after main seed).
- Membership tiers (Phase 3): 4 member plans — Bronze (free, 0 credits/mo), Silver ($19.99, 100), Gold ($39.99, 300, "Most Popular"), Platinum ($79.99, 750, "Best Access") — tiers/credits in `@workspace/pricing`. `/choose-membership` selection page, plan-based signup (`/signup/member?plan=<slug>`, alias `/signup/bro`) with first/last name, phone, and three agreement checkboxes; Bronze auto-assigned at registration; paid plans go through placeholder Stripe checkout (`/checkout?type=membership&plan=<slug>`) then `POST /subscriptions`. Doll-content subscriptions require an active Gold/Platinum membership. Member dashboard shows tier badge + Upgrade.
- Facebook-style social profiles (Phase 2): cover photo + tabbed profiles (`/bros/:id`, enhanced `/dolls/:id` keeping all monetization), `/profile/edit` with per-field privacy (public/friends/followers/only_me) + completion meter + View As Public, `/settings/privacy`, friend system + blocks (`/friends`), photo albums, reels (`/reels`), tagging with review, post audience control, profile views, admin "Profiles & Media" moderation. Privacy is enforced server-side on every route incl. like/comment/report; blocks hide content bidirectionally. Social seed: `pnpm --filter @workspace/scripts run seed-social` (idempotent).

## Test accounts (seeded)

- Admin: `admin@hookahdolls.com` / `admin123`
- Member: `marcus@example.com` / `password123` (25 credits)
- Dolls: `scarlett@hookahdolls.com` … `mila@hookahdolls.com` / `password123`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The `/api/dolls` browse list requires authentication; `/api/dolls/featured` is public.
- Re-running the seed (`pnpm --filter @workspace/scripts run seed`) clears all app tables first — do not run against data you want to keep.
- Do not run `pnpm dev` at the workspace root; use per-artifact workflows. Verify with `typecheck`, not `build`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
