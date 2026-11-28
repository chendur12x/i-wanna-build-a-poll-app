/**
 * ARRAKIS RADAR - Dune 3 IMAX Ticket Tracker & Poller
 * Mission-Critical Edition:
 * - Dedicated focus: Basera Mall alone (all shows/dates)
 * - Other theatres: 16th show dates alone (newly added shows only)
 * - Persistent deduplication across GitHub Actions runs
 * - Multi-platform scraping (District by Zomato & BookMyShow)
 * - Zero external npm dependencies (pure Node.js standard library)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Ensure .cache directory exists for state persistence
const CACHE_DIR = path.join(__dirname, '.cache');
const STATE_FILE = path.join(CACHE_DIR, 'seen_shows.json');
const STEP_SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY || '';

// Load configuration with env defaults
let config = {
  MOVIE_KEYWORD: (process.env.MOVIE_KEYWORD || 'dune').trim().toLowerCase(),
  CITY: (process.env.CITY || 'chennai').trim().toLowerCase(),
  FORMAT_REQUIRED: (process.env.FORMAT_REQUIRED || 'IMAX').trim().toUpperCase(),
  
  // Mission Critical Surveillance Filters:
  // 1. Primary Cinema: Basera Mall (unconditionally alerted for all shows)
  PRIMARY_CINEMA: (process.env.PRIMARY_CINEMA || 'basera').trim().toLowerCase(),
  // 2. Secondary Theatres: Date 16th alone
  SECONDARY_CINEMA_DATE: (process.env.SECONDARY_CINEMA_DATE || '16').trim(),
  
  POLL_INTERVAL_SECONDS: parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10),
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || '12000', 10),
  MAX_RETRIES: 3,

  // Notification Integrations
  TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  TELEGRAM_CHAT_ID: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  DISCORD_WEBHOOK_URL: (process.env.DISCORD_WEBHOOK_URL || '').trim(),
  NTFY_TOPIC: (process.env.NTFY_TOPIC || 'chendur12-dune-radar').trim(),
  SEND_HEARTBEAT: process.env.SEND_HEARTBEAT !== 'false',
  BMS_COOKIE: (process.env.BMS_COOKIE || '').trim(),

  // Phone Call Alerts: Twilio Voice Call (Cellular phone call)
  TWILIO_ACCOUNT_SID: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
  TWILIO_AUTH_TOKEN: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
  TWILIO_FROM_NUMBER: (process.env.TWILIO_FROM_NUMBER || '').trim(),
  TO_PHONE_NUMBER: (process.env.TO_PHONE_NUMBER || '').trim(),

  // Phone Call Alerts: CallMeBot Telegram Voice Call (100% Free automated voice call)
  CALLMEBOT_TELEGRAM_USER: (process.env.CALLMEBOT_TELEGRAM_USER || 'chendur12').trim()
};

// Merge config.json if present locally
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...fileConfig };
  } catch (e) {
    console.error('[Config] Failed to parse config.json:', e.message);
  }
}

/**
 * Persistent State Management (Deduplication across GitHub Actions runs)
 */
function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.seenKeys)) {
        console.log(`[State] Loaded ${parsed.seenKeys.length} previously seen show keys from ${STATE_FILE}`);
        return new Set(parsed.seenKeys);
      }
    }
  } catch (err) {
    console.warn(`[State] Warning: Could not read state cache (${err.message}). Starting with fresh state.`);
  }
  return new Set();
}

