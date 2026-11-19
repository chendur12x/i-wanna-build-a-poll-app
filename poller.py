#!/usr/bin/env python3
"""
ARRAKIS RADAR - Dune 3 IMAX Ticket Tracker & Poller (Python 3)
Zero external dependencies - Uses Python standard library only!
Monitors District (by Zomato) & BookMyShow for IMAX tickets.
Dispatches instant Telegram, Discord, and ntfy.sh alerts.
"""

import os
import sys
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime

# Configuration
CONFIG = {
    "MOVIE_KEYWORD": os.getenv("MOVIE_KEYWORD", "dune").strip().lower(),
    "CITY": os.getenv("CITY", "bengaluru").strip().lower(),
    "FORMAT_REQUIRED": os.getenv("FORMAT_REQUIRED", "IMAX").strip().upper(),
    "CINEMA_FILTER": os.getenv("CINEMA_FILTER", "").strip().lower(),
    "POLL_INTERVAL_SECONDS": int(os.getenv("POLL_INTERVAL_SECONDS", "60")),
    
    # Telegram credentials
    "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
    "TELEGRAM_CHAT_ID": os.getenv("TELEGRAM_CHAT_ID", "").strip(),
    
    # Discord Webhook
    "DISCORD_WEBHOOK_URL": os.getenv("DISCORD_WEBHOOK_URL", "").strip(),
    
    # ntfy.sh free push
    "NTFY_TOPIC": os.getenv("NTFY_TOPIC", "").strip(),
    
    # BookMyShow cookie
    "BMS_COOKIE": os.getenv("BMS_COOKIE", "").strip()
}

# Load config.json if exists
if os.path.exists("config.json"):
    try:
        with open("config.json", "r") as f:
            file_cfg = json.load(f)
            CONFIG.update(file_cfg)
    except Exception as e:
        print(f"[Config] Error reading config.json: {e}")

NOTIFIED_KEYS = set()

