import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const HUB = "https://pubsubhubbub.appspot.com/subscribe";

if (!WEBHOOK_URL) {
  throw new Error("Missing WEBHOOK_URL in environment (.env).");
}

async function extractChannelId(url: string): Promise<string> {
  // Uses yt-dlp to get channel_id without downloading.
  // Output is JSON; we parse it and read channel_id.
  const { stdout } = await execFileAsync("yt-dlp", [
    "--quiet",
    "--skip-download",
    "--dump-single-json",
    "--extract-flat",
    url,
  ]);

  const info = JSON.parse(stdout) as { channel_id?: string };
  if (!info.channel_id) {
    throw new Error(`Could not extract channel_id from: ${url}`);
  }
  return info.channel_id;
}

async function subscribeChannel(url: string): Promise<void> {
  const channelId = await extractChannelId(url);
  const rss = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  const body = new URLSearchParams({
    "hub.callback": WEBHOOK_URL!,
    "hub.mode": "subscribe",
    "hub.topic": rss,
    "hub.verify": "async",
  });

  const res = await fetch(HUB, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  console.log(`Subscribed → ${url} → ${res.status}`);
}

async function main() {
  const CHANNELS = [
    "https://www.youtube.com/@tamirsverse",
    "https://www.youtube.com/@AsmonEnjoyer",
    "https://www.youtube.com/@astartesanonymous",
  ];

  for (const channel of CHANNELS) {
    try {
      await subscribeChannel(channel);
    } catch (err) {
      console.error(`Failed → ${channel}`, err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