function savePersistedState(stateSet) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const data = {
      lastUpdated: new Date().toISOString(),
      count: stateSet.size,
      seenKeys: Array.from(stateSet)
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[State] Persisted ${stateSet.size} show keys to ${STATE_FILE}`);
  } catch (err) {
    console.error(`[State] Failed to persist state cache:`, err.message);
  }
}

// Global Set of notified show IDs
const notifiedSet = loadPersistedState();

/**
 * Mission Critical Rule Evaluation
 * 
 * Rules:
 * 1. Ultra-Priority: Last 5 Rows Radar at Palazzo & Luxe (16th Shows) - detects held/VIP seats opening close to showtime
 * 2. Basera Mall alone: Any show at Basera Mall is eligible (all dates).
/**
 * Strict Eligibility Filter:
 * ONLY monitors PVR INOX Palazzo & Luxe IMAX on the 16th for Desired Rows A-G (Elite Tier).
 * Check happens EVERY TIME without any close-to-showtime restriction.
 */
function evaluateShowEligibility(cinemaName, showDate, venueDetails = '', extraContext = {}) {
  const cinemaText = `${cinemaName || ''} ${venueDetails || ''}`.toLowerCase();
  const dateStr = String(showDate || '').trim().toLowerCase();

  const isPalazzoOrLuxe = cinemaText.includes('palazzo') || cinemaText.includes('luxe') || cinemaText.includes('palz') || cinemaText.includes('inlu');
  const is16th = /(?:^|\D)16(?:th)?(?:\D|$)|-16\b|16-|\b16\b/i.test(dateStr);

  const isRowsAGOpen = Boolean(
    extraContext.isRowsAGOpen ||
    extraContext.isEliteTierOpen ||
    /(?:rows?[-_\s]*[a-g]\b|elite|₹?508(?:\.34)?)/i.test(`${venueDetails || ''} ${extraContext.rawSeats || ''} ${extraContext.status || ''}`)
  );

  if (isPalazzoOrLuxe && is16th && isRowsAGOpen) {
    return {
      eligible: true,
      ruleType: 'ROWS_A_TO_G_RELEASE',
      priority: 'ULTRA_CRITICAL',
      badge: `💺 ROWS A–G RELEASED (${cinemaName})`,
      cinema: cinemaName,
      date: showDate || '16th',
      rows: extraContext.rows || 'Desired Rows A–G (Elite Tier ₹508.34)',
      reason: 'Detected open seats in desired Rows A-G (Elite tier) on 16th'
    };
  }

  return {
    eligible: false,
    ruleType: 'FILTERED_OUT',
    priority: 'NONE',
    badge: 'IGNORED',
    cinema: cinemaName,
    date: showDate,
    reason: `Filtered: Only Palazzo & Luxe on 16th for Rows A-G are monitored`
  };
}

/**
 * Perform HTTPS GET request with automatic redirect and retry
 */
function fetchUrl(targetUrl, headers = {}, retryCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...headers
      },
      timeout: config.REQUEST_TIMEOUT_MS
    };

    const req = https.request(options, (res) => {
      // Follow HTTP 301 / 302 redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectTarget = res.headers.location;
        if (!redirectTarget.startsWith('http')) {
          redirectTarget = new URL(redirectTarget, targetUrl).toString();
        }
        return resolve(fetchUrl(redirectTarget, headers, retryCount));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      if (retryCount < config.MAX_RETRIES) {
        const backoff = (retryCount + 1) * 1000;
        console.warn(`[Network] Timeout fetching ${targetUrl}. Retrying in ${backoff}ms (${retryCount + 1}/${config.MAX_RETRIES})...`);
        setTimeout(() => resolve(fetchUrl(targetUrl, headers, retryCount + 1)), backoff);
      } else {
        reject(new Error(`Timeout fetching ${targetUrl} after ${config.MAX_RETRIES} attempts`));
      }
    });

    req.on('error', (err) => {
      if (retryCount < config.MAX_RETRIES) {
        const backoff = (retryCount + 1) * 1000;
        console.warn(`[Network] Error fetching ${targetUrl}: ${err.message}. Retrying in ${backoff}ms...`);
        setTimeout(() => resolve(fetchUrl(targetUrl, headers, retryCount + 1)), backoff);
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

/**
 * Perform HTTP/HTTPS POST request with JSON body
 */
function postJson(targetUrl, jsonBody, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const bodyStr = typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...customHeaders
      },
      timeout: config.REQUEST_TIMEOUT_MS
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout posting to ${targetUrl}`));
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Dispatch Telegram Alert with Mission-Critical Formatting
 */
async function sendTelegramAlert(ticketInfo) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

  const isRowsAG = ticketInfo.ruleType === 'ROWS_A_TO_G_RELEASE' || ticketInfo.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';
  
  let headerTitle = '';
  if (isRowsAG) {
    headerTitle = `🚨💺 *DESIRED ROWS A–G TICKETS OPENED: ${ticketInfo.cinema.toUpperCase()} (16TH SHOW)!* 🚨`;
  } else if (isBasera) {
    headerTitle = '🚨 *BASERA MALL EXCLUSIVE: DUNE 3 TICKETS!* 🚨';
  } else {
    headerTitle = '🚨 *16TH SHOW ADDED: OTHER THEATRE TICKETS!* 🚨';
  }

  const message = [
    headerTitle,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎬 *Movie:* ${ticketInfo.title}`,
    `🎯 *Filter Match:* ${ticketInfo.badge}`,
    `🏛️ *Cinema:* ${ticketInfo.cinema || 'PVR INOX'}`,
    `📅 *Show Date:* ${ticketInfo.showDate || '16th Show'}`,
    ticketInfo.rows ? `💺 *Monitored Rows:* ${ticketInfo.rows}` : '',
    ticketInfo.showTime ? `⏰ *Showtime:* ${ticketInfo.showTime}` : '',
    `🎞️ *Format:* ${ticketInfo.format || 'IMAX Laser'}`,
    `📍 *Platform:* ${ticketInfo.platform}`,
    `🎟️ *Status:* *${ticketInfo.status}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🔗 [👉 CLICK HERE TO BOOK TICKETS IMMEDIATELY](${ticketInfo.url})`,
    `⚡ Arrakis Radar Mission-Critical Watcher • ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
  ].filter(Boolean).join('\n');

  try {
    const res = await postJson(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: config.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      }
    );
    console.log(`[Alert/Telegram] Sent successfully! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Telegram] Failed to send: ${e.message}`);
  }
}

