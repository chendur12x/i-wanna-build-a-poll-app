/**
 * ARRAKIS RADAR - Cloudflare Worker Edge Poller
 * Surveillance Rule:
 * ONLY Desired Rows A-G (Elite Tier ₹508.34) at Palazzo & Luxe IMAX on the 16th (Checked every sweep)
 */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledSweep(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/trigger') {
      const results = await handleScheduledSweep(env);
      return new Response(JSON.stringify({ status: 'ok', count: results.length, results }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/test-alert') {
      const mockRowsAG = {
        title: 'DUNE 3: MESSIAH (CHENNAI IMAX LASER)',
        platform: 'Cloudflare Worker [EDGE TEST]',
        url: 'https://in.bookmyshow.com/cinemas/che/pvr-palazzo-the-nexus-vijaya-mall-vadapalani-chennai/buytickets/PALZ/',
        city: env.CITY || 'chennai',
        cinema: 'PVR INOX Palazzo IMAX (Nexus Vijaya)',
        showDate: 'December 16th',
        format: 'IMAX Laser (1.90:1)',
        status: 'DESIRED ROWS A-G (ELITE SEATS) RELEASED ONLINE!',
        badge: '💺 ROWS A–G RELEASED (Palazzo IMAX - 16th)',
        ruleType: 'ROWS_A_TO_G_RELEASE'
      };
      await sendAlert(env, mockRowsAG);
      return new Response(JSON.stringify({ status: 'ok', message: 'Test alert dispatched for Rows A-G (Palazzo/Luxe 16th)' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Arrakis Radar Cloudflare Worker is active (Rows A-G Only: Palazzo & Luxe 16th).', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

function evaluateShowEligibility(cinemaName, showDate, venueDetails = '') {
  const cinemaText = `${cinemaName || ''} ${venueDetails || ''}`.toLowerCase();
  const dateStr = String(showDate || '').toLowerCase();

  // ONLY Rule: Palazzo & Luxe on 16th for Desired Rows A-G (Elite Tier ₹508.34)
  const isPalazzoOrLuxe = /palazzo|luxe|nexus|phoenix/i.test(cinemaText);
  const is16th = /(?:^|\D)16(?:th)?(?:\D|$)|-16\b|16-|\b16\b/i.test(dateStr);
  const isRowsAGOpen = /rows?[-_\s]*[a-g]\b|elite|₹?508/i.test(venueDetails || '');

  if (isPalazzoOrLuxe && is16th && isRowsAGOpen) {
    return {
      eligible: true,
      ruleType: 'ROWS_A_TO_G_RELEASE',
      badge: `💺 ROWS A–G RELEASED (${cinemaName || 'Palazzo/Luxe'})`,
      cinema: cinemaName || 'PVR INOX Palazzo / Luxe IMAX',
      date: showDate || '16th (Rows A-G)',
      isRowsAG: true
    };
  }

  return { eligible: false };
}

async function handleScheduledSweep(env) {
  const keyword = (env.MOVIE_KEYWORD || 'dune').toLowerCase();
  const city = (env.CITY || 'chennai').toLowerCase();

  try {
    const res = await fetch(`https://www.district.in/movies/${city}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (!res.ok) return [];
    const html = await res.text();
    const movieMatches = html.match(/\/movies\/([a-zA-Z0-9\-]+(?:-MV[0-9]+)?)/g) || [];
    const uniqueSlugs = [...new Set(movieMatches.map(m => m.replace('/movies/', '')))];

    const matched = uniqueSlugs.filter(s => s.toLowerCase().includes(keyword));
    const discoveries = [];

    for (const slug of matched) {
      const pageRes = await fetch(`https://www.district.in/movies/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!pageRes.ok) continue;
      const pageHtml = await pageRes.text();

      const isBookingOpen = /book\s*tickets?|available|filling\s*fast/i.test(pageHtml);
      const hasImax = /IMAX/i.test(pageHtml) || /IMAX/i.test(slug);

      // Check ONLY Palazzo & Luxe on 16th for Rows A-G (Elite Tier ₹508.34)
      const hasPalazzo = /palazzo/i.test(pageHtml);
      const hasLuxe = /luxe/i.test(pageHtml);
      const has16th = /(?:16th\s+[A-Za-z]+|[A-Za-z]+\s+16th|2026-12-16|2026-[0-9]{2}-16)/i.test(pageHtml);
      const hasRowsAG = /(?:rows?[-_\s]*[a-g]\b|elite|₹?508)/i.test(pageHtml);

      if ((hasPalazzo || hasLuxe) && has16th && hasRowsAG) {
        const cName = hasPalazzo ? 'PVR INOX Palazzo IMAX (Nexus Vijaya)' : 'PVR INOX Luxe IMAX (Phoenix Marketcity)';
        const evalRes = evaluateShowEligibility(cName, '16th Show', 'Rows A-G Elite');
        if (evalRes.eligible) {
          const item = {
            title: slug.replace(/-movie-tickets.*$/, '').replace(/-/g, ' ').toUpperCase(),
            platform: 'District (Zomato)',
            url: `https://www.district.in/movies/${slug}`,
            city,
            cinema: evalRes.cinema,
            showDate: evalRes.date,
            format: hasImax ? 'IMAX Laser' : 'Standard',
            status: isBookingOpen ? 'ROWS A-G LIVE NOW!' : 'Rows A-G Listed',
            badge: evalRes.badge,
            ruleType: evalRes.ruleType
          };
          discoveries.push(item);
          await sendAlert(env, item);
        }
      }
    }
    return discoveries;
  } catch (err) {
    console.error('Sweep error:', err);
    return [];
  }
}

async function sendAlert(env, ticket) {
  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const text = `🚨 *DUNE 3 TICKETS DETECTED!* 🚨\n\n🎯 *Match:* ${ticket.badge}\n🎬 *Title:* ${ticket.title}\n🏛️ *Cinema:* ${ticket.cinema}\n📅 *Date:* ${ticket.showDate}\n📍 *Platform:* ${ticket.platform}\n🎟️ *Status:* *${ticket.status}*\n\n🔗 [BOOK TICKETS IMMEDIATELY](${ticket.url})`;
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown'
      })
    });
  }

  // Discord
  if (env.DISCORD_WEBHOOK_URL) {
    const isRowsAG = ticket.ruleType === 'ROWS_A_TO_G_RELEASE' || ticket.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
    const isBasera = ticket.ruleType === 'BASERA_MALL_EXCLUSIVE';
    const embedColor = isRowsAG ? 0xe91e63 : (isBasera ? 0xe5a93c : 0x06b6d4);
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 @everyone **${ticket.badge}** 🎟️`,
        embeds: [{
          title: `🔥 ${ticket.title} — ${ticket.cinema}`,
          url: ticket.url,
          description: `Booking is active on **${ticket.platform}**!`,
          color: embedColor
        }]
      })
    });
  }

  // ntfy.sh (headers strictly ASCII safe)
  if (env.NTFY_TOPIC) {
    const topic = env.NTFY_TOPIC.replace('https://ntfy.sh/', '').trim();
    const cleanTitle = (ticket.badge || 'TICKET ALERT').replace(/[^\x00-\x7F]/g, '').trim();
    const isRowsAG = ticket.ruleType === 'ROWS_A_TO_G_RELEASE' || ticket.ruleType === 'LAST_5_ROWS_LATE_RELEASE';
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': cleanTitle,
        'Priority': 'urgent',
        'Tags': isRowsAG ? 'seat,rotating_light,fire,star' : 'rotating_light,ticket,fire',
        'Click': ticket.url
      },
      body: `${ticket.title} at ${ticket.cinema} (${ticket.showDate}) is LIVE!`
    });
  }

  // Voice Call Alerts (Twilio & CallMeBot)
  let spoken;
  if (ticket.ruleType === 'ROWS_A_TO_G_RELEASE' || ticket.ruleType === 'LAST_5_ROWS_LATE_RELEASE') {
    spoken = `Urgent VIP seat alert! Desired rows A to G tickets just opened at ${ticket.cinema || 'Palazzo or Luxe IMAX'} for the 16th show! Book your seats right now!`;
  } else if (ticket.ruleType === 'BASERA_MALL_EXCLUSIVE') {
    spoken = `Urgent ticket alert! Dune 3 tickets are now live at Basera Mall Chennai. Book immediately!`;
  } else {
    spoken = `Urgent ticket alert! A new 16th show has just been added at ${ticket.cinema || 'Chennai multiplex'}. Book now!`;
  }

  // 1. Twilio Voice Call
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.TO_PHONE_NUMBER) {
    try {
      const twiml = `<Response><Pause length="1"/><Say voice="Polly.Aditi" language="en-IN">${spoken}</Say><Pause length="1"/><Say voice="Polly.Aditi" language="en-IN">${spoken}</Say></Response>`;
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const body = new URLSearchParams({
        To: env.TO_PHONE_NUMBER,
        From: env.TWILIO_FROM_NUMBER,
        Twiml: twiml
      });
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
    } catch (e) {
      console.error('Twilio error:', e);
    }
  }

  // 2. CallMeBot Free Telegram Voice Call
  if (env.CALLMEBOT_TELEGRAM_USER) {
    try {
      const tg = env.CALLMEBOT_TELEGRAM_USER.replace('@', '').trim();
      await fetch(`https://api.callmebot.com/start.php?user=@${tg}&text=${encodeURIComponent(spoken)}&lang=en-US-Standard-B`);
    } catch (e) {
      console.error('CallMeBot error:', e);
    }
  }
}
