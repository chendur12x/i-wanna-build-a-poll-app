/**
 * ARRAKIS RADAR - Dune 3 IMAX Ticket Tracker & Poller
 * Multi-platform poller for District (by Zomato) & BookMyShow (BMS)
 * Runs with 0 external npm dependencies (pure Node.js standard library)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables or config.json if present
let config = {
  MOVIE_KEYWORD: process.env.MOVIE_KEYWORD || 'dune',
  CITY: (process.env.CITY || 'chennai').toLowerCase(),
  FORMAT_REQUIRED: (process.env.FORMAT_REQUIRED || 'IMAX').toUpperCase(),
  CINEMA_FILTER: (process.env.CINEMA_FILTER || 'palazzo, luxe, basera').toLowerCase(),
  POLL_INTERVAL_SECONDS: parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10),
  
  // Chennai IMAX Venues to track
  CHENNAI_IMAX_SCREENS: [
    { name: 'PVR INOX Palazzo IMAX', venue: 'The Nexus Vijaya Mall, Vadapalani', bmsCode: 'PALZ' },
    { name: 'PVR INOX Luxe IMAX', venue: 'Phoenix Marketcity, Velachery', bmsCode: 'INLU' },
    { name: 'PVR INOX Basera IMAX', venue: 'East Coast Road (ECR), Injambakkam', bmsCode: 'BSER' }
  ],
  
  // Notification: Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  
  // Notification: Discord
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
  
  // Notification: ntfy.sh (Free instant push for Android/iOS - no signup needed!)
  NTFY_TOPIC: process.env.NTFY_TOPIC || '',
  
  // Optional BMS cookie (e.g. cf_clearance if available)
  BMS_COOKIE: process.env.BMS_COOKIE || ''
};

const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...fileConfig };
  } catch (e) {
    console.error('[Config] Failed to parse config.json:', e.message);
  }
}

// Track already notified movie matches to avoid spamming
const notifiedSet = new Set();

/**
 * Perform HTTPS GET request with headers
 */
function fetchUrl(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, headers));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${targetUrl}`));
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Send POST JSON request
 */
function postJson(targetUrl, jsonBody, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
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
      timeout: 10000
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
 * Send Telegram Alert
 */
async function sendTelegramAlert(ticketInfo) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;
  const message = [
    `🚨 *DUNE 3 IMAX TICKETS DETECTED!* 🚨`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎬 *Title:* ${ticketInfo.title}`,
    `📍 *Platform:* ${ticketInfo.platform}`,
    `🏙️ *City:* ${ticketInfo.city.toUpperCase()}`,
    `🎞️ *Format:* ${ticketInfo.format || 'IMAX'}`,
    `🎟️ *Status:* *${ticketInfo.status}*`,
    ticketInfo.cinema ? `🏛️ *Cinema:* ${ticketInfo.cinema}` : '',
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🔗 [BOOK TICKETS IMMEDIATELY](${ticketInfo.url})`,
    `⚡ Detected by *Arrakis Radar* at ${new Date().toLocaleTimeString()}`
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
    console.log(`[Alert/Telegram] Sent! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Telegram] Failed: ${e.message}`);
  }
}

/**
 * Send Discord Alert
 */
async function sendDiscordAlert(ticketInfo) {
  if (!config.DISCORD_WEBHOOK_URL) return;
  const payload = {
    content: '🚨 @everyone **DUNE 3 IMAX TICKETS ARE LIVE! BOOK NOW!** 🎟️',
    embeds: [
      {
        title: `🔥 ${ticketInfo.title} (${ticketInfo.format || 'IMAX'})`,
        url: ticketInfo.url,
        description: `Booking has just opened on **${ticketInfo.platform}**! Rush before seats sell out!`,
        color: 0xe5a93c, // Arrakis spice gold
        fields: [
          { name: 'Platform', value: ticketInfo.platform, inline: true },
          { name: 'City', value: ticketInfo.city.toUpperCase(), inline: true },
          { name: 'Format', value: ticketInfo.format || 'IMAX Laser', inline: true },
          { name: 'Status', value: `🟢 **${ticketInfo.status}**`, inline: true },
          ...(ticketInfo.cinema ? [{ name: 'Cinema', value: ticketInfo.cinema, inline: true }] : [])
        ],
        footer: {
          text: `Arrakis Radar • ${new Date().toLocaleTimeString()}`
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await postJson(config.DISCORD_WEBHOOK_URL, payload);
    console.log(`[Alert/Discord] Sent! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Discord] Failed: ${e.message}`);
  }
}

/**
 * Send ntfy.sh Alert (Instant push notification to phone with sound/vibe)
 */
async function sendNtfyAlert(ticketInfo) {
  if (!config.NTFY_TOPIC) return;
  const topic = config.NTFY_TOPIC.replace(/^https?:\/\/ntfy\.sh\//, '');
  try {
    const res = await postJson(
      `https://ntfy.sh/${topic}`,
      `${ticketInfo.title} is now available on ${ticketInfo.platform} (${ticketInfo.format || 'IMAX'}). Tap to book!`,
      {
        'Title': `🚨 DUNE 3 IMAX TICKETS LIVE!`,
        'Priority': 'urgent',
        'Tags': 'warning,ticket,movie_camera,fire',
        'Click': ticketInfo.url
      }
    );
    console.log(`[Alert/Ntfy] Sent to topic '${topic}'! HTTP ${res.status}`);
  } catch (e) {
    console.error(`[Alert/Ntfy] Failed: ${e.message}`);
  }
}