/**
 * Dispatch Discord Webhook Alert
 */
async function sendDiscordAlert(ticketInfo) {
  if (!config.DISCORD_WEBHOOK_URL) return;

  const isRowsAG = ticketInfo.ruleType === 'ROWS_A_TO_G_RELEASE' || ticketInfo.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';

  let embedColor = 0x06b6d4;
  let alertHeadline = '';

  if (isRowsAG) {
    embedColor = 0xff0055; // High-urgency magenta/red
    alertHeadline = `🚨💺 @everyone **DESIRED ROWS A–G TICKETS JUST OPENED AT ${ticketInfo.cinema.toUpperCase()} FOR 16TH!** 🎟️`;
  } else if (isBasera) {
    embedColor = 0xe5a93c;
    alertHeadline = '🚨 @everyone **BASERA MALL TICKETS ARE LIVE! BOOK NOW!** 🏛️';
  } else {
    embedColor = 0x06b6d4;
    alertHeadline = '🚨 @everyone **NEW 16TH SHOW DETECTED AT OTHER THEATRE!** 📅';
  }

  const payload = {
    content: alertHeadline,
    embeds: [
      {
        title: `🔥 ${ticketInfo.title} — ${ticketInfo.cinema}`,
        url: ticketInfo.url,
        description: `⚡ **Filter Match:** \`${ticketInfo.badge}\`\nBooking is active right now on **${ticketInfo.platform}**!`,
        color: embedColor,
        fields: [
          { name: '🏛️ Cinema', value: ticketInfo.cinema || 'Cinema', inline: true },
          { name: '📅 Show Date', value: ticketInfo.showDate || '16th', inline: true },
          ...(ticketInfo.rows ? [{ name: '💺 Monitored Rows', value: ticketInfo.rows, inline: true }] : []),
          { name: '🎞️ Format', value: ticketInfo.format || 'IMAX Laser', inline: true },
          { name: '📍 Platform', value: ticketInfo.platform, inline: true },
          { name: '🎟️ Status', value: `🟢 **${ticketInfo.status}**`, inline: true },
          { name: '⚡ Priority', value: ticketInfo.priority || 'CRITICAL', inline: true }
        ],
        footer: {
          text: `Arrakis Radar • Mission Critical Watcher • ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await postJson(config.DISCORD_WEBHOOK_URL, payload);
    console.log(`[Alert/Discord] Webhook delivered! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Discord] Failed to send: ${e.message}`);
  }
}

/**
 * Dispatch ntfy.sh Instant Mobile Push
 */
async function sendNtfyAlert(ticketInfo) {
  if (!config.NTFY_TOPIC) return;
  const topic = config.NTFY_TOPIC.replace(/^https?:\/\/ntfy\.sh\//, '').trim();
  if (!topic) return;

  const isRowsAG = ticketInfo.ruleType === 'ROWS_A_TO_G_RELEASE' || ticketInfo.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';

  let rawTitle = '';
  let tags = 'rotating_light,ticket,fire';

  if (isRowsAG) {
    rawTitle = `ROWS A-G OPENED: ${ticketInfo.cinema || 'PALAZZO/LUXE'} (16TH)!`;
    tags = 'seat,rotating_light,fire,star';
  } else if (isBasera) {
    rawTitle = 'BASERA MALL DUNE 3 TICKETS LIVE!';
    tags = 'rotating_light,star,ticket,fire';
  } else {
    rawTitle = `16TH SHOW ADDED: ${ticketInfo.cinema || 'CHENNAI'}!`;
    tags = 'calendar,ticket,movie_camera';
  }

  const cleanTitle = rawTitle.replace(/[^\x00-\x7F]/g, '').trim();

  try {
    const res = await postJson(
      `https://ntfy.sh/${topic}`,
      `${ticketInfo.badge}: ${ticketInfo.title} (${ticketInfo.format || 'IMAX'}). Tap to book instantly!`,
      {
        'Title': cleanTitle,
        'Priority': 'urgent',
        'Tags': tags,
        'Click': ticketInfo.url
      }
    );
    console.log(`[Alert/Ntfy] Mobile push sent to topic '${topic}'! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Ntfy] Failed to send: ${e.message}`);
  }
}

/**
 * Dispatch Low-Priority ntfy.sh Heartbeat Notification
 * Verifies to the user that GitHub Actions is actively running every 5 minutes in the cloud
 */
async function sendNtfyHeartbeat(matchesCount = 0) {
  if (!config.SEND_HEARTBEAT || !config.NTFY_TOPIC) return;
  const topic = config.NTFY_TOPIC.replace(/^https?:\/\/ntfy\.sh\//, '').trim();
  if (!topic) return;

  const istTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const runner = process.env.GITHUB_ACTIONS ? 'GitHub Actions Cloud' : 'Local Node Daemon';
  const runId = process.env.GITHUB_RUN_ID ? ` #${process.env.GITHUB_RUN_ID}` : '';

  const cleanTitle = `Arrakis Radar: Heartbeat OK (${istTime} IST)`.replace(/[^\x00-\x7F]/g, '').trim();
  const body = matchesCount > 0
    ? `[${runner}${runId}] Active sweep at ${istTime} IST. Rows A-G matches detected: ${matchesCount}.`
    : `[${runner}${runId}] 5-min sweep at ${istTime} IST. Monitoring ONLY Rows A-G (Palazzo & Luxe, 16th). Standing by.`;

  try {
    const res = await postJson(
      `https://ntfy.sh/${topic}`,
      body,
      {
        'Title': cleanTitle,
        'Priority': 'low', // Low priority: silent, non-intrusive 5-minute heartbeat
        'Tags': 'satellite,white_check_mark,clock',
        'Click': 'https://chendur12x.github.io/i-wanna-build-a-poll-app/'
      }
    );
    console.log(`[Heartbeat/Ntfy] Low-priority heartbeat dispatched to ntfy.sh/${topic} (HTTP ${res.status})`);
  } catch (err) {
    console.warn(`[Heartbeat/Ntfy] Failed to dispatch heartbeat: ${err.message}`);
  }
}

/**
 * Perform HTTP/HTTPS POST request with Form URL Encoded body (for Twilio)
 */
function postForm(targetUrl, formBody, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const bodyStr = typeof formBody === 'string' ? formBody : new URLSearchParams(formBody).toString();
    const protocol = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...customHeaders
      },
      timeout: config.REQUEST_TIMEOUT_MS
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout posting form to ${targetUrl}`));
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Dispatch Automated Voice Call Alert (Twilio Cellular Call & CallMeBot Telegram Call)
 */
async function sendVoiceCallAlert(ticketInfo) {
  const isRowsAG = ticketInfo.ruleType === 'ROWS_A_TO_G_RELEASE' || ticketInfo.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';

  let spokenMessage = '';
  if (isRowsAG) {
    spokenMessage = `Urgent seat alert! Desired rows A to G tickets have just opened up at ${ticketInfo.cinema} for the 16th show! Open your app and book your seats immediately!`;
  } else if (isBasera) {
    spokenMessage = `Urgent ticket alert! Dune 3 tickets are now live at Basera Mall Chennai. Check your notifications and book tickets immediately!`;
  } else {
    spokenMessage = `Urgent ticket alert! A new 16th show has just been added at ${ticketInfo.cinema || 'Chennai multiplex'}. Check your notifications to book now!`;
  }

  // 1. Twilio Cellular Voice Call
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER && config.TO_PHONE_NUMBER) {
    console.log(`[Call/Twilio] 📞 Dialing phone call to ${config.TO_PHONE_NUMBER}...`);
    try {
      const twiml = `<Response><Pause length="1"/><Say voice="Polly.Aditi" language="en-IN">${spokenMessage}</Say><Pause length="1"/><Say voice="Polly.Aditi" language="en-IN">${spokenMessage}</Say></Response>`;
      const authHeader = 'Basic ' + Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');
      const params = new URLSearchParams({
        To: config.TO_PHONE_NUMBER,
        From: config.TWILIO_FROM_NUMBER,
        Twiml: twiml
      });

      const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Calls.json`;
      const res = await postForm(url, params.toString(), {
        'Authorization': authHeader
      });
      console.log(`[Call/Twilio] Phone call initiated successfully! HTTP ${res.status}`);
    } catch (err) {
      console.error(`[Call/Twilio] Failed to initiate voice call: ${err.message}`);
    }
  }

  // 2. CallMeBot Telegram Automated Voice Call (Free)
  if (config.CALLMEBOT_TELEGRAM_USER) {
    const rawUser = config.CALLMEBOT_TELEGRAM_USER.replace(/^@/, '').trim();
    console.log(`[Call/CallMeBot] 📞 Triggering Telegram voice call to @${rawUser}...`);
    try {
      const shortMsg = isRowsAG
        ? `Urgent! Desired rows A to G tickets just opened at Palazzo or Luxe IMAX for 16th show! Book now!`
        : (isBasera ? `Urgent! Dune 3 tickets are now live at Basera Mall Chennai. Book immediately!` : `Urgent! New 16th show added at Chennai multiplex. Book now!`);
      const callUrl = `https://api.callmebot.com/start.php?user=@${rawUser}&text=${encodeURIComponent(shortMsg)}&lang=en-US-Standard-B`;
      const res = await fetchUrl(callUrl);
      console.log(`[Call/CallMeBot] Telegram voice call triggered! HTTP ${res.status}`);
    } catch (err) {
      console.error(`[Call/CallMeBot] Voice call error: ${err.message}`);
    }
  }
}

