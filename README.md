# 🪐 ARRAKIS RADAR — Dune 3 IMAX Ticket Tracker & Poller
> Real-time ticket tracker and autonomous poller for **District (by Zomato)** and **BookMyShow (BMS)** targeting **Dune 3 / Dune Messiah IMAX** tickets across India, with instant high-priority alerts via **Telegram**, **ntfy.sh (mobile push)**, **Discord**, and **in-browser acoustic sirens**.

---

## ⚡ Key Highlights

- **Dual-Platform Poller**: Queries live listings and showtime availability on both **District** (`district.in`) and **BookMyShow** (`in.bookmyshow.com`).
- **IMAX & Laser Filter**: Specifically tracks IMAX Laser (1.43:1 / 1.90:1), IMAX 70mm, 4DX, and ICE screens across all major cinema chains (PVR INOX, Prasads, Cinepolis, Broadway).
- **100% Free Autonomous Cloud Hosting**: Ready-to-go GitHub Actions cron workflow (`.github/workflows/dune-imax-poller.yml`) that runs in the cloud every 5 minutes around the clock without keeping your computer on.
- **Zero-Signup Instant Phone Push**: Supports [ntfy.sh](https://ntfy.sh) — download the free app, subscribe to your secret topic, and get instant push alerts with high-priority ringtones!
- **Telegram & Discord Integrations**: Instant messages with direct booking links straight to your chat.
- **Interactive Web Dashboard**: Cinematic Dune-inspired interface with animated radar sweep, Hans Zimmer Dune horn acoustic synthesizer, and 1-click test triggers.

---

## 🚀 Live Web Dashboard Preview

To view and interact with the live dashboard:
👉 **[Open Arrakis Radar Web Dashboard](https://antigravity.luch.dev/site/5bb2e433-9e8d-4222-bbcf-f831ae6d9580/832fb02ac2c9c49e2c256a41/)**

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
   - `NTFY_TOPIC`: Your secret push topic (e.g. `dune3-imax-myradar-2026`)
   - `CITY`: `bengaluru` (or `mumbai`, `delhi-ncr`, `hyderabad`, `chennai`, etc.)
   - `MOVIE_KEYWORD`: `dune` (or any custom movie name)
3. **Done!** The workflow in `.github/workflows/dune-imax-poller.yml` will automatically poll District and BookMyShow every 5 minutes. When tickets drop, your phone will ring instantly with the direct booking URL.

---

### Option 2: Cloudflare Workers (Edge Cron Trigger)
1. Sign up for a free account at [workers.cloudflare.com](https://workers.cloudflare.com).
2. Create a new Worker and paste the contents of [`worker.js`](worker.js).
3. Under **Settings** → **Triggers** → **Cron Triggers**, add: `*/2 * * * *` (runs every 2 minutes).
4. Add your secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NTFY_TOPIC`) under **Settings** → **Variables**.

---

### Option 3: Local Background Runner or Free VPS / Render
You can also run the poller directly on your machine or any free container service:

#### Using Node.js:
```bash
# Run a single sweep check
node poller.js --once

# Dispatch a test notification to verify your phone rings
node poller.js --test-alert

# Run continuous background loop (every 60s)
node poller.js
```

#### Using Python 3 (Zero external pip dependencies required):
```bash
# Single sweep
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
2. Send `/newbot`, choose a name (e.g. `Dune3TicketBot`), and copy the HTTP API Token.
3. Message your new bot `/start`.
4. Message [`@userinfobot`](https://t.me/userinfobot) to get your numeric `Id`.
5. Enter both in the Web Dashboard or save them as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### 2. ntfy.sh (Fastest — No Account Needed!)
1. Install the free **ntfy** app from Google Play or the Apple App Store (or use the web app at [ntfy.sh](https://ntfy.sh)).
2. Tap `+ Subscribe` and enter a unique topic name, like `dune3-imax-radar-9921`.
3. Set `NTFY_TOPIC=dune3-imax-radar-9921`.
4. When tickets drop, ntfy will push an urgent, loud alert directly to your lock screen!

### 3. Discord Webhook
1. In your Discord server: `Server Settings → Integrations → Webhooks → New Webhook`.
2. Copy the Webhook URL and paste into `DISCORD_WEBHOOK_URL`.

---

## 🏙️ Supported IMAX Cities & Cinemas in India

- **Bengaluru**: PVR Forum Mall Koramangala IMAX (Laser), PVR Nexus Koramangala, PVR Vega City Bannerghatta Rd.
- **Mumbai**: PVR INOX Phoenix Palladium Lower Parel (Laser), INOX R City Ghatkopar, Cinepolis Viviana Thane.
- **Delhi-NCR**: PVR Vegas Mall Dwarka (Laser), PVR Select Citywalk Saket, PVR Logix City Centre Noida.
- **Hyderabad**: Prasads IMAX (Large Screen), PVR Inorbit Mall Cyberabad.
- **Chennai**: Palazzo Nexus Vijaya Mall Vadapalani, Luxe Phoenix Marketcity Velachery.
- **Pune**: PVR INOX The Pavilion Mall Senapati Bapat Road.
- **Kolkata**: INOX South City Mall.
- **Coimbatore**: Broadway Cinemas IMAX (Laser).
- **Ahmedabad**: PVR Acropolis Mall, Palladium Mall.

---

## 📁 Repository Structure

```text
├── index.html                           # Interactive Dune-themed Web Dashboard & Radar
├── poller.js                            # Pure Node.js multi-platform poller (0 dependencies)
├── poller.py                            # Pure Python 3 poller (standard library only)
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
*"He who controls the spice controls the universe. He who controls the poller gets opening-night IMAX tickets."*