/**
 * Dispatch alert across all configured channels
 */
async function notifyAll(ticketInfo) {
  const alertKey = `${ticketInfo.platform}_${ticketInfo.title}_${ticketInfo.url}`;
  if (notifiedSet.has(alertKey)) {
    console.log(`[Radar] Already notified for ${alertKey}, skipping duplicate.`);
    return;
  }
  notifiedSet.add(alertKey);

  console.log('\n🚨🚨🚨 [TICKETS DETECTED] DISPATCHING INSTANT ALERTS! 🚨🚨🚨');
  console.log(JSON.stringify(ticketInfo, null, 2));

  await Promise.allSettled([
    sendTelegramAlert(ticketInfo),
    sendDiscordAlert(ticketInfo),
    sendNtfyAlert(ticketInfo)
  ]);
}

/**
 * Poll District (by Zomato)
 */
async function pollDistrict() {
  const logPrefix = '[District]';
  const start = Date.now();
  console.log(`${logPrefix} Scanning district.in catalog for "${config.MOVIE_KEYWORD}"...`);

  try {
    const res = await fetchUrl('https://www.district.in/movies/');
    const duration = Date.now() - start;

    if (res.status !== 200) {
      console.warn(`${logPrefix} HTTP ${res.status} returned (${duration}ms)`);
      return [];
    }

    // Match all movie paths
    const movieMatches = res.data.match(/\/movies\/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)/g) || [];
    const uniqueSlugs = [...new Set(movieMatches.map(m => m.replace('/movies/', '')))];

    const matchedSlugs = uniqueSlugs.filter(slug => {
      const lower = slug.toLowerCase();
      return lower.includes(config.MOVIE_KEYWORD.toLowerCase());
    });

    console.log(`${logPrefix} Total catalog: ${uniqueSlugs.length} titles | Matched "${config.MOVIE_KEYWORD}": ${matchedSlugs.length} (${duration}ms)`);

    const discoveries = [];

    for (const slug of matchedSlugs) {
      const movieUrl = `https://www.district.in/movies/${slug}`;
      try {
        const moviePage = await fetchUrl(movieUrl);
        const html = moviePage.data;

        // Check format (IMAX, etc.)
        const formats = [];
        if (/IMAX/i.test(html)) formats.push('IMAX');
        if (/4DX/i.test(html)) formats.push('4DX');
        if (/ICE/i.test(html)) formats.push('ICE');
        if (/3D/i.test(html)) formats.push('3D');

        // Check if IMAX matches requirement
        const hasImax = formats.includes('IMAX') || /IMAX/i.test(slug);

        // Check booking status
        const isBookingOpen = /book\s*tickets?|available|filling\s*fast/i.test(html);

        const discovery = {
          title: slug.replace(/-movie-tickets.*$/, '').replace(/-/g, ' ').toUpperCase(),
          platform: 'District (Zomato)',
          url: movieUrl,
          city: config.CITY,
          format: formats.join(' / ') || 'IMAX/2D',
          status: isBookingOpen ? 'BOOKINGS LIVE!' : 'Listed (Notify Stage)',
          isBookingOpen,
          hasImax,
          timestamp: new Date().toISOString()
        };

        discoveries.push(discovery);

        // If bookings are open and matches format, notify immediately!
        if (isBookingOpen && (!config.FORMAT_REQUIRED || hasImax)) {
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
 */
async function pollBookMyShow() {
  const logPrefix = '[BookMyShow]';
  const start = Date.now();
  console.log(`${logPrefix} Checking BMS explore for ${config.CITY} & "${config.MOVIE_KEYWORD}"...`);

  const headers = {
    'Referer': 'https://in.bookmyshow.com/',
    'x-bms-app': 'web'
  };
  if (config.BMS_COOKIE) {
    headers['Cookie'] = config.BMS_COOKIE;
  }

  try {
    const res = await fetchUrl(`https://in.bookmyshow.com/explore/movies-${config.CITY}`, headers);
    const duration = Date.now() - start;

    if (res.status === 403) {
      console.log(`${logPrefix} Cloudflare bot protection active on direct BMS explore page (${duration}ms). District layer active.`);
      return [];
    }

    if (res.status === 200) {
      console.log(`${logPrefix} Explore page fetched successfully (${duration}ms, ${res.data.length} bytes).`);
      const movieRegex = new RegExp(`/movies/([^/]*${config.MOVIE_KEYWORD}[^/]*)/(ET[0-9]+)`, 'gi');
      const matches = [...res.data.matchAll(movieRegex)];

      const discoveries = [];
      for (const m of matches) {
        const slug = m[1];
        const eventCode = m[2];
        const title = slug.replace(/-/g, ' ').toUpperCase();
        const url = `https://in.bookmyshow.com/${config.CITY}/movies/${slug}/${eventCode}`;

        const discovery = {
          title,
          platform: 'BookMyShow',
          url,
          city: config.CITY,
          format: 'IMAX Laser / 2D',
          status: 'BOOKINGS LIVE ON BMS!',
          isBookingOpen: true,
          hasImax: true,
          timestamp: new Date().toISOString()
        };
        discoveries.push(discovery);
        await notifyAll(discovery);
      }
      return discoveries;
    }
    return [];
  } catch (e) {
    console.log(`${logPrefix} Check completed with notice: ${e.message}`);
    return [];
  }
}

/**
 * Main Polling Sweep
 */
async function runSweep() {
  console.log(`\n========================================================`);
  console.log(`[Arrakis Radar] Sweep started at ${new Date().toLocaleTimeString()}`);
  console.log(`Target: "${config.MOVIE_KEYWORD}" | City: ${config.CITY} | Format: ${config.FORMAT_REQUIRED}`);
  console.log(`========================================================`);

  const [districtResults, bmsResults] = await Promise.all([
    pollDistrict(),
    pollBookMyShow()
  ]);

  const all = [...districtResults, ...bmsResults];
  if (all.length === 0) {
    console.log(`[Arrakis Radar] No open IMAX bookings for "${config.MOVIE_KEYWORD}" yet. Standing by for next sweep...`);
  } else {
    console.log(`[Arrakis Radar] Found ${all.length} movie entries matching filters.`);
  }
  return all;
}

/**
 * Run Test Alert
 */
async function testAlert() {
  console.log('[Test] Triggering test alert to verify notification channels...');
  const mockTicket = {
    title: 'DUNE 3: MESSIAH (IMAX 70MM / LASER)',
    platform: 'District & BookMyShow [TEST ALERT]',
    url: 'https://www.district.in/movies/',
    city: config.CITY,
    cinema: 'PVR Forum Koramangala IMAX / PVR Phoenix Palladium',
    format: 'IMAX with Laser (1.43:1)',
    status: 'TICKETS JUST DROPPED!',
    isBookingOpen: true,
    hasImax: true
  };
  await notifyAll(mockTicket);
  console.log('[Test] Test alert dispatch finished. Check your Telegram/Discord/Ntfy app!');
}

// CLI Execution handler
const args = process.argv.slice(2);

if (args.includes('--test-alert')) {
  testAlert().then(() => process.exit(0));
} else if (args.includes('--once')) {
  runSweep().then(() => {
    console.log('[Arrakis Radar] Single sweep completed.');
    process.exit(0);
  });
} else {
  // Continuous Loop
  console.log(`[Arrakis Radar] Starting background poller loop every ${config.POLL_INTERVAL_SECONDS}s...`);
  runSweep();
  setInterval(runSweep, config.POLL_INTERVAL_SECONDS * 1000);
}

module.exports = { runSweep, testAlert, config };