/**
 * Dispatch alert across all channels with persistent deduplication
 */
async function notifyAll(ticketInfo) {
  // Compute deterministic unique hash key for this specific show
  const rawKey = [
    ticketInfo.platform || 'any',
    ticketInfo.title || 'movie',
    ticketInfo.cinema || 'cinema',
    ticketInfo.showDate || 'anydate',
    ticketInfo.showTime || 'anytime'
  ].join('_').toLowerCase().replace(/[^a-z0-9_]/g, '_');

  if (notifiedSet.has(rawKey)) {
    console.log(`[Deduplication] Already notified for '${rawKey}'. Skipping duplicate alert.`);
    return false;
  }

  // Record into Set and persist
  notifiedSet.add(rawKey);
  savePersistedState(notifiedSet);

  console.log('\n🚨🚨🚨 [MISSION-CRITICAL ALERT TRIGGERED] 🚨🚨🚨');
  console.log(`Rule Matched : ${ticketInfo.badge}`);
  console.log(`Movie        : ${ticketInfo.title}`);
  console.log(`Cinema       : ${ticketInfo.cinema}`);
  console.log(`Date         : ${ticketInfo.showDate}`);
  console.log(`URL          : ${ticketInfo.url}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await Promise.allSettled([
    sendTelegramAlert(ticketInfo),
    sendDiscordAlert(ticketInfo),
    sendNtfyAlert(ticketInfo),
    sendVoiceCallAlert(ticketInfo)
  ]);

  return true;
}

/**
 * Poll District (by Zomato)
 * Directly queries live District seat-layout API for Palazzo & Luxe on 2026-12-16
 * and checks every single seat in Rows A, B, C, D, E, F, G (SeatStatus === '0').
 */
async function getDistrictGuestToken(deviceId) {
  try {
    const res = await postJson('https://www.district.in/gw/auth/skip_login', {}, {
      'x-device-id': deviceId,
      'Origin': 'https://www.district.in',
      'Referer': 'https://www.district.in/'
    });
    const parsed = JSON.parse(res.data || '{}');
    return parsed.token?.guest_token || '';
  } catch (err) {
    console.warn(`[District] Guest token warning: ${err.message}`);
    return '';
  }
}

async function checkDistrictSessionRowsAG(cinemaId, sessionId, guestToken, deviceId) {
  try {
    const res = await postJson('https://www.district.in/gw/consumer/movies/v1/select-seat', {
      cinemaId: Number(cinemaId),
      sessionId: String(sessionId)
    }, {
      'x-guest-token': guestToken,
      'x-access-token': guestToken,
      'x-device-id': deviceId,
      'x-app-type': 'ed_web',
      'Origin': 'https://www.district.in',
      'Referer': 'https://www.district.in/'
    });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data || '{}');
    const areas = data.seatLayout?.colAreas?.objArea || [];
    const desiredRows = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const openSeats = [];
    for (const area of areas) {
      for (const row of area.objRow || []) {
        const rowId = String(row.PhyRowId || '').trim().toUpperCase();
        if (!desiredRows.has(rowId)) continue;
        for (const seat of row.objSeat || []) {
          if (String(seat.SeatStatus) === '0') {
            openSeats.push(`${rowId}${seat.displaySeatNumber || seat.seatNumber}`);
          }
        }
      }
    }
    return openSeats;
  } catch (err) {
    console.warn(`[District] Seat map check error (sid=${sessionId}): ${err.message}`);
    return [];
  }
}

async function pollDistrict() {
  const logPrefix = '[District]';
  const start = Date.now();
  console.log(`${logPrefix} Scanning district.in (${config.CITY}) for "${config.MOVIE_KEYWORD}" — Palazzo & Luxe 16th Rows A–G...`);

  try {
    const exploreUrls = [
      `https://www.district.in/movies/${config.CITY}`,
      `https://www.district.in/movies/`
    ];

    let html = '';
    for (const url of exploreUrls) {
      try {
        const res = await fetchUrl(url);
        if (res.status === 200 && res.data.length > 500) {
          html = res.data;
          break;
        }
      } catch (err) {
        console.warn(`${logPrefix} Notice while fetching ${url}: ${err.message}`);
      }
    }

    const movieMatches = html ? (html.match(/\/movies\/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)/g) || []) : [];
    const uniqueSlugs = [...new Set(movieMatches.map(m => m.replace('/movies/', '')))];

    // Strictly filter for target movie AND target city (chennai)
    let matchedSlugs = uniqueSlugs.filter(slug => {
      const lower = slug.toLowerCase();
      return lower.includes(config.MOVIE_KEYWORD) && lower.includes(`-in-${config.CITY}`);
    });

    // Guaranteed direct fallback for Dune 3 Chennai if catalog filter misses it
    if (matchedSlugs.length === 0 && config.MOVIE_KEYWORD === 'dune' && config.CITY === 'chennai') {
      matchedSlugs = ['dune-part-three-movie-tickets-in-chennai-MV207332'];
    }

    console.log(`${logPrefix} Catalog scanned: ${uniqueSlugs.length} titles | Matched "${config.MOVIE_KEYWORD}" in ${config.CITY}: ${matchedSlugs.length} (${Date.now() - start}ms)`);

    const discoveries = [];
    const deviceId = 'arrakis-radar-' + Math.random().toString(36).slice(2, 10);
    let guestToken = '';

    for (const slug of matchedSlugs) {
      const movieUrl = `https://www.district.in/movies/${slug}?fromdate=2026-12-16`;
      try {
        const moviePage = await fetchUrl(movieUrl);
        if (moviePage.status !== 200) continue;

        const pageHtml = moviePage.data;
        const movieTitle = slug.replace(/-movie-tickets.*$/, '').replace(/-/g, ' ').toUpperCase();

        const idx = pageHtml.indexOf('__NEXT_DATA__');
        if (idx === -1) continue;
        const sIdx = pageHtml.indexOf('>', idx) + 1;
        const eIdx = pageHtml.indexOf('</script>', sIdx);
        let parsedNext = null;
        try {
          parsedNext = JSON.parse(pageHtml.slice(sIdx, eIdx));
        } catch (_) { continue; }

        const moviesState = parsedNext?.props?.pageProps?.initialState?.movies;
        const sessObj = Object.values(moviesState?.movieSessions || {})[0];
        if (!sessObj || sessObj.searchDate !== '2026-12-16') {
          console.log(`${logPrefix} No 2026-12-16 sessions listed yet for ${movieTitle}.`);
          continue;
        }

        const cinemas = [
          ...(sessObj.pageData?.nearbyCinemas || []),
          ...(sessObj.pageData?.farCinemas || [])
        ];

        // ONLY Palazzo & Luxe (Phoenix Market City Velachery)
        const targetCinemas = cinemas.filter(c => {
          const name = c.cinemaInfo?.name || '';
          return /palazzo|nexus vijaya|luxe|phoenix market city|jazz cinemas/i.test(name);
        });

        console.log(`${logPrefix} Found ${targetCinemas.length} target cinemas (Palazzo/Luxe) on 2026-12-16.`);

        for (const cinema of targetCinemas) {
          const cName = cinema.cinemaInfo?.name || 'Palazzo / Luxe IMAX';
          const sessions = cinema.sessions || [];

          for (const session of sessions) {
            const totalAvail = (session.areas || []).reduce((sum, a) => sum + (a.sAvail || 0), 0);
            const showTimeStr = (session.showTime || '').split('T')[1] || session.showTime || '';

            if (totalAvail === 0) {
              console.log(`${logPrefix} ${cName} (${showTimeStr}): 0 seats available. Skipping seat-map call.`);
              continue;
            }

            if (!guestToken) {
              guestToken = await getDistrictGuestToken(deviceId);
            }

            const openSeatsAG = guestToken
              ? await checkDistrictSessionRowsAG(session.cid, session.sid, guestToken, deviceId)
              : [];

            console.log(`${logPrefix} ${cName} (${showTimeStr}): Total avail=${totalAvail} | Rows A–G open=${openSeatsAG.length} [${openSeatsAG.join(', ') || 'none'}]`);

            if (openSeatsAG.length > 0) {
              const evalRes = evaluateShowEligibility(cName, '2026-12-16', `Rows ${openSeatsAG.join(', ')}`, {
                isRowsAGOpen: true,
                rows: `Rows A–G Open: ${openSeatsAG.join(', ')}`
              });

              if (evalRes.eligible) {
                const discovery = {
                  title: movieTitle,
                  platform: 'District (Zomato)',
                  url: movieUrl,
                  city: config.CITY,
                  cinema: cName,
                  showDate: '2026-12-16',
                  showTime: showTimeStr,
                  rows: evalRes.rows,
                  format: 'IMAX Laser (1.90:1)',
                  status: `ROWS A–G OPEN (${openSeatsAG.length} SEATS): ${openSeatsAG.join(', ')}`,
                  ruleType: evalRes.ruleType,
                  badge: evalRes.badge,
                  priority: evalRes.priority,
                  timestamp: new Date().toISOString()
                };
                discoveries.push(discovery);
                await notifyAll(discovery);
              }
            }
          }
        }
      } catch (err) {
        console.error(`${logPrefix} Error inspecting ${slug}:`, err.message);
      }
    }

    return discoveries;
  } catch (e) {
    console.error(`${logPrefix} Fetch error:`, e.message);
    return [];
  }
}

