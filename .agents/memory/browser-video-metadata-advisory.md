---
name: Browser video metadata is advisory
description: Why browser-side video decoding must not be the authority for upload validation.
---

Treat browser video metadata and preview decoding as advisory UX only. A supported upload must not be rejected solely because the current browser cannot decode its codec or emit metadata.

**Why:** Browsers and headless environments support different codecs. A valid MP4 can fail client metadata decoding even though the server can safely sniff, probe, transcode, and play the normalized output.

**How to apply:** Client checks may reject disallowed extensions/MIME types and show best-effort previews, but stored-byte sniffing, ownership checks, transcoding, file-size limits, and duration limits must be enforced by the server before content is created.