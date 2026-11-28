# 🪐 ARRAKIS RADAR — Mission-Critical Cinema Surveillance
> Autonomous, mission-critical ticket radar targeting **Dune 3 / Dune Messiah** on **District (by Zomato)** and **BookMyShow (BMS)** deployed 24/7 on **GitHub Actions**.

---

## 🎯 Active Surveillance Mission Rule

Surveillance is strictly locked onto **one single target**:

1. 💺 **Desired Rows A–G Radar (Palazzo & Luxe 16th Alone — Checked Every Sweep)**:
   - On BookMyShow & District for **PVR INOX Palazzo IMAX (Screen 10)** and **PVR INOX Luxe IMAX (Screen 11)**, the screen is at the bottom of the seating chart, making **Rows A through G** the coveted **Elite Tier (₹508.34)** top/rear rows (farthest from screen with optimal IMAX sightlines and acoustics).
   - Surveillance actively inspects seat availability specifically for **Rows A, B, C, D, E, F, G** on **16th shows** unconditionally on **every single sweep** (no close-to-showtime restriction).
   - Instantly triggers an `ULTRA_CRITICAL` multi-channel alert and automated phone call to `@chendur12`.
2. 🛡️ **Mission-Critical Deduplication**:
   - Persists detected show hashes in `.cache/seen_shows.json` across GitHub Actions executions using `actions/cache@v4`.
   - Prevents duplicate alert spam while guaranteeing zero missed seat openings.

---

## ⚡ Deployment & Hosting

### ☁️ GitHub Actions (Active Production Deployment)

The poller is deployed as a continuous self-chaining 5-minute loop on GitHub Actions:
[`./.github/workflows/dune-imax-poller.yml`](.github/workflows/dune-imax-poller.yml)

- **Execution Cadence**: Polls every **exact 5 minutes** (`300s`) inside a 300-minute runner loop (`--loop-minutes=300`) and automatically chains the next 5-hour cycle via `workflow_dispatch` (with `cron: '*/5 * * * *'` as watchdog backup) so it never gets delayed by GitHub's cron queue.
- **Free & Serverless**: 100% free runner minutes on GitHub Actions.
- **Manual Trigger**: Can be executed on-demand from the **Actions** tab with custom parameters or test alerts via `workflow_dispatch`.

#### Configured GitHub Secrets
In GitHub repository **Settings** → **Secrets and variables** → **Actions**:
| Secret | Description | Default |
| :--- | :--- | :--- |
| `MOVIE_KEYWORD` | Keyword to match in movie titles | `dune` |
| `CITY` | Target city | `chennai` |
| `PRIMARY_CINEMA` | Primary cinema monitored for all dates | `basera` |
| `SECONDARY_CINEMA_DATE`| Date filter for other theatres | `16` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from `@BotFather` | *(optional)* |
| `TELEGRAM_CHAT_ID` | Telegram chat ID from `@userinfobot` | *(optional)* |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL | *(optional)* |
| `NTFY_TOPIC` | ntfy.sh topic for instant phone push & 5-min heartbeat | `chendur12-dune-radar` |
| `BMS_COOKIE` | Optional BookMyShow session cookie | *(optional)* |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID for cellular phone calls | *(optional)* |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | *(optional)* |
| `TWILIO_FROM_NUMBER` | Twilio phone number (e.g. `+1234567890`) | *(optional)* |
| `TO_PHONE_NUMBER` | Your cellular phone number to ring (e.g. `+919876543210`) | *(optional)* |
| `CALLMEBOT_TELEGRAM_USER` | Your Telegram username for **100% Free automated voice call** | *(optional)* |

---

## 🚀 Local Execution & Verification

### Using Node.js:
```bash
# 1. Single mission-critical sweep (used by GitHub Actions)
node poller.js --once

# 2. Test notification pipeline (dispatches simulated Basera Mall & 16th Show alerts)
node poller.js --test-alert

# 3. Continuous local background loop (polls every 60 seconds)
node poller.js
```

### Using Python 3 (Zero pip dependencies):
```bash
# Single sweep
python3 poller.py --once

# Test alert
python3 poller.py --test-alert
```

---

## 🔔 Alert Channels Supported
- **Telegram Bot**: Formatted Markdown messages with direct booking links.
- **ntfy.sh**: Instant mobile notifications with ringtones on iOS & Android without requiring an account.
  - **5-Min Cloud Heartbeat**: Automatically sends a silent, low-priority ping every 5 minutes verifying that GitHub Actions is alive and running in the cloud (Topic: [`chendur12-dune-radar`](https://ntfy.sh/chendur12-dune-radar)).
- **Discord**: Rich embedded webhook cards with color-coded badges (Gold for Basera Mall, Cyan for 16th Shows, Magenta for Rows A-G).

---

## 📁 Repository Structure
```text
├── .github/
│   └── workflows/
│       └── dune-imax-poller.yml        # GitHub Actions 24/7 scheduled poller
├── poller.js                            # Pure Node.js mission-critical poller
├── poller.py                            # Pure Python 3 mission-critical poller
├── server.js                            # Local HTTP server & API proxy
├── worker.js                            # Cloudflare Worker script
├── index.html                           # Radar web dashboard
└── README.md                            # Surveillance mission documentation
```