/**
 * Poll BookMyShow
 * ONLY monitors Palazzo & Luxe IMAX on the 16th for Desired Rows A-G (Elite Tier).
 * Runs unconditionally every sweep (no close-to-showtime restriction).
 */
async function pollBookMyShow() {
  const logPrefix = '[BookMyShow]';
  const start = Date.now();
  console.log(`${logPrefix} Checking Palazzo & Luxe BMS pages for "${config.MOVIE_KEYWORD}" (16th • Rows A-G)...`);

  const headers = {
    'Referer': 'https://in.bookmyshow.com/',
    'x-bms-app': 'web'
  };
  if (config.BMS_COOKIE) {
    headers['Cookie'] = config.BMS_COOKIE;
  }

  const targets = [
    {
      name: 'PVR INOX Palazzo IMAX Vadapalani (16th & Rows A-G Radar)',
      url: `https://in.bookmyshow.com/cinemas/che/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/buytickets/PALZ/`,
      cinemaName: 'PVR INOX Palazzo IMAX (Nexus Vijaya)'
    },
    {
      name: 'PVR INOX Luxe IMAX Velachery (16th & Rows A-G Radar)',
      url: `https://in.bookmyshow.com/cinemas/che/pvr-inox-luxe-phoenix-marketcity-velachery-chennai/buytickets/INLU/`,
      cinemaName: 'PVR INOX Luxe IMAX (Phoenix Marketcity)'
    }
  ];

  const discoveries = [];

  for (const target of targets) {
    try {
      const res = await fetchUrl(target.url, headers);
      const duration = Date.now() - start;

      if (res.status === 403) {
        console.log(`${logPrefix} Cloudflare bot protection active on ${target.name} (${duration}ms). District layer active.`);
        continue;
      }

      if (res.status === 200 && res.data.length > 500) {
        const html = res.data;
        const movieRegex = new RegExp(config.MOVIE_KEYWORD, 'i');
        const hasMovie = movieRegex.test(html);
        const has16th = /(?:16th|-16\b|16-|\b16\b)/i.test(html);

        if (hasMovie && has16th) {
          const hasRowsAG = /(?:rows?[-_\s]*[a-g]\b|elite|₹?508(?:\.34)?)/i.test(html);
          const evalRes = evaluateShowEligibility(target.cinemaName, '16th Show', 'Palazzo & Luxe 16th Rows A-G Radar', {
            isRowsAGOpen: hasRowsAG,
            isEliteTierOpen: hasRowsAG,
            rows: 'Desired Rows A–G (Elite Tier ₹508.34)'
          });

          if (evalRes.eligible) {
            const discovery = {
              title: config.MOVIE_KEYWORD.toUpperCase(),
              platform: 'BookMyShow',
              url: target.url,
              city: config.CITY,
              cinema: target.cinemaName,
              showDate: '16th Show',
              rows: evalRes.rows,
              format: 'IMAX Laser (1.90:1)',
              status: 'DESIRED ROWS A–G TICKETS OPENED ONLINE!',
              ruleType: evalRes.ruleType,
              badge: evalRes.badge,
              priority: evalRes.priority,
              timestamp: new Date().toISOString()
            };
            discoveries.push(discovery);
            await notifyAll(discovery);
          }
        }
      }
    } catch (e) {
      console.log(`${logPrefix} Check notice for ${target.name}: ${e.message}`);
    }
  }

  return discoveries;
}

