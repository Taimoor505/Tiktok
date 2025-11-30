import xml.etree.ElementTree as ET
import requests
import os
import json
from fastapi import FastAPI, Request
from yt_dlp import YoutubeDL
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
DOWNLOAD_PATH = os.getenv("DOWNLOAD_PATH", "./downloads")
SEEN_FILE = "seen_shorts.json"

app = FastAPI()

# Create downloads folder
os.makedirs(DOWNLOAD_PATH, exist_ok=True)


# -------------------------------
# Load / Save Seen Shorts
# -------------------------------
def load_seen():
    if os.path.exists(SEEN_FILE):
        return set(json.load(open(SEEN_FILE)))
    return set()


def save_seen(seen_ids):
    json.dump(list(seen_ids), open(SEEN_FILE, "w"))


seen_videos = load_seen()


# -------------------------------
# Send Telegram
# -------------------------------
def send_telegram(text):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHAT_ID, "text": text})


# -------------------------------
# Download SHORT
# -------------------------------
def download_short(video_id):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    url = f"https://www.youtube.com/watch?v={video_id}"

    ydl_opts = {
        "format": "best[height<=1920]/best",
        "outtmpl": os.path.join(DOWNLOAD_PATH, f"{timestamp}_%(title)s.%(ext)s"),
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            print(f"📥 Downloading {url}")
            ydl.download([url])
            print("✅ Download complete")
    except Exception as e:
        print(f"❌ Error downloading: {e}")


# -------------------------------
# VERIFY ENDPOINT (REQUIRED)
# -------------------------------
@app.get("/youtube-webhook")
async def verify(hub_challenge: str = None):
    return hub_challenge


# -------------------------------
# PUSH NOTIFICATION RECEIVER
# -------------------------------
@app.post("/youtube-webhook")
async def notification(request: Request):
    raw = await request.body()
    root = ET.fromstring(raw)

    global seen_videos

    for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
        video_id = entry.find(
            "{http://www.youtube.com/xml/schemas/2015}videoId"
        ).text

        # Avoid duplicates
        if video_id in seen_videos:
            return "OK"

        # Create Shorts URL
        short_url = f"https://www.youtube.com/shorts/{video_id}"

        # Notify Tgram
        send_telegram(f"🎬 New SHORT uploaded:\n{short_url}")

        # Download the short
        download_short(video_id)

        # Mark as seen
        seen_videos.add(video_id)
        save_seen(seen_videos)

    return "OK"
