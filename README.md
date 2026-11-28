# 🪐 ARRAKIS RADAR — Mission-Critical Cinema Surveillance
> Autonomous, mission-critical ticket radar targeting **Dune 3 / Dune Messiah** on **District (by Zomato)** and **BookMyShow (BMS)** deployed 24/7 on **GitHub Actions**.

---

## 🎯 Active Surveillance Mission Rules

The surveillance logic has been narrowed down to the following strict criteria:

1. 🏛️ **Basera Mall Alone (Unconditional Priority)**:
   - Targets **PVR INOX Basera Mall** (East Coast Road, Injambakkam — ECR Hub) alone.
   - Any showtime, date, or format at Basera Mall triggers an immediate high-priority alert.
2. 📅 **Other Theatres (16th Shows Alone)**:
   - For all other Chennai multiplexes (e.g. Palazzo Vadapalani, Luxe Phoenix Marketcity, etc.), surveillance is strictly narrowed down to **newly added shows on the 16th alone**.
   - Any show on dates other than the 16th is filtered out.
3. 💺 **Last 5 Rows / Late Release Radar (Palazzo & Luxe 16th Alone)**:
   - Always actively monitors for seats in the **last 5 rows** (Rows P, Q, R, S, T, and VIP Recliners) opening close to showtime for **PVR INOX Palazzo IMAX (Screen 10)** and **PVR INOX Luxe IMAX (Screen 11)** on the **16th**.
   - Detects late unblocking of held/VIP seats and instantly triggers an `ULTRA_CRITICAL` multi-channel alert and automated phone call.
4. 🛡️ **Mission-Critical Deduplication**:
   - Persists detected show hashes in `.cache/seen_shows.json` across GitHub Actions executions using `actions/cache@v4`.
   - Prevents duplicate alert spam while guaranteeing zero missed new show additions.

---

## ⚡ Deployment & Hosting

### ☁️ GitHub Actions (Active Production Deployment)

The poller is deployed as a GitHub Actions cron workflow at:
[`./.github/workflows/dune-imax-poller.yml`](.github/workflows/dune-imax-poller.yml)

- **Execution Cadence**: Runs automatically every 5 minutes (`cron: '*/5 * * * *'`).
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
| `NTFY_TOPIC` | ntfy.sh topic for instant phone push | *(optional)* |
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
- **Discord**: Rich embedded webhook cards with color-coded badges (Gold for Basera Mall, Cyan for 16th Shows).

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