/**
 * Main Polling Sweep
 */
async function runSweep() {
  const sweepStart = new Date();
  console.log(`\n========================================================`);
  console.log(`[Arrakis Radar] Rows A–G Sweep Started at ${sweepStart.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`Target Movie : "${config.MOVIE_KEYWORD}" | City: ${config.CITY.toUpperCase()}`);
  console.log(`Surveillance : ONLY Desired Rows A–G (Elite Tier ₹508.34) at Palazzo & Luxe on 16th (Every Sweep)`);
  console.log(`Persisted IDs: ${notifiedSet.size} active show keys`);
  console.log(`========================================================`);

  const [districtResults, bmsResults] = await Promise.all([
    pollDistrict(),
    pollBookMyShow()
  ]);

  const all = [...districtResults, ...bmsResults];

  if (all.length === 0) {
    console.log(`[Arrakis Radar] No open seats in Desired Rows A–G at Palazzo or Luxe (16th) yet. Standing by...`);
  } else {
    console.log(`[Arrakis Radar] ✅ Found ${all.length} matching Rows A–G openings!`);
  }

  // Write GitHub Step Summary if running in GitHub Actions
  if (STEP_SUMMARY_FILE) {
    try {
      const summaryMd = [
        `## 🪐 Arrakis Radar — Rows A–G Sweep Summary`,
        `- **Timestamp:** ${new Date().toISOString()}`,
        `- **Target Movie:** \`${config.MOVIE_KEYWORD}\` (${config.CITY.toUpperCase()})`,
        `- **Active Rule:** 💺 **Desired Rows A–G (Elite ₹508.34)** at **Palazzo & Luxe IMAX (16th)** — checked unconditionally every 5 mins`,
        `- **Persisted Show Keys:** ${notifiedSet.size}`,
        `- **Rows A–G Openings Detected:** ${all.length}`,
        ...(all.length > 0 ? [
          `\n### 🎟️ Detected Shows`,
          `| Movie | Cinema | Date | Platform | Match Rule | URL |`,
          `| :--- | :--- | :--- | :--- | :--- | :--- |`,
          ...all.map(s => `| **${s.title}** | ${s.cinema} | ${s.showDate} | ${s.platform} | \`${s.badge}\` | [Book Now](${s.url}) |`)
        ] : ['\n> *No open seats in Rows A–G at Palazzo or Luxe (16th) yet.*'])
      ].join('\n');

      fs.appendFileSync(STEP_SUMMARY_FILE, summaryMd + '\n\n', 'utf8');
    } catch (summaryErr) {
      console.warn(`[Summary] Failed to write step summary: ${summaryErr.message}`);
    }
  }

  // 5-minute low priority heartbeat push via ntfy.sh (proves radar is running in GitHub Actions)
  await sendNtfyHeartbeat(all.length);

  return all;
}

