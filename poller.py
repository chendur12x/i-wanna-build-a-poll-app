#!/usr/bin/env python3
"""
ARRAKIS RADAR - Dune 3 IMAX Ticket Tracker & Poller (Python 3 Mission-Critical Edition)
Zero external dependencies - Uses Python standard library only!

Mission-Critical Surveillance Rules:
1. Basera Mall Alone: Monitored unconditionally for all shows/dates.
2. Other Theatres: 16th shows alone (newly added shows only).
3. Persistent Deduplication across executions.
"""

import os
import sys
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
STATE_FILE = os.path.join(CACHE_DIR, "seen_shows.json")
STEP_SUMMARY_FILE = os.getenv("GITHUB_STEP_SUMMARY", "")

CONFIG = {
    "MOVIE_KEYWORD": os.getenv("MOVIE_KEYWORD", "dune").strip().lower(),
    "CITY": os.getenv("CITY", "chennai").strip().lower(),
    "FORMAT_REQUIRED": os.getenv("FORMAT_REQUIRED", "IMAX").strip().upper(),
    "PRIMARY_CINEMA": os.getenv("PRIMARY_CINEMA", "basera").strip().lower(),
    "SECONDARY_CINEMA_DATE": os.getenv("SECONDARY_CINEMA_DATE", "16").strip(),
    "POLL_INTERVAL_SECONDS": int(os.getenv("POLL_INTERVAL_SECONDS", "60")),
    "TIMEOUT": 12,
    "MAX_RETRIES": 3,

    "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
    "TELEGRAM_CHAT_ID": os.getenv("TELEGRAM_CHAT_ID", "").strip(),
    "DISCORD_WEBHOOK_URL": os.getenv("DISCORD_WEBHOOK_URL", "").strip(),
    "NTFY_TOPIC": os.getenv("NTFY_TOPIC", "chendur12-dune-radar").strip(),
    "SEND_HEARTBEAT": os.getenv("SEND_HEARTBEAT", "true").lower() != "false",
    "BMS_COOKIE": os.getenv("BMS_COOKIE", "").strip(),
    
    # Phone Call: Twilio Voice Call
    "TWILIO_ACCOUNT_SID": os.getenv("TWILIO_ACCOUNT_SID", "").strip(),
    "TWILIO_AUTH_TOKEN": os.getenv("TWILIO_AUTH_TOKEN", "").strip(),
    "TWILIO_FROM_NUMBER": os.getenv("TWILIO_FROM_NUMBER", "").strip(),
    "TO_PHONE_NUMBER": os.getenv("TO_PHONE_NUMBER", "").strip(),

    # Phone Call: CallMeBot Telegram Voice Call (Free)
    "CALLMEBOT_TELEGRAM_USER": os.getenv("CALLMEBOT_TELEGRAM_USER", "").strip()
}

config_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
if os.path.exists(config_json):
    try:
        with open(config_json, "r", encoding="utf-8") as f:
            CONFIG.update(json.load(f))
    except Exception as e:
        print(f"[Config] Error reading config.json: {e}")

def load_state():
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                keys = data.get("seenKeys", [])
                print(f"[State] Loaded {len(keys)} show keys from {STATE_FILE}")
                return set(keys)
    except Exception as e:
        print(f"[State] Warning reading state cache: {e}")
    return set()

def save_state(keys_set):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "lastUpdated": datetime.now().isoformat(),
                "count": len(keys_set),
                "seenKeys": sorted(list(keys_set))
            }, f, indent=2)
        print(f"[State] Persisted {len(keys_set)} show keys to {STATE_FILE}")
    except Exception as e:
        print(f"[State] Error saving state: {e}")

NOTIFIED_KEYS = load_state()