def fetch_url(url, headers=None, timeout=10):
    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    }
    if headers:
        default_headers.update(headers)
    req = urllib.request.Request(url, headers=default_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            return resp.status, content
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, str(e)

def post_json(url, json_data, headers=None, timeout=10):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    payload = json.dumps(json_data).encode("utf-8") if isinstance(json_data, (dict, list)) else json_data.encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except Exception as e:
        print(f"[Alert] POST error to {url}: {e}")
        return 0

def send_telegram(ticket):
    token = CONFIG["TELEGRAM_BOT_TOKEN"]
    chat_id = CONFIG["TELEGRAM_CHAT_ID"]
    if not token or not chat_id:
        return
    text = (
        f"🚨 *DUNE 3 IMAX TICKETS DETECTED!* 🚨\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎬 *Title:* {ticket['title']}\n"
        f"📍 *Platform:* {ticket['platform']}\n"
        f"🏙️ *City:* {ticket['city'].upper()}\n"
        f"🎞️ *Format:* {ticket.get('format', 'IMAX')}\n"
        f"🎟️ *Status:* *{ticket['status']}*\n"
        + (f"🏛️ *Cinema:* {ticket['cinema']}\n" if ticket.get('cinema') else "") +
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔗 [BOOK TICKETS IMMEDIATELY]({ticket['url']})\n"
        f"⚡ Detected by *Arrakis Radar* at {datetime.now().strftime('%H:%M:%S')}"
    )
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    post_json(url, {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": False
    })
    print(f"[Alert/Telegram] Sent notification to chat {chat_id}")

def send_discord(ticket):
    webhook = CONFIG["DISCORD_WEBHOOK_URL"]
    if not webhook:
        return
    payload = {
        "content": "🚨 @everyone **DUNE 3 IMAX TICKETS ARE LIVE! BOOK NOW!** 🎟️",
        "embeds": [{
            "title": f"🔥 {ticket['title']} ({ticket.get('format', 'IMAX')})",
            "url": ticket["url"],
            "description": f"Booking has just opened on **{ticket['platform']}**! Grab your seats before they sell out!",
            "color": 0xe5a93c,
            "fields": [
                {"name": "Platform", "value": ticket["platform"], "inline": True},
                {"name": "City", "value": ticket["city"].upper(), "inline": True},
                {"name": "Format", "value": ticket.get("format", "IMAX Laser"), "inline": True},
                {"name": "Status", "value": f"🟢 **{ticket['status']}**", "inline": True}
            ],
            "footer": {"text": f"Arrakis Radar • {datetime.now().strftime('%H:%M:%S')}"}
        }]
    }
    post_json(webhook, payload)
    print(f"[Alert/Discord] Webhook notification dispatched!")

def send_ntfy(ticket):
    topic = CONFIG["NTFY_TOPIC"].replace("https://ntfy.sh/", "").strip()
    if not topic:
        return
    url = f"https://ntfy.sh/{topic}"
    body = f"{ticket['title']} is now available on {ticket['platform']} ({ticket.get('format', 'IMAX')}). Tap to book!"
    headers = {
        "Title": "🚨 DUNE 3 IMAX TICKETS LIVE!",
        "Priority": "urgent",
        "Tags": "warning,ticket,movie_camera,fire",
        "Click": ticket["url"]
    }
    post_json(url, body, headers=headers)
    print(f"[Alert/Ntfy] Push sent to topic '{topic}'!")

def dispatch_alerts(ticket):
    key = f"{ticket['platform']}_{ticket['title']}_{ticket['url']}"
    if key in NOTIFIED_KEYS:
        return
    NOTIFIED_KEYS.add(key)
    print(f"\n🚨🚨🚨 [TICKETS DETECTED] DISPATCHING INSTANT ALERTS! 🚨🚨🚨")
    print(json.dumps(ticket, indent=2))
    send_telegram(ticket)
    send_discord(ticket)
    send_ntfy(ticket)

def poll_district():
    log_prefix = "[District]"
    start = time.time()
    status, html = fetch_url("https://www.district.in/movies/")
    elapsed = int((time.time() - start) * 1000)
    if status != 200:
        print(f"{log_prefix} HTTP {status} ({elapsed}ms)")
        return []

    movie_slugs = list(set(re.findall(r'/movies/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)', html)))
    keyword = CONFIG["MOVIE_KEYWORD"]
    city = CONFIG["CITY"]

    matches = [s for s in movie_slugs if keyword in s.lower()]
    # Prioritize city matches if present
    city_matches = [s for s in matches if f"-in-{city}" in s.lower()]
    target_slugs = city_matches if city_matches else matches

    print(f"{log_prefix} Scanned {len(movie_slugs)} movies | Matched '{keyword}': {len(matches)} (City '{city}': {len(city_matches)}) in {elapsed}ms")

    results = []
    for slug in target_slugs:
        movie_url = f"https://www.district.in/movies/{slug}"
        m_status, m_html = fetch_url(movie_url)
        if m_status != 200:
            continue

        formats = []
        if re.search(r'IMAX', m_html, re.I): formats.append("IMAX")
        if re.search(r'4DX', m_html, re.I): formats.append("4DX")
        if re.search(r'ICE', m_html, re.I): formats.append("ICE")
        if re.search(r'3D', m_html, re.I): formats.append("3D")

        is_booking_open = bool(re.search(r'book\s*tickets?|available|filling\s*fast', m_html, re.I))
        has_imax = "IMAX" in formats or "imax" in slug.lower()

        title = re.sub(r'-movie-tickets.*$', '', slug).replace("-", " ").upper()
        discovery = {
            "title": title,
            "platform": "District (Zomato)",
            "url": movie_url,
            "city": city,
            "format": " / ".join(formats) if formats else "IMAX / 2D",
            "status": "BOOKINGS LIVE!" if is_booking_open else "Listed (Notify Stage)",
            "isBookingOpen": is_booking_open,
            "hasImax": has_imax,
            "timestamp": datetime.now().isoformat()
        }
        results.append(discovery)
        if is_booking_open and (CONFIG["FORMAT_REQUIRED"] == "" or has_imax):
            dispatch_alerts(discovery)

    return results

def poll_bms():
    log_prefix = "[BookMyShow]"
    city = CONFIG["CITY"]
    keyword = CONFIG["MOVIE_KEYWORD"]
    start = time.time()
    headers = {"Referer": "https://in.bookmyshow.com/", "x-bms-app": "web"}
    if CONFIG["BMS_COOKIE"]:
        headers["Cookie"] = CONFIG["BMS_COOKIE"]

    status, html = fetch_url(f"https://in.bookmyshow.com/explore/movies-{city}", headers=headers)
    elapsed = int((time.time() - start) * 1000)

    if status == 403:
        print(f"{log_prefix} Cloudflare protection active ({elapsed}ms). District fallback running.")
        return []

    if status == 200:
        matches = re.findall(rf'/movies/([^/]*{re.escape(keyword)}[^/]*)/(ET[0-9]+)', html, re.I)
        results = []
        for slug, code in matches:
            url = f"https://in.bookmyshow.com/{city}/movies/{slug}/{code}"
            discovery = {
                "title": slug.replace("-", " ").upper(),
                "platform": "BookMyShow",
                "url": url,
                "city": city,
                "format": "IMAX Laser / 2D",
                "status": "BOOKINGS LIVE ON BMS!",
                "isBookingOpen": True,
                "hasImax": True,
                "timestamp": datetime.now().isoformat()
            }
            results.append(discovery)
            dispatch_alerts(discovery)
        return results

    return []

def run_sweep():
    print(f"\n========================================================")
    print(f"[Arrakis Radar] Sweep started at {datetime.now().strftime('%H:%M:%S')}")
    print(f"Target: '{CONFIG['MOVIE_KEYWORD']}' | City: {CONFIG['CITY']} | Format: {CONFIG['FORMAT_REQUIRED']}")
    print(f"========================================================")

    res_district = poll_district()
    res_bms = poll_bms()
    all_res = res_district + res_bms
    if not all_res:
        print(f"[Arrakis Radar] No open IMAX bookings for '{CONFIG['MOVIE_KEYWORD']}' yet. Standing by...")
    return all_res

def test_alert():
    print("[Test] Sending simulated Dune 3 IMAX test alert to configured channels...")
    mock = {
        "title": "DUNE 3: MESSIAH (IMAX 70MM / LASER)",
        "platform": "District & BookMyShow [TEST ALERT]",
        "url": "https://www.district.in/movies/",
        "city": CONFIG["CITY"],
        "cinema": "PVR Forum Koramangala IMAX / PVR Phoenix Palladium",
        "format": "IMAX with Laser (1.43:1)",
        "status": "TICKETS JUST DROPPED!",
        "isBookingOpen": True,
        "hasImax": True
    }
    dispatch_alerts(mock)
    print("[Test] Completed. Check your phone / messaging channels!")

if __name__ == "__main__":
    if "--test-alert" in sys.argv:
        test_alert()
    elif "--once" in sys.argv:
        run_sweep()
        print("[Arrakis Radar] Single sweep completed.")
    else:
        print(f"[Arrakis Radar] Starting background poller loop every {CONFIG['POLL_INTERVAL_SECONDS']}s...")
        while True:
            run_sweep()
            time.sleep(CONFIG["POLL_INTERVAL_SECONDS"])