/**
 * Run Test Alert to verify notification pipeline (ONLY Rows A-G)
 */
async function testAlert() {
  console.log('[Test] Triggering test alert for Desired Rows A–G at Palazzo IMAX (16th)...');

  const mockRowsAG = {
    title: 'DUNE 3: MESSIAH (CHENNAI IMAX LASER)',
    platform: 'BookMyShow & District [ROWS A-G RADAR]',
    url: 'https://in.bookmyshow.com/cinemas/che/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/buytickets/PALZ/',
    city: config.CITY,
    cinema: 'PVR INOX Palazzo IMAX (Nexus Vijaya Vadapalani)',
    showDate: 'December 16th',
    showTime: '07:45 PM IMAX Laser',
    rows: 'Desired Rows A–G (Elite ₹508.34 - Top/Back Rows)',
    format: 'IMAX Laser (1.90:1)',
    status: 'DESIRED ROWS A–G (ELITE SEATS) UNLOCKED ONLINE!',
    ruleType: 'ROWS_A_TO_G_RELEASE',
    badge: '💺 ROWS A–G RELEASED (Palazzo IMAX - 16th)',
    priority: 'ULTRA_CRITICAL'
  };

  await notifyAll(mockRowsAG);
  console.log('[Test] Rows A–G test alert dispatched! Check Telegram, Discord, and Ntfy app.');
}

