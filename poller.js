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
  NTFY_TOPIC: (process.env.NTFY_TOPIC || '').trim(),
  BMS_COOKIE: (process.env.BMS_COOKIE || '').trim(),

  // Phone Call Alerts: Twilio Voice Call (Cellular phone call)
  TWILIO_ACCOUNT_SID: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
  TWILIO_AUTH_TOKEN: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
  TWILIO_FROM_NUMBER: (process.env.TWILIO_FROM_NUMBER || '').trim(),
  TO_PHONE_NUMBER: (process.env.TO_PHONE_NUMBER || '').trim(),

  // Phone Call Alerts: CallMeBot Telegram Voice Call (100% Free automated voice call)
  CALLMEBOT_TELEGRAM_USER: (process.env.CALLMEBOT_TELEGRAM_USER || '').trim()
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
 * 1. Basera Mall alone: Any show at Basera Mall is eligible (all dates).
 * 2. Other theatres 16th alone: Shows at ANY other theatre are ONLY eligible if the show date is the 16th.
 * 3. Shows on any other date at other theatres are filtered out.
 */
function evaluateShowEligibility(cinemaName, showDate, venueDetails = '') {
  const cinemaText = `${cinemaName || ''} ${venueDetails || ''}`.toLowerCase();
  const dateStr = String(showDate || '').trim().toLowerCase();

  // Rule 1: Basera Mall (PVR INOX Basera / Basera Mall / Basera ECR)
  const isBasera = cinemaText.includes(config.PRIMARY_CINEMA) || cinemaText.includes('basera');
  if (isBasera) {
    return {
      eligible: true,
      ruleType: 'BASERA_MALL_EXCLUSIVE',
      priority: 'HIGH',
      badge: '🏛️ BASERA MALL (ALL DATES)',
      cinema: cinemaName || 'PVR INOX Basera Mall (ECR)',
      date: showDate || 'All Open Dates',
      reason: 'Matched Basera Mall primary surveillance'
    };
  }

  // Rule 2: Other Theatres - ONLY 16th show date
  // Regex strictly checks for 16th of any month (e.g. "16", "16th", "-16", "16-", "16 Dec", "Dec 16", "2026-12-16")
  const is16th = /(?:^|\D)16(?:th)?(?:\D|$)|-16\b|16-|\b16\b/i.test(dateStr);
  if (is16th) {
    return {
      eligible: true,
      ruleType: 'OTHER_THEATRE_16TH',
      priority: 'CRITICAL',
      badge: `📅 16TH SHOW ADDED (${cinemaName || 'Other Theatre'})`,
      cinema: cinemaName || 'Other Chennai Multiplex',
      date: showDate || '16th',
      reason: `Matched 16th show date at other theatre (${cinemaName || 'Venue'})`
    };
  }

  // Rule 3: Excluded
  return {
    eligible: false,
    ruleType: 'FILTERED_OUT',
    priority: 'NONE',
    badge: 'IGNORED',
    cinema: cinemaName,
    date: showDate,
    reason: `Filtered: Not Basera Mall and show date '${showDate || 'unknown'}' is not the 16th`
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

  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';
  const headerIcon = isBasera ? '🏛️' : '📅';
  const headerTitle = isBasera 
    ? '🚨 *BASERA MALL EXCLUSIVE: DUNE 3 TICKETS!* 🚨' 
    : '🚨 *16TH SHOW ADDED: OTHER THEATRE TICKETS!* 🚨';

  const message = [
    headerTitle,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎬 *Movie:* ${ticketInfo.title}`,
    `🎯 *Filter Match:* ${ticketInfo.badge}`,
    `🏛️ *Cinema:* ${ticketInfo.cinema || 'PVR INOX Basera'}`,
    `📅 *Show Date:* ${ticketInfo.showDate || 'Open Showings'}`,
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

  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';
  const embedColor = isBasera ? 0xe5a93c : 0x06b6d4; // Gold for Basera, Cyan for 16th
  const alertHeadline = isBasera
    ? '🚨 @everyone **BASERA MALL TICKETS ARE LIVE! BOOK NOW!** 🏛️'
    : '🚨 @everyone **NEW 16TH SHOW DETECTED AT OTHER THEATRE!** 📅';

  const payload = {
    content: alertHeadline,
    embeds: [
      {
        title: `🔥 ${ticketInfo.title} — ${ticketInfo.cinema}`,
        url: ticketInfo.url,
        description: `⚡ **Filter Match:** \`${ticketInfo.badge}\`\nBooking is active right now on **${ticketInfo.platform}**!`,
        color: embedColor,
        fields: [
          { name: '🏛️ Cinema', value: ticketInfo.cinema || 'Basera Mall', inline: true },
          { name: '📅 Show Date', value: ticketInfo.showDate || 'Open', inline: true },
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

  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';
  const rawTitle = isBasera
    ? 'BASERA MALL DUNE 3 TICKETS LIVE!'
    : `16TH SHOW ADDED: ${ticketInfo.cinema || 'CHENNAI'}!`;
  const cleanTitle = rawTitle.replace(/[^\x00-\x7F]/g, '').trim();

  try {
    const res = await postJson(
      `https://ntfy.sh/${topic}`,
      `${ticketInfo.badge}: ${ticketInfo.title} (${ticketInfo.format || 'IMAX'}). Tap to book instantly!`,
      {
        'Title': cleanTitle,
        'Priority': 'urgent',
        'Tags': isBasera ? 'rotating_light,star,ticket,fire' : 'calendar,ticket,movie_camera',
        'Click': ticketInfo.url
      }
    );
    console.log(`[Alert/Ntfy] Mobile push sent to topic '${topic}'! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Ntfy] Failed to send: ${e.message}`);
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
  const isBasera = ticketInfo.ruleType === 'BASERA_MALL_EXCLUSIVE';
  const spokenMessage = isBasera
    ? `Urgent ticket alert! Dune 3 tickets are now live at Basera Mall Chennai. Check your notifications and book tickets immediately!`
    : `Urgent ticket alert! A new 16th show has just been added at ${ticketInfo.cinema || 'Chennai multiplex'}. Check your notifications to book now!`;

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
      const callUrl = `https://api.callmebot.com/start.php?user=@${rawUser}&text=${encodeURIComponent(spokenMessage)}&lang=en-US-Standard-B`;
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
 * Extracts structured Next.js data to accurately evaluate cinema and show date
 */
async function pollDistrict() {
  const logPrefix = '[District]';
  const start = Date.now();
  console.log(`${logPrefix} Scanning district.in catalog for "${config.MOVIE_KEYWORD}" (City: ${config.CITY})...`);

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

    if (!html) {
      console.warn(`${logPrefix} Unable to retrieve movie listings from District.`);
      return [];
    }

    // Match all movie paths
    const movieMatches = html.match(/\/movies\/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)/g) || [];
    const uniqueSlugs = [...new Set(movieMatches.map(m => m.replace('/movies/', '')))];

    const matchedSlugs = uniqueSlugs.filter(slug => {
      return slug.toLowerCase().includes(config.MOVIE_KEYWORD);
    });

    console.log(`${logPrefix} Catalog scanned: ${uniqueSlugs.length} titles | Matched "${config.MOVIE_KEYWORD}": ${matchedSlugs.length} (${Date.now() - start}ms)`);

    const discoveries = [];

    for (const slug of matchedSlugs) {
      const movieUrl = `https://www.district.in/movies/${slug}`;
      try {
        const moviePage = await fetchUrl(movieUrl);
        if (moviePage.status !== 200) continue;

        const pageHtml = moviePage.data;
        const movieTitle = slug.replace(/-movie-tickets.*$/, '').replace(/-/g, ' ').toUpperCase();

        // 1. Try to extract Next.js __NEXT_DATA__ for deep structure
        const nextDataMatch = pageHtml.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
        let parsedNext = null;
        if (nextDataMatch) {
          try {
            parsedNext = JSON.parse(nextDataMatch[1]);
          } catch (_) {}
        }

        const isBookingOpen = /book\s*tickets?|available|filling\s*fast/i.test(pageHtml);
        const hasImax = /IMAX/i.test(pageHtml) || /IMAX/i.test(slug);

        // Check structured cinemas & dates if present
        let matchedShows = [];

        if (parsedNext && parsedNext.props && parsedNext.props.pageProps) {
          const moviesState = parsedNext.props.pageProps.initialState?.movies;
          const showDates = moviesState?.filtersData?.filters?.showDates || [];
          const cinemas = moviesState?.filtersData?.filters?.cinemas || [];

          // Case A: Structured cinemas and showDates present
          if (cinemas.length > 0 || showDates.length > 0) {
            for (const cinema of cinemas) {
              const cName = cinema.title || cinema.name || cinema.cinemaName || '';
              for (const sDate of showDates) {
                const evalResult = evaluateShowEligibility(cName, sDate);
                if (evalResult.eligible) {
                  matchedShows.push({
                    cinema: evalResult.cinema,
                    showDate: sDate,
                    ruleType: evalResult.ruleType,
                    badge: evalResult.badge,
                    priority: evalResult.priority
                  });
                }
              }
            }
          }
        }

        // Case B: Fallback regex inspection on page content
        if (matchedShows.length === 0) {
          // Check if page specifically mentions Basera
          if (/basera/i.test(pageHtml)) {
            const evalResult = evaluateShowEligibility('PVR INOX Basera Mall (ECR)', 'All Open Dates');
            if (evalResult.eligible) {
              matchedShows.push({
                cinema: 'PVR INOX Basera Mall (ECR)',
                showDate: 'Live on District',
                ruleType: evalResult.ruleType,
                badge: evalResult.badge,
                priority: evalResult.priority
              });
            }
          }

          // Check if page mentions 16th show date
          const dateMatches = pageHtml.match(/(?:16th\s+[A-Za-z]+|[A-Za-z]+\s+16th|2026-12-16|2026-[0-9]{2}-16)/gi);
          if (dateMatches) {
            const uniqueDates = [...new Set(dateMatches)];
            for (const matchedDate of uniqueDates) {
              const evalResult = evaluateShowEligibility('Chennai Theatres (16th Show)', matchedDate);
              if (evalResult.eligible) {
                matchedShows.push({
                  cinema: 'Chennai Multiplex',
                  showDate: matchedDate,
                  ruleType: evalResult.ruleType,
                  badge: evalResult.badge,
                  priority: evalResult.priority
                });
              }
            }
          }

          // Case C: If booking is officially open and no specific breakdown was found
          // Evaluate general listing
          if (isBookingOpen && matchedShows.length === 0) {
            // Check if user wants Basera alone or 16th
            // If Basera is in cinema filter, check if booking is open
            const evalBasera = evaluateShowEligibility('Basera Mall', 'Live Booking');
            matchedShows.push({
              cinema: 'PVR INOX Basera Mall (ECR)',
              showDate: 'Live Now',
              ruleType: evalBasera.ruleType,
              badge: evalBasera.badge,
              priority: evalBasera.priority
            });
          }
        }

        // Dispatch notifications for each eligible show
        for (const show of matchedShows) {
          const discovery = {
            title: movieTitle,
            platform: 'District (Zomato)',
            url: movieUrl,
            city: config.CITY,
            cinema: show.cinema,
            showDate: show.showDate,
            format: hasImax ? 'IMAX Laser (1.90:1)' : 'Standard / 3D',
            status: isBookingOpen ? 'BOOKINGS LIVE NOW!' : 'Showtimes Listed (Active)',
            ruleType: show.ruleType,
            badge: show.badge,
            priority: show.priority,
            timestamp: new Date().toISOString()
          };
          discoveries.push(discovery);
          await notifyAll(discovery);
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
 * Dedicated monitoring for Basera Mall and 16th show dates
 */
async function pollBookMyShow() {
  const logPrefix = '[BookMyShow]';
  const start = Date.now();
  console.log(`${logPrefix} Checking BMS explore for "${config.MOVIE_KEYWORD}" & Basera Mall...`);

  const headers = {
    'Referer': 'https://in.bookmyshow.com/',
    'x-bms-app': 'web'
  };
  if (config.BMS_COOKIE) {
    headers['Cookie'] = config.BMS_COOKIE;
  }

  const targets = [
    {
      name: 'BMS Explore Movies Chennai',
      url: `https://in.bookmyshow.com/explore/movies-${config.CITY}`,
      isCinemaDirect: false
    },
    {
      name: 'PVR INOX Basera ECR Chennai Cinema Page',
      url: `https://in.bookmyshow.com/cinemas/che/pvr-inox-basera-ecr-chennai/buytickets/BSER/`,
      isCinemaDirect: true,
      cinemaName: 'PVR INOX Basera Mall (ECR)'
    }
  ];

  const discoveries = [];

  for (const target of targets) {
    try {
      const res = await fetchUrl(target.url, headers);
      const duration = Date.now() - start;

      if (res.status === 403) {
        console.log(`${logPrefix} Cloudflare bot protection active on ${target.name} (${duration}ms). District primary layer active.`);
        continue;
      }

      if (res.status === 200 && res.data.length > 500) {
        const html = res.data;

        // If directly checking Basera cinema page
        if (target.isCinemaDirect) {
          const movieRegex = new RegExp(config.MOVIE_KEYWORD, 'i');
          if (movieRegex.test(html)) {
            console.log(`${logPrefix} 🚨 TARGET MOVIE DETECTED DIRECTLY AT BASERA MALL BMS PAGE!`);
            const evalResult = evaluateShowEligibility('PVR INOX Basera Mall (ECR)', 'Live Booking');
            const discovery = {
              title: config.MOVIE_KEYWORD.toUpperCase(),
              platform: 'BookMyShow',
              url: target.url,
              city: config.CITY,
              cinema: 'PVR INOX Basera Mall (ECR)',
              showDate: 'Live Now',
              format: 'IMAX Laser / 4K',
              status: 'SHOWTIMES LIVE AT BASERA MALL BMS!',
              ruleType: evalResult.ruleType,
              badge: evalResult.badge,
              priority: evalResult.priority,
              timestamp: new Date().toISOString()
            };
            discoveries.push(discovery);
            await notifyAll(discovery);
          }
          continue;
        }

        // On explore page: find movie events
        const movieRegex = new RegExp(`/movies/([^/]*${config.MOVIE_KEYWORD}[^/]*)/(ET[0-9]+)`, 'gi');
        const matches = [...html.matchAll(movieRegex)];

        for (const m of matches) {
          const slug = m[1];
          const eventCode = m[2];
          const title = slug.replace(/-/g, ' ').toUpperCase();
          const url = `https://in.bookmyshow.com/${config.CITY}/movies/${slug}/${eventCode}`;

          // Fetch showtimes page for this movie if accessible
          try {
            const showPage = await fetchUrl(url, headers);
            if (showPage.status === 200) {
              const showHtml = showPage.data;
              
              // 1. Check for Basera Mall
              if (/basera/i.test(showHtml)) {
                const evalBasera = evaluateShowEligibility('PVR INOX Basera Mall (ECR)', 'All Open Dates');
                const discBasera = {
                  title,
                  platform: 'BookMyShow',
                  url,
                  city: config.CITY,
                  cinema: 'PVR INOX Basera Mall (ECR)',
                  showDate: 'Live on BMS',
                  format: 'IMAX Laser',
                  status: 'BOOKINGS LIVE AT BASERA MALL!',
                  ruleType: evalBasera.ruleType,
                  badge: evalBasera.badge,
                  priority: evalBasera.priority,
                  timestamp: new Date().toISOString()
                };
                discoveries.push(discBasera);
                await notifyAll(discBasera);
              }

              // 2. Check for other theatres 16th shows alone
              const date16Matches = showHtml.match(/(?:16th\s+[A-Za-z]+|[A-Za-z]+\s+16th|2026-12-16|data-date="[^"]*16[^"]*")/gi);
              if (date16Matches) {
                const eval16 = evaluateShowEligibility('Chennai Multiplex', '16th Show');
                const disc16 = {
                  title,
                  platform: 'BookMyShow',
                  url,
                  city: config.CITY,
                  cinema: 'Chennai Theatres',
                  showDate: '16th Show',
                  format: 'IMAX Laser / 2D',
                  status: '16TH SHOW LIVE ON BMS!',
                  ruleType: eval16.ruleType,
                  badge: eval16.badge,
                  priority: eval16.priority,
                  timestamp: new Date().toISOString()
                };
                discoveries.push(disc16);
                await notifyAll(disc16);
              }
            }
          } catch (showErr) {
            console.warn(`${logPrefix} Notice checking showtimes page for ${slug}: ${showErr.message}`);
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
  console.log(`[Arrakis Radar] Mission-Critical Sweep Started at ${sweepStart.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`Target Movie : "${config.MOVIE_KEYWORD}" | City: ${config.CITY.toUpperCase()}`);
  console.log(`Surveillance : 1) Basera Mall Alone (All Dates)`);
  console.log(`             : 2) Other Theatres (16th Shows Alone)`);
  console.log(`Persisted IDs: ${notifiedSet.size} active show keys`);
  console.log(`========================================================`);

  const [districtResults, bmsResults] = await Promise.all([
    pollDistrict(),
    pollBookMyShow()
  ]);

  const all = [...districtResults, ...bmsResults];

  if (all.length === 0) {
    console.log(`[Arrakis Radar] No qualifying bookings matching [Basera Mall OR 16th Shows] found yet. Standing by...`);
  } else {
    console.log(`[Arrakis Radar] ✅ Found ${all.length} matching eligible shows across surveillance rules.`);
  }

  // Write GitHub Step Summary if running in GitHub Actions
  if (STEP_SUMMARY_FILE) {
    try {
      const summaryMd = [
        `## 🪐 Arrakis Radar — Mission Critical Sweep Summary`,
        `- **Timestamp:** ${new Date().toISOString()}`,
        `- **Target Movie:** \`${config.MOVIE_KEYWORD}\` (${config.CITY.toUpperCase()})`,
        `- **Active Rules:**`,
        `  - 🏛️ **Basera Mall Alone:** Unconditionally monitored for all shows`,
        `  - 📅 **Other Theatres:** Narrowed to 16th shows alone`,
        `- **Persisted Show Keys:** ${notifiedSet.size}`,
        `- **Eligible Shows Detected in this Sweep:** ${all.length}`,
        ...(all.length > 0 ? [
          `\n### 🎟️ Detected Shows`,
          `| Movie | Cinema | Date | Platform | Match Rule | URL |`,
          `| :--- | :--- | :--- | :--- | :--- | :--- |`,
          ...all.map(s => `| **${s.title}** | ${s.cinema} | ${s.showDate} | ${s.platform} | \`${s.badge}\` | [Book Now](${s.url}) |`)
        ] : ['\n> *No new shows matching Basera Mall or 16th shows at other theatres yet.*'])
      ].join('\n');

      fs.appendFileSync(STEP_SUMMARY_FILE, summaryMd + '\n\n', 'utf8');
    } catch (summaryErr) {
      console.warn(`[Summary] Failed to write step summary: ${summaryErr.message}`);
    }
  }

  return all;
}

/**
 * Run Test Alert to verify notification pipeline
 */
async function testAlert() {
  console.log('[Test] Triggering test alerts for both Basera Mall and 16th Show at Other Theatres...');
  
  // 1. Basera Mall test show
  const mockBasera = {
    title: 'DUNE 3: MESSIAH (CHENNAI IMAX LASER)',
    platform: 'District & BookMyShow [TEST ALERT]',
    url: 'https://in.bookmyshow.com/cinemas/che/pvr-inox-basera-ecr-chennai/buytickets/BSER/',
    city: config.CITY,
    cinema: 'PVR INOX Basera Mall (ECR, Injambakkam)',
    showDate: 'Opening Week (All Shows)',
    format: 'IMAX Laser (1.90:1)',
    status: 'BASERA MALL BOOKINGS LIVE NOW!',
    ruleType: 'BASERA_MALL_EXCLUSIVE',
    badge: '🏛️ BASERA MALL (ALL DATES)',
    priority: 'HIGH'
  };

  // 2. 16th show at other theatre test
  const mock16th = {
    title: 'DUNE 3: MESSIAH (CHENNAI IMAX LASER)',
    platform: 'District & BookMyShow [TEST ALERT]',
    url: 'https://in.bookmyshow.com/explore/movies-chennai',
    city: config.CITY,
    cinema: 'PVR INOX Palazzo IMAX (Nexus Vijaya Vadapalani)',
    showDate: 'December 16th (Special Fan Preview)',
    format: 'IMAX Laser (1.90:1)',
    status: '16TH SHOW ADDED AT PALAZZO!',
    ruleType: 'OTHER_THEATRE_16TH',
    badge: '📅 16TH SHOW EXCLUSIVE (PVR Palazzo IMAX)',
    priority: 'CRITICAL'
  };

  await notifyAll(mockBasera);
  await notifyAll(mock16th);
  console.log('[Test] Both test alerts dispatched! Check Telegram, Discord, and Ntfy app.');
}

// CLI Execution Handler
const args = process.argv.slice(2);

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