def evaluate_show_eligibility(cinema_name, show_date, venue_details="", extra_context=None):
    if extra_context is None:
        extra_context = {}
    cinema_text = f"{cinema_name} {venue_details}".lower()
    date_str = str(show_date or "").strip().lower()

    # Rule 1: Ultra-Priority - Desired Rows A-G (Elite Tier) at Palazzo or Luxe for 16th shows
    is_palazzo_or_luxe = any(k in cinema_text for k in ["palazzo", "luxe", "palz", "inlu"])
    is_16th = bool(re.search(r'(?:^|\D)16(?:th)?(?:\D|$)|-16\b|16-|\b16\b', date_str, re.I))

    is_elite_or_rows_ag = extra_context.get("is_rows_a_g_open") or bool(re.search(r'(?:rows?[-_\s]*[a-g]\b|elite|₹?508(?:\.34)?|prime|top\s*rows?)', f"{venue_details} {extra_context.get('raw_seats', '')}", re.I))

    if is_palazzo_or_luxe and is_16th and (is_elite_or_rows_ag or extra_context.get("is_last_rows_open") or extra_context.get("is_late_release")):
        return {
            "eligible": True,
            "ruleType": "ROWS_A_TO_G_RELEASE",
            "priority": "ULTRA_CRITICAL",
            "badge": f"💺 ROWS A–G RELEASED ({cinema_name})",
            "cinema": cinema_name,
            "date": show_date or "16th",
            "rows": extra_context.get("rows", "Desired Rows A–G (Elite Tier ₹508.34)")
        }

    # Rule 2: Basera Mall
    if CONFIG["PRIMARY_CINEMA"] in cinema_text or "basera" in cinema_text:
        return {
            "eligible": True,
            "ruleType": "BASERA_MALL_EXCLUSIVE",
            "priority": "HIGH",
            "badge": "🏛️ BASERA MALL (ALL DATES)",
            "cinema": cinema_name or "PVR INOX Basera Mall (ECR)",
            "date": show_date or "All Open Dates"
        }

    # Rule 3: Other Theatres - 16th show alone
    if is_16th:
        return {
            "eligible": True,
            "ruleType": "OTHER_THEATRE_16TH",
            "priority": "CRITICAL",
            "badge": f"📅 16TH SHOW ADDED ({cinema_name or 'Other Theatre'})",
            "cinema": cinema_name or "Other Chennai Multiplex",
            "date": show_date or "16th"
        }

    return {
        "eligible": False,
        "ruleType": "FILTERED_OUT",
        "priority": "NONE",
        "badge": "IGNORED",
        "cinema": cinema_name,
        "date": show_date
    }

def fetch_url(url, headers=None, retries=0):
    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    }
    if headers:
        default_headers.update(headers)
    req = urllib.request.Request(url, headers=default_headers)
    try:
        with urllib.request.urlopen(req, timeout=CONFIG["TIMEOUT"]) as resp:
            return resp.status, resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        if retries < CONFIG["MAX_RETRIES"]:
            time.sleep((retries + 1) * 1.0)
            return fetch_url(url, headers=headers, retries=retries + 1)
        return 0, str(e)

def post_json(url, json_data, headers=None):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    payload = json.dumps(json_data).encode("utf-8") if isinstance(json_data, (dict, list)) else json_data.encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=CONFIG["TIMEOUT"]) as resp:
            return resp.status
    except Exception as e:
        print(f"[Alert] POST error to {url}: {e}")
        return 0