// CLI Execution Handler
const args = process.argv.slice(2);
const loopArg = args.find(a => a.startsWith('--loop-minutes='));

if (args.includes('--test-alert')) {
  testAlert().then(() => process.exit(0));
} else if (args.includes('--once')) {
  runSweep().then(() => {
    console.log('[Arrakis Radar] Single sweep completed successfully.');
    process.exit(0);
  }).catch((err) => {
    console.error('[Arrakis Radar] Sweep fatal error:', err);
    process.exit(1);
  });
} else if (loopArg) {
  const minutes = parseInt(loopArg.split('=')[1], 10) || 180;
  const intervalSec = parseInt(process.env.POLL_INTERVAL_SECONDS || '300', 10);
  const endAt = Date.now() + minutes * 60 * 1000;
  console.log(`[Arrakis Radar] Starting exact ${intervalSec}s (5-min) loop for ${minutes} minutes...`);
  (async () => {
    while (Date.now() < endAt) {
      try {
        await runSweep();
      } catch (err) {
        console.error('[Arrakis Radar] Loop sweep error:', err);
      }
      const remainingMs = endAt - Date.now();
      if (remainingMs <= intervalSec * 1000) break;
      console.log(`[Arrakis Radar] Sleeping ${intervalSec}s until next 5-minute sweep...`);
      await new Promise(r => setTimeout(r, intervalSec * 1000));
    }
    console.log('[Arrakis Radar] Loop window finished cleanly. Handing off...');
    process.exit(0);
  })();
} else {
  // Continuous Background Polling Loop
  console.log(`[Arrakis Radar] Starting background poller loop every ${config.POLL_INTERVAL_SECONDS}s...`);
  runSweep();
  setInterval(runSweep, config.POLL_INTERVAL_SECONDS * 1000);
}

module.exports = {
  runSweep,
  testAlert,
  evaluateShowEligibility,
  loadPersistedState,
  savePersistedState,
  config
};
