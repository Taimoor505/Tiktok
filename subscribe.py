import requests
from yt_dlp import YoutubeDL
from dotenv import load_dotenv
import os

load_dotenv()

WEBHOOK_URL = os.getenv("WEBHOOK_URL")
HUB = "https://pubsubhubbub.appspot.com/subscribe"


def extract_channel_id(url):
    with YoutubeDL({"quiet": True, "extract_flat": True}) as ydl:
        info = ydl.extract_info(url, download=False)
        return info.get("channel_id")


def subscribe_channel(url):
    channel_id = extract_channel_id(url)
    rss = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"

    data = {
        "hub.callback": WEBHOOK_URL,
        "hub.mode": "subscribe",
        "hub.topic": rss,
        "hub.verify": "async"
    }

    r = requests.post(HUB, data=data)
    print(f"Subscribed → {url} → {r.status_code}")


if __name__ == "__main__":
    CHANNELS = [
        "https://www.youtube.com/@ataxyz",
        "https://www.youtube.com/@AnotherChannel",
        "https://www.youtube.com/@RandomStuff",
    ]

    for channel in CHANNELS:
        subscribe_channel(channel)