def send_telegram(ticket):
    token = CONFIG["TELEGRAM_BOT_TOKEN"]
    chat_id = CONFIG["TELEGRAM_CHAT_ID"]
    if not token or not chat_id:
        return
    is_last_rows = ticket.get("ruleType") == "LAST_5_ROWS_LATE_RELEASE"
    is_basera = ticket.get("ruleType") == "BASERA_MALL_EXCLUSIVE"
    
    if is_last_rows:
        header = f"🚨💺 *LAST 5 ROWS TICKETS OPENED: {ticket.get('cinema', '').upper()} (16TH SHOW)!* 🚨"
    elif is_basera:
        header = "🚨 *BASERA MALL EXCLUSIVE: DUNE 3 TICKETS!* 🚨"
    else:
        header = "🚨 *16TH SHOW ADDED: OTHER THEATRE TICKETS!* 🚨"

    text = (
        f"{header}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎬 *Movie:* {ticket['title']}\n"
        f"🎯 *Filter Match:* {ticket.get('badge')}\n"
        f"🏛️ *Cinema:* {ticket.get('cinema')}\n"
        f"📅 *Show Date:* {ticket.get('showDate')}\n"
        + (f"💺 *Monitored Rows:* {ticket['rows']}\n" if ticket.get('rows') else "") +
        f"🎞️ *Format:* {ticket.get('format', 'IMAX Laser')}\n"
        f"📍 *Platform:* {ticket.get('platform')}\n"
        f"🎟️ *Status:* *{ticket.get('status')}*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔗 [CLICK TO BOOK IMMEDIATELY]({ticket['url']})\n"
        f"⚡ Arrakis Radar Watcher • {datetime.now().strftime('%H:%M:%S')}"
    )
    post_json(f"https://api.telegram.org/bot{token}/sendMessage", {
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
    is_last_rows = ticket.get("ruleType") == "LAST_5_ROWS_LATE_RELEASE"
    is_basera = ticket.get("ruleType") == "BASERA_MALL_EXCLUSIVE"

    if is_last_rows:
        headline = f"🚨💺 @everyone **LAST 5 ROWS TICKETS JUST OPENED AT {ticket.get('cinema', '').upper()} (16TH SHOW)!** 🎟️"
        color = 0xff0055
    elif is_basera:
        headline = "🚨 @everyone **BASERA MALL TICKETS LIVE! BOOK NOW!** 🏛️"
        color = 0xe5a93c
    else:
        headline = "🚨 @everyone **NEW 16TH SHOW DETECTED AT OTHER THEATRE!** 📅"
        color = 0x06b6d4

    payload = {
        "content": headline,
        "embeds": [{
            "title": f"🔥 {ticket['title']} — {ticket.get('cinema')}",
            "url": ticket["url"],
            "description": f"⚡ **Filter Match:** `{ticket.get('badge')}`\nBooking live now on **{ticket['platform']}**!",
            "color": color,
            "fields": [
                {"name": "🏛️ Cinema", "value": ticket.get("cinema", "Basera Mall"), "inline": True},
                {"name": "📅 Show Date", "value": ticket.get("showDate", "Open"), "inline": True},
                {"name": "🎞️ Format", "value": ticket.get("format", "IMAX Laser"), "inline": True},
                {"name": "🎟️ Status", "value": f"🟢 **{ticket['status']}**", "inline": True}
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
    is_rows_ag = ticket.get("ruleType") in ["ROWS_A_TO_G_RELEASE", "LAST_5_ROWS_LATE_RELEASE"]
    is_basera = ticket.get("ruleType") == "BASERA_MALL_EXCLUSIVE"

    if is_rows_ag:
        raw_title = f"ROWS A-G OPENED: {ticket.get('cinema', 'PALAZZO/LUXE')} (16TH)!"
        tags = "seat,rotating_light,fire,star"
    elif is_basera:
        raw_title = "BASERA MALL DUNE 3 TICKETS LIVE!"
        tags = "rotating_light,star,ticket,fire"
    else:
        raw_title = f"16TH SHOW ADDED: {ticket.get('cinema', 'CHENNAI')}!"
        tags = "calendar,ticket,movie_camera"

    clean_title = re.sub(r'[^\x00-\x7F]', '', raw_title).strip()
    headers = {
        "Title": clean_title,
        "Priority": "urgent",
        "Tags": tags,
        "Click": ticket["url"]
    }
    body = f"{ticket.get('badge')}: {ticket['title']} ({ticket.get('format', 'IMAX')}). Tap to book!"
    post_json(f"https://ntfy.sh/{topic}", body, headers=headers)
    print(f"[Alert/Ntfy] Push sent to topic '{topic}'!")

def send_ntfy_heartbeat(matches_count=0):
    if not CONFIG.get("SEND_HEARTBEAT"):
        return
    topic = CONFIG["NTFY_TOPIC"].replace("https://ntfy.sh/", "").strip()
    if not topic:
        return
    now_str = datetime.now().strftime("%H:%M")
    runner = "GitHub Actions Cloud" if os.getenv("GITHUB_ACTIONS") else "Local Python Daemon"
    title = f"Arrakis Radar: Heartbeat OK ({now_str} IST)"
    clean_title = re.sub(r'[^\x00-\x7F]', '', title).strip()
    body = (
        f"[{runner}] Active sweep at {now_str} IST. Matches detected: {matches_count}. Radar operational."
        if matches_count > 0
        else f"[{runner}] 5-min sweep at {now_str} IST. Standing by. Monitored: Basera Mall (all dates), 16th shows, Rows A-G (Palazzo & Luxe)."
    )
    headers = {
        "Title": clean_title,
        "Priority": "low",
        "Tags": "satellite,white_check_mark,clock",
        "Click": "https://chendur12x.github.io/i-wanna-build-a-poll-app/"
    }
    try:
        post_json(f"https://ntfy.sh/{topic}", body, headers=headers)
        print(f"[Heartbeat/Ntfy] Low-priority heartbeat dispatched to ntfy.sh/{topic}!")
    except Exception as e:
        print(f"[Heartbeat/Ntfy] Failed to dispatch heartbeat: {e}")

def send_voice_call(ticket):
    is_rows_ag = ticket.get("ruleType") in ["ROWS_A_TO_G_RELEASE", "LAST_5_ROWS_LATE_RELEASE"]
    is_basera = ticket.get("ruleType") == "BASERA_MALL_EXCLUSIVE"

    if is_rows_ag:
        msg = f"Urgent seat alert! Desired rows A to G tickets have just opened up at {ticket.get('cinema', 'cinema')} for the 16th show! Open app and book immediately!"
    elif is_basera:
        msg = "Urgent ticket alert! Dune 3 tickets are now live at Basera Mall Chennai. Check notifications and book immediately!"
    else:
        msg = f"Urgent ticket alert! A new 16th show has just been added at {ticket.get('cinema', 'Chennai multiplex')}. Check notifications to book now!"

    # 1. Twilio Voice Call
    sid = CONFIG["TWILIO_ACCOUNT_SID"]
    token = CONFIG["TWILIO_AUTH_TOKEN"]
    from_num = CONFIG["TWILIO_FROM_NUMBER"]
    to_num = CONFIG["TO_PHONE_NUMBER"]

    if sid and token and from_num and to_num:
        print(f"[Call/Twilio] 📞 Initiating phone call to {to_num}...")
        twiml = f"<Response><Pause length='1'/><Say voice='Polly.Aditi' language='en-IN'>{msg}</Say><Pause length='1'/><Say voice='Polly.Aditi' language='en-IN'>{msg}</Say></Response>"
        import base64
        import urllib.parse
        auth_str = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("utf-8")
        headers = {
            "Authorization": f"Basic {auth_str}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = urllib.parse.urlencode({
            "To": to_num,
            "From": from_num,
            "Twiml": twiml
        }).encode("utf-8")
        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                print(f"[Call/Twilio] Phone call placed! Status: {resp.status}")
        except Exception as e:
            print(f"[Call/Twilio] Phone call failed: {e}")

    # 2. CallMeBot Free Telegram Voice Call
    tg_user = CONFIG["CALLMEBOT_TELEGRAM_USER"].replace("@", "").strip()
    if tg_user:
        print(f"[Call/CallMeBot] 📞 Triggering Telegram voice call to @{tg_user}...")
        import urllib.parse
        call_url = f"https://api.callmebot.com/start.php?user=@{tg_user}&text={urllib.parse.quote(msg)}&lang=en-US-Standard-B"
        fetch_url(call_url)
        print(f"[Call/CallMeBot] Telegram voice call dispatched!")

def dispatch_alerts(ticket):
    key = f"{ticket['platform']}_{ticket['title']}_{ticket.get('cinema', '')}_{ticket.get('showDate', '')}".lower()
    key = re.sub(r'[^a-z0-9_]', '_', key)
    if key in NOTIFIED_KEYS:
        print(f"[Deduplication] Already notified for '{key}', skipping duplicate.")
        return False

    NOTIFIED_KEYS.add(key)
    save_state(NOTIFIED_KEYS)

    print(f"\n🚨🚨🚨 [TICKETS DETECTED: {ticket.get('badge')}] 🚨🚨🚨")
    print(json.dumps(ticket, indent=2))
    send_telegram(ticket)
    send_discord(ticket)
    send_ntfy(ticket)
    send_voice_call(ticket)
    return True

def poll_district():
    log_prefix = "[District]"
    start = time.time()
    city = CONFIG["CITY"]
    keyword = CONFIG["MOVIE_KEYWORD"]

    explore_urls = [
        f"https://www.district.in/movies/{city}",
        "https://www.district.in/movies/"
    ]
    html = ""
    for u in explore_urls:
        status, content = fetch_url(u)
        if status == 200 and len(content) > 500:
            html = content
            break

    if not html:
        print(f"{log_prefix} Could not reach district catalog.")
        return []

    movie_slugs = list(set(re.findall(r'/movies/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)', html)))
    matched = [s for s in movie_slugs if keyword in s.lower()]
    elapsed = int((time.time() - start) * 1000)
    print(f"{log_prefix} Scanned {len(movie_slugs)} titles | Matched '{keyword}': {len(matched)} in {elapsed}ms")

    discoveries = []
    for slug in matched:
        movie_url = f"https://www.district.in/movies/{slug}"
        status, m_html = fetch_url(movie_url)
        if status != 200:
            continue

        title = re.sub(r'-movie-tickets.*$', '', slug).replace("-", " ").upper()
        is_booking_open = bool(re.search(r'book\s*tickets?|available|filling\s*fast', m_html, re.I))
        has_imax = "IMAX" in m_html or "imax" in slug.lower()

        matched_shows = []
        # Check Basera
        if "basera" in m_html.lower():
            eval_res = evaluate_show_eligibility("PVR INOX Basera Mall (ECR)", "Live on District")
            if eval_res["eligible"]:
                matched_shows.append(eval_res)

        # Check 16th shows
        date_matches = re.findall(r'(?:16th\s+[A-Za-z]+|[A-Za-z]+\s+16th|2026-12-16|2026-[0-9]{2}-16)', m_html, re.I)
        for dm in set(date_matches):
            eval_res = evaluate_show_eligibility("Chennai Multiplex", dm)
            if eval_res["eligible"]:
                matched_shows.append(eval_res)

        for show in matched_shows:
            item = {
                "title": title,
                "platform": "District (Zomato)",
                "url": movie_url,
                "city": city,
                "cinema": show.get("cinema", "Basera Mall"),
                "showDate": show.get("date", "Live Now"),
                "format": "IMAX Laser (1.90:1)" if has_imax else "Standard",
                "status": "BOOKINGS LIVE NOW!" if is_booking_open else "Showtimes Listed",
                "ruleType": show.get("ruleType"),
                "badge": show.get("badge")
            }
            discoveries.append(item)
            dispatch_alerts(item)

    return discoveries

def poll_bms():
    log_prefix = "[BookMyShow]"
    city = CONFIG["CITY"]
    keyword = CONFIG["MOVIE_KEYWORD"]
    headers = {"Referer": "https://in.bookmyshow.com/", "x-bms-app": "web"}
    if CONFIG["BMS_COOKIE"]:
        headers["Cookie"] = CONFIG["BMS_COOKIE"]

    targets = [
        {"name": "PVR INOX Basera ECR", "url": "https://in.bookmyshow.com/cinemas/che/pvr-inox-basera-ecr-chennai/buytickets/BSER/", "cinema": "PVR INOX Basera Mall (ECR)", "is_basera": True},
        {"name": "PVR INOX Palazzo IMAX (16th Watcher)", "url": "https://in.bookmyshow.com/cinemas/che/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/buytickets/PALZ/", "cinema": "PVR INOX Palazzo IMAX (Nexus Vijaya)", "watch_last_rows": True},
        {"name": "PVR INOX Luxe IMAX (16th Watcher)", "url": "https://in.bookmyshow.com/cinemas/che/pvr-inox-luxe-phoenix-marketcity-velachery-chennai/buytickets/INLU/", "cinema": "PVR INOX Luxe IMAX (Phoenix Marketcity)", "watch_last_rows": True}
    ]

    discoveries = []
    for tgt in targets:
        status, html = fetch_url(tgt["url"], headers=headers)
        if status != 200:
            continue
        has_movie = keyword in html.lower()

        if tgt.get("watch_last_rows"):
            has_16th = bool(re.search(r'(?:16th|-16\b|16-|\b16\b)', html, re.I))
            if has_movie or has_16th:
                has_rows_ag = bool(re.search(r'(?:rows?[-_\s]*[a-g]\b|elite|₹?508(?:\.34)?|prime|top\s*rows?|available|filling\s*fast)', html, re.I))
                eval_res = evaluate_show_eligibility(tgt["cinema"], "16th Show", "Palazzo & Luxe 16th Radar", {
                    "is_rows_a_g_open": has_rows_ag,
                    "is_late_release": True,
                    "rows": "Desired Rows A–G (Elite Tier ₹508.34)"
                })
                if eval_res["eligible"]:
                    item = {
                        "title": keyword.upper(),
                        "platform": "BookMyShow",
                        "url": tgt["url"],
                        "city": city,
                        "cinema": tgt["cinema"],
                        "showDate": "16th Show",
                        "rows": eval_res.get("rows"),
                        "format": "IMAX Laser (1.90:1)",
                        "status": "DESIRED ROWS A–G TICKETS OPENED!" if has_rows_ag else "16TH SHOW LIVE ON BMS!",
                        "ruleType": eval_res["ruleType"],
                        "badge": eval_res["badge"]
                    }
                    discoveries.append(item)
                    dispatch_alerts(item)
        elif tgt.get("is_basera") and has_movie:
            eval_res = evaluate_show_eligibility("PVR INOX Basera Mall (ECR)", "Live Booking")
            item = {
                "title": keyword.upper(),
                "platform": "BookMyShow",
                "url": tgt["url"],
                "city": city,
                "cinema": "PVR INOX Basera Mall (ECR)",
                "showDate": "Live Now",
                "format": "IMAX Laser",
                "status": "BASERA MALL BMS SHOWS LIVE!",
                "ruleType": eval_res["ruleType"],
                "badge": eval_res["badge"]
            }
            discoveries.append(item)
            dispatch_alerts(item)

    return discoveries

def run_sweep():
    print(f"\n========================================================")
    print(f"[Arrakis Radar] Mission-Critical Sweep Started at {datetime.now().strftime('%H:%M:%S')}")
    print(f"Rules: 1) Basera Mall (All Dates) | 2) Palazzo & Luxe (16th Last 5 Rows Radar) | 3) Other (16th Shows)")
    print(f"Active Persisted State Keys: {len(NOTIFIED_KEYS)}")
    print(f"========================================================")

    res_district = poll_district()
    res_bms = poll_bms()
    all_res = res_district + res_bms
    if not all_res:
        print("[Arrakis Radar] No qualifying bookings matching rules yet. Standing by...")

    send_ntfy_heartbeat(len(all_res))
    return all_res

def test_alert():
    print("[Test] Sending simulated test alerts for Basera Mall, 16th Shows, and Last 5 Rows...")
    mock_basera = {
        "title": "DUNE 3: MESSIAH (CHENNAI IMAX LASER)",
        "platform": "District & BookMyShow [TEST]",
        "url": "https://in.bookmyshow.com/cinemas/che/pvr-inox-basera-ecr-chennai/buytickets/BSER/",
        "city": CONFIG["CITY"],
        "cinema": "PVR INOX Basera Mall (ECR, Injambakkam)",
        "showDate": "Opening Week (All Shows)",
        "format": "IMAX Laser (1.90:1)",
        "status": "BASERA MALL BOOKINGS LIVE NOW!",
        "ruleType": "BASERA_MALL_EXCLUSIVE",
        "badge": "🏛️ BASERA MALL (ALL DATES)"
    }
    mock_16th = {
        "title": "DUNE 3: MESSIAH (CHENNAI IMAX LASER)",
        "platform": "District & BookMyShow [TEST]",
        "url": "https://in.bookmyshow.com/explore/movies-chennai",
        "city": CONFIG["CITY"],
        "cinema": "PVR INOX Palazzo IMAX (Vadapalani)",
        "showDate": "December 16th (Fan Preview)",
        "format": "IMAX Laser (1.90:1)",
        "status": "16TH SHOW ADDED AT PALAZZO!",
        "ruleType": "OTHER_THEATRE_16TH",
        "badge": "📅 16TH SHOW EXCLUSIVE (PVR Palazzo IMAX)"
    }
    mock_rows_ag = {
        "title": "DUNE 3: MESSIAH (CHENNAI IMAX LASER)",
        "platform": "BookMyShow & District [ROWS A-G RADAR]",
        "url": "https://in.bookmyshow.com/cinemas/che/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/buytickets/PALZ/",
        "city": CONFIG["CITY"],
        "cinema": "PVR INOX Palazzo IMAX (Nexus Vijaya Vadapalani)",
        "showDate": "December 16th (Close to Showtime)",
        "rows": "Desired Rows A–G (Elite ₹508.34 - Top/Back Rows)",
        "format": "IMAX Laser (1.90:1)",
        "status": "DESIRED ROWS A–G (ELITE SEATS) UNLOCKED ONLINE!",
        "ruleType": "ROWS_A_TO_G_RELEASE",
        "badge": "💺 ROWS A–G RELEASED (Palazzo IMAX - 16th)"
    }
    dispatch_alerts(mock_basera)
    dispatch_alerts(mock_16th)
    dispatch_alerts(mock_rows_ag)
    print("[Test] Completed simulated test alerts.")

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
