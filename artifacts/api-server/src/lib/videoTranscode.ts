import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

/** Thrown when ffmpeg cannot decode/encode the uploaded bytes. */
export class TranscodeError extends Error {}

/** Thrown when the transcode queue is saturated — the caller should retry later. */
export class TranscodeBusyError extends Error {}

const FFMPEG_TIMEOUT_MS = 180_000;

// Bound how much CPU video processing may consume so concurrent uploads never
// starve the API event loop or each other:
// - At most MAX_CONCURRENT_TRANSCODES ffmpeg jobs run at once; additional
//   uploads wait their turn in a FIFO queue.
// - Each ffmpeg process is capped at FFMPEG_THREADS threads, leaving CPU
//   headroom for request handling even while a transcode is running.
// - The wait queue is bounded (MAX_QUEUED_TRANSCODES); beyond that, uploads
//   fail fast with TranscodeBusyError instead of piling up until they time out.
const MAX_CONCURRENT_TRANSCODES = 1;
const MAX_QUEUED_TRANSCODES = 8;
const FFMPEG_THREADS = "2";

let runningTranscodes = 0;
const transcodeWaiters: Array<() => void> = [];

async function acquireTranscodeSlot(): Promise<void> {
  if (runningTranscodes < MAX_CONCURRENT_TRANSCODES) {
    runningTranscodes++;
    return;
  }
  if (transcodeWaiters.length >= MAX_QUEUED_TRANSCODES) {
    throw new TranscodeBusyError(
      "Too many videos are being processed right now. Please try again in a moment.",
    );
  }
  // The releasing job hands its slot (and running count) directly to us, so
  // do NOT increment here — the count was never decremented during handoff.
  await new Promise<void>((resolve) => transcodeWaiters.push(resolve));
}

function releaseTranscodeSlot(): void {
  const next = transcodeWaiters.shift();
  if (next) {
    // Hand the slot directly to the next waiter without ever decrementing the
    // running count — otherwise a fresh acquire scheduled before the waiter
    // resumes could grab the "free" slot and briefly exceed the limit.
    next();
    return;
  }
  runningTranscodes--;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      // The global/input-level -threads (before any -i) caps decoder threads;
      // encode-side caps are passed per-output in the args.
      ["-hide_banner", "-loglevel", "error", "-y", "-threads", FFMPEG_THREADS, ...args],
      { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(
            new TranscodeError(
              `ffmpeg failed: ${String(stderr || err.message).slice(0, 500)}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}

export type TranscodeResult = {
  /** Web-friendly H.264 MP4 (faststart, bounded bitrate, max 720p). */
  video: Buffer;
  /** JPEG poster frame extracted from the start of the video. */
  poster: Buffer;
};

/**
 * Transcode an uploaded video (MP4/WebM) to a bounded-bitrate H.264 MP4
 * suitable for the feed, and extract a JPEG poster frame.
 *
 * Encoding choices:
 * - H.264 High profile, CRF 27 capped at ~1.5 Mbps (2s buffer) — good
 *   quality for feed playback while dramatically shrinking raw uploads.
 * - Scaled down to fit 1280x720 (never upscaled), even dimensions enforced.
 * - `+faststart` moves the moov atom to the front so playback starts before
 *   the whole file downloads.
 * - AAC 96 kbps audio (dropped cleanly if the source has no audio track).
 */
export async function transcodeVideoForFeed(
  input: Buffer,
): Promise<TranscodeResult> {
  await acquireTranscodeSlot();
  try {
    return await transcodeVideoForFeedNow(input);
  } finally {
    releaseTranscodeSlot();
  }
}

async function transcodeVideoForFeedNow(
  input: Buffer,
): Promise<TranscodeResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "video-transcode-"));
  const inPath = path.join(dir, `in-${randomUUID()}`);
  const outPath = path.join(dir, "out.mp4");
  const posterPath = path.join(dir, "poster.jpg");
  try {
    await writeFile(inPath, input);

    await runFfmpeg([
      "-i", inPath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "27",
      "-maxrate", "1500k",
      "-bufsize", "3000k",
      "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      "-threads", FFMPEG_THREADS,
      outPath,
    ]);

    // Poster frame from the transcoded output (guaranteed decodable). Seek a
    // moment in to skip black lead-in frames; fall back to frame 0 for clips
    // shorter than the seek point. Note ffmpeg exits 0 even when a seek past
    // the end writes no output, so check the file itself, not the exit code.
    const extractPoster = async (args: string[]): Promise<Buffer | null> => {
      try {
        await runFfmpeg(args);
        const bytes = await readFile(posterPath).catch(() => null);
        return bytes && bytes.length > 0 ? bytes : null;
      } catch {
        return null;
      }
    };
    let poster = await extractPoster([
      "-ss", "0.5", "-i", outPath, "-frames:v", "1", "-q:v", "4",
      "-threads", FFMPEG_THREADS, posterPath,
    ]);
    if (!poster) {
      poster = await extractPoster([
        "-i", outPath, "-frames:v", "1", "-q:v", "4",
        "-threads", FFMPEG_THREADS, posterPath,
      ]);
    }
    if (!poster) {
      throw new TranscodeError("Could not extract a poster frame from the video.");
    }

    const video = await readFile(outPath);
    if (video.length === 0 || poster.length === 0) {
      throw new TranscodeError("Transcode produced an empty output.");
    }
    return { video, poster };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
