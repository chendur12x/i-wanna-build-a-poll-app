# 🪐 ARRAKIS RADAR — Chennai IMAX Ticket Tracker & Poller
> Real-time autonomous ticket tracker and poller **dedicated specifically to Chennai IMAX screens** on **District (by Zomato)** and **BookMyShow (BMS)** targeting **Dune 3 / Dune Messiah**, with instant high-priority alerts via **Telegram**, **ntfy.sh (mobile push)**, **Discord**, and **in-browser acoustic sirens**.

---

## ⚡ Key Highlights (Chennai IMAX Exclusive)

- **Dedicated Chennai Surveillance**: Specifically narrowed down to track Chennai's premier IMAX auditoriums:
  - 📍 **PVR INOX Palazzo IMAX** (The Nexus Vijaya Mall, Vadapalani — Screen 10)
  - 📍 **PVR INOX Luxe IMAX** (Phoenix Marketcity, Velachery — Screen 11)
  - 📍 **PVR INOX Basera IMAX** (East Coast Road, Injambakkam — ECR Hub)
- **Dual-Platform Poller**: Queries live listings and showtime availability on both **District** (`district.in`) and **BookMyShow** (`in.bookmyshow.com/explore/movies-chennai`).
- **IMAX Laser & Xenon Filter**: Pre-configured to track 4K IMAX with Laser (1.90:1) and IMAX 70mm showtimes the exact second bookings open.
- **100% Free Autonomous Cloud Hosting**: Ready-to-go GitHub Actions cron workflow (`.github/workflows/dune-imax-poller.yml`) that runs in the cloud every 5 minutes around the clock without keeping your computer on.
- **Zero-Signup Instant Phone Push**: Supports [ntfy.sh](https://ntfy.sh) — download the free app, subscribe to your secret topic (e.g. `dune3-chennai-imax`), and get instant push alerts with high-priority ringtones!
- **Telegram & Discord Integrations**: Instant messages with direct booking links straight to your chat.
- **Interactive Web Dashboard**: Cinematic Dune-inspired interface with live animated radar sweep, Hans Zimmer Dune horn acoustic synthesizer, and 1-click test triggers.

---

## 🚀 Live Web Dashboard Preview

To view and interact with the live dashboard:
👉 **[Open Arrakis Radar Web Dashboard](https://antigravity.luch.dev/site/5bb2e433-9e8d-4222-bbcf-f831ae6d9580/832fb02ac2c9c49e2c256a41/)**

---

## 🏛️ Chennai IMAX Auditoriums Monitored

| Venue | Location | Screen & Projection | Direct BMS Link |
| :--- | :--- | :--- | :--- |
| **PVR INOX Palazzo IMAX** | The Nexus Vijaya Mall, Vadapalani | Screen 10 • 4K IMAX with Laser (1.90:1) • ~70×39 ft Screen • 12-Channel Sound | [Palazzo BMS Page](https://in.bookmyshow.com/buytickets/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/cinema-che-PALZ-MT/) |
| **PVR INOX Luxe IMAX** | Phoenix Marketcity, Velachery | Screen 11 • Luxury Recliner & Club • Dual IMAX Setup • Landmark Venue | [Luxe BMS Page](https://in.bookmyshow.com/buytickets/pvr-inox-luxe-phoenix-marketcity-velachery-chennai/cinema-che-INLU-MT/) |
| **PVR INOX Basera IMAX** | East Coast Road (ECR), Injambakkam | 5-Screen Multiplex Hub • 4K IMAX with Laser | [Chennai Explore](https://in.bookmyshow.com/explore/movies-chennai) |

---

## ☁️ 100% Free Cloud Hosting (Never Miss a Ticket Drop)

You don't need to leave your computer running 24/7. Use any of the free cloud hosting options below:

### Option 1: GitHub Actions (Recommended — 100% Free Forever)
GitHub Actions provides free monthly runner minutes to execute scheduled background workflows.

1. **Connect your repository**: Tap the **GitHub mark at the top of the chat** to connect a repository — your entire project code and commit history will be pushed there automatically.
2. **Add your notification secrets**:
   In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - `TELEGRAM_BOT_TOKEN`: Your bot token from `@BotFather`
   - `TELEGRAM_CHAT_ID`: Your chat ID from `@userinfobot`
   - `NTFY_TOPIC`: Your secret push topic (e.g. `dune3-chennai-imax`)
   - `CITY`: `chennai` (already defaulted!)
   - `CINEMA_FILTER`: `palazzo, luxe, basera` (already defaulted!)
   - `MOVIE_KEYWORD`: `dune` (or any custom movie name)
3. **Done!** The workflow in `.github/workflows/dune-imax-poller.yml` will automatically poll District and BookMyShow every 5 minutes. When tickets drop in Chennai, your phone will ring instantly with direct booking URLs.

---

### Option 2: Cloudflare Workers (Edge Cron Trigger)
1. Sign up for a free account at [workers.cloudflare.com](https://workers.cloudflare.com).
2. Create a new Worker and paste the contents of [`worker.js`](worker.js).
3. Under **Settings** → **Triggers** → **Cron Triggers**, add: `*/2 * * * *` (runs every 2 minutes).
4. Add your secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NTFY_TOPIC`, `CITY=chennai`) under **Settings** → **Variables**.

---

### Option 3: Local Background Runner or Free VPS / Render
You can also run the poller directly on your machine or any free container service:

#### Using Node.js:
```bash
# Run a single Chennai IMAX sweep check
node poller.js --once

# Dispatch a test notification to verify your phone rings
node poller.js --test-alert

# Run continuous background loop (every 60s)
node poller.js
```

#### Using Python 3 (Zero external pip dependencies required):
```bash
# Single Chennai sweep
python3 poller.py --once

# Test notification
python3 poller.py --test-alert

# Continuous loop
python3 poller.py
```

---

## 🔔 How to Set Up Instant Notifications

### 1. Telegram Bot (Instant Push to Phone & Watch)
1. Open Telegram and message [`@BotFather`](https://t.me/BotFather).
2. Send `/newbot`, choose a name (e.g. `ChennaiImaxBot`), and copy the HTTP API Token.
3. Message your new bot `/start`.
4. Message [`@userinfobot`](https://t.me/userinfobot) to get your numeric `Id`.
5. Enter both in the Web Dashboard or save them as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### 2. ntfy.sh (Fastest — No Account Needed!)
1. Install the free **ntfy** app from Google Play or the Apple App Store (or use the web app at [ntfy.sh](https://ntfy.sh)).
2. Tap `+ Subscribe` and enter a unique topic name, like `dune3-chennai-imax`.
3. Set `NTFY_TOPIC=dune3-chennai-imax`.
4. When Chennai tickets drop, ntfy will push an urgent, loud alert directly to your lock screen!

### 3. Discord Webhook
1. In your Discord server: `Server Settings → Integrations → Webhooks → New Webhook`.
2. Copy the Webhook URL and paste into `DISCORD_WEBHOOK_URL`.

---

## 📁 Repository Structure

```text
├── index.html                           # Interactive Chennai IMAX Dashboard & Visual Radar
├── poller.js                            # Pure Node.js Chennai IMAX poller (0 dependencies)
├── poller.py                            # Pure Python 3 Chennai IMAX poller (standard library)
├── server.js                            # Local HTTP server & API proxy
├── worker.js                            # Cloudflare Worker script for serverless edge cron
├── package.json                         # Node.js project manifest & scripts
├── .github/
│   └── workflows/
│       └── dune-imax-poller.yml        # GitHub Actions 24/7 free scheduled poller
└── README.md                            # Complete setup & deployment guide
```

---

## 🍿 Dune 3: Messiah
*"He who controls the spice controls the universe. He who controls the poller gets opening-night Chennai IMAX tickets at Palazzo and Luxe."*
