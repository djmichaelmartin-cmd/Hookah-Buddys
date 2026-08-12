import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Serves server-rendered Open Graph / Twitter meta tags for /events/:id so
 * link previews in iMessage, WhatsApp, and social apps show the event title,
 * image, and date/venue. Crawlers don't run the SPA's JavaScript, so the tags
 * must be present in the HTML shell itself.
 *
 * Missing/cancelled events (the API 404s for both) fall back to the untouched
 * default index.html, i.e. the default site card.
 */

interface EventData {
  id: number;
  title: string;
  description: string | null;
  venueName: string | null;
  city: string;
  state: string;
  startsAt: string;
  imageUrl: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchEvent(id: string): Promise<EventData | null> {
  // All services sit behind the shared proxy; in a deployment the published
  // domain (REPLIT_DOMAINS) routes there too, so try localhost first and fall
  // back to the runtime domain.
  const origins = ["http://127.0.0.1:80"];
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) origins.push(`https://${domains.split(",")[0]}`);

  for (const origin of origins) {
    try {
      const resp = await fetch(`${origin}/api/events/${id}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (resp.status === 404) return null;
      if (!resp.ok) continue;
      return (await resp.json()) as EventData;
    } catch {
      // try next origin
    }
  }
  return null;
}

function formatEventDetails(event: EventData): string {
  const parts: string[] = [];
  const starts = new Date(event.startsAt);
  if (!Number.isNaN(starts.getTime())) {
    parts.push(
      starts.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
        timeZoneName: "short",
      }),
    );
  }
  const venue = [event.venueName, `${event.city}, ${event.state}`]
    .filter(Boolean)
    .join(" · ");
  if (venue) parts.push(venue);
  let details = parts.join(" — ");
  if (event.description) {
    details = details ? `${details}. ${event.description}` : event.description;
  }
  if (details.length > 300) details = `${details.slice(0, 297)}...`;
  return details;
}

function injectEventMeta(html: string, event: EventData, pageUrl: string): string {
  const title = `${event.title} | HookahDolls`;
  const description = formatEventDetails(event);
  const image = event.imageUrl
    ? event.imageUrl.startsWith("http")
      ? event.imageUrl
      : new URL(event.imageUrl, pageUrl).toString()
    : null;

  // Strip the default title/description/OG/Twitter tags, then inject ours.
  let out = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, "");

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ];
  if (image) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(image)}" />`,
      `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    );
  }

  return out.replace(/<head>/i, `<head>\n    ${tags.join("\n    ")}`);
}

function matchEventPath(url: string, base: string): string | null {
  const pathname = url.split("?")[0];
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (!pathname.startsWith(normalizedBase)) return null;
  const rest = pathname.slice(normalizedBase.length);
  const m = /^events\/(\d+)\/?$/.exec(rest);
  return m ? m[1] : null;
}

function wantsHtml(req: IncomingMessage): boolean {
  if (req.method !== "GET") return false;
  const accept = req.headers.accept ?? "";
  // Crawlers send Accept: text/html or */* (or omit it entirely).
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

export default function ogEventsPlugin(basePath: string): Plugin {
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
    loadHtml: () => Promise<string | null>,
  ) => {
    try {
      if (!req.url || !wantsHtml(req)) return next();
      const eventId = matchEventPath(req.url, basePath);
      if (!eventId) return next();
      const event = await fetchEvent(eventId);
      if (!event) return next(); // default site card fallback
      const html = await loadHtml();
      if (!html) return next();
      const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      const pageUrl = `${proto}://${host}${req.url.split("?")[0]}`;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(injectEventMeta(html, event, pageUrl));
    } catch {
      next();
    }
  };

  return {
    name: "og-events-meta",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) =>
        void handle(req, res, next, async () => {
          const file = path.resolve(server.config.root, "index.html");
          const raw = fs.readFileSync(file, "utf-8");
          return server.transformIndexHtml(req.url ?? "/", raw);
        }),
      );
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((req, res, next) =>
        void handle(req, res, next, async () => {
          const file = path.resolve(server.config.build.outDir, "index.html");
          return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
        }),
      );
    },
  };
}
