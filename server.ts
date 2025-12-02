// server.ts
import "dotenv/config";
import Fastify from "fastify";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH ?? "./downloads";
const SEEN_FILE = "seen_shorts.json";

if (!TELEGRAM_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
if (!CHAT_ID) throw new Error("Missing TELEGRAM_CHAT_ID in .env");

fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });

// -------------------------------
// Load / Save Seen Shorts
// -------------------------------
function loadSeen(): Set<string> {
  if (fs.existsSync(SEEN_FILE)) {
    const raw = fs.readFileSync(SEEN_FILE, "utf8");
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  }
  return new Set();
}

function saveSeen(seen: Set<string>) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2), "utf8");
}

let seenVideos = loadSeen();

// -------------------------------
// Send Telegram
// -------------------------------
async function sendTelegram(text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  // Telegram accepts form-encoded
  const body = new URLSearchParams({ chat_id: CHAT_ID!, text });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Telegram send failed:", res.status, errText);
  }
}

// -------------------------------
// Download SHORT (yt-dlp)
// -------------------------------
function timestampNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function downloadShort(videoId: string) {
  const ts = timestampNow();
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Similar to yt_dlp opts:
  // format: best[height<=1920]/best
  // outtmpl: <DOWNLOAD_PATH>/<timestamp>_%(title)s.%(ext)s
  const outtmpl = path.join(DOWNLOAD_PATH, `${ts}_%(title)s.%(ext)s`);

  try {
    console.log(`📥 Downloading ${url}`);
    await execFileAsync("yt-dlp", ["-f", "best[height<=1920]/best", "-o", outtmpl, url], {
      windowsHide: true,
    });
    console.log("✅ Download complete");
  } catch (e) {
    console.error("❌ Error downloading:", e);
  }
}

// -------------------------------
// XML parsing helpers (Atom feed)
// -------------------------------
const parser = new XMLParser({
  ignoreAttributes: false,
  // keep namespace prefixes so we can grab yt:videoId reliably
  removeNSPrefix: false,
});

function extractVideoIdsFromAtom(xml: string): string[] {
  // Atom structure: feed -> entry (array or single)
  const obj = parser.parse(xml);

  // Depending on publisher, it might be: feed.entry or "feed": {"entry": ...}
  const feed = obj.feed ?? obj["at:feed"] ?? obj;
  const entries = feed?.entry;

  if (!entries) return [];

  const list = Array.isArray(entries) ? entries : [entries];

  const ids: string[] = [];
  for (const entry of list) {
    // Common: "yt:videoId"
    const vid = entry["yt:videoId"] ?? entry["videoId"];
    if (typeof vid === "string" && vid.trim()) ids.push(vid.trim());
  }
  return ids;
}

// -------------------------------
// Server
// -------------------------------
const app = Fastify({
  // IMPORTANT: we want the raw body (XML), not parsed JSON.
  // Fastify gives us req.body as string/buffer if content-type isn't JSON (usually).
  logger: true,
});

// VERIFY ENDPOINT (REQUIRED)
app.get("/youtube-webhook", async (req, reply) => {
  // YouTube hub verification uses hub.challenge
  const q = req.query as { ["hub.challenge"]?: string; hub_challenge?: string };

  const challenge = q["hub.challenge"] ?? q.hub_challenge ?? "";
  reply.type("text/plain").send(challenge);
});

// PUSH NOTIFICATION RECEIVER
app.post("/youtube-webhook", async (req, reply) => {
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : "";

  if (!rawBody) {
    reply.code(400).send("Missing body");
    return;
  }

  let videoIds: string[] = [];
  try {
    videoIds = extractVideoIdsFromAtom(rawBody);
  } catch (e) {
    req.log.error(e, "Failed to parse XML");
    reply.code(400).send("Invalid XML");
    return;
  }

  // Match your Python behavior: if any entry is already seen, just short-circuit OK
  for (const videoId of videoIds) {
    if (seenVideos.has(videoId)) {
      reply.send("OK");
      return;
    }

    const shortUrl = `https://www.youtube.com/shorts/${videoId}`;

    await sendTelegram(`🎬 New SHORT uploaded:\n${shortUrl}`);
    await downloadShort(videoId);

    seenVideos.add(videoId);
    saveSeen(seenVideos);
  }

  reply.send("OK");
});

// Boot
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
