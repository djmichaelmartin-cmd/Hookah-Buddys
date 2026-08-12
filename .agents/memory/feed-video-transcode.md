---
name: Feed video transcode pipeline
description: How uploaded feed videos are compressed and gotchas around ffmpeg poster extraction and cleanup references.
---

- Feed video uploads are transcoded server-side to bounded-bitrate H.264 MP4 (max 720p, CRF 27 capped ~1.5 Mbps, +faststart) and a JPEG poster is extracted; the upload endpoint returns both object paths and posts store `posterUrl`.
- **ffmpeg exit code lies for poster extraction:** seeking past the end of a short clip (`-ss 0.5` on a 0.2s video) exits 0 but writes NO output file. Check the output file exists and is non-empty; only then fall back to frame 0.
- **Why:** relying on exit code made valid sub-second uploads 500.
- **How to apply:** any new ffmpeg-based extraction (thumbnails for reels/Doll media) must validate the output file, not the exit code.
- Any new DB column holding an uploads object URL (e.g. poster/thumbnail fields) MUST be added to `collectReferencedIds` in the orphan-cleanup script, or the cleanup deletes live media after the grace period.
