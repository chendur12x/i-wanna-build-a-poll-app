/**
 * ARRAKIS RADAR - Cloudflare Worker Edge Poller
 * 100% Free on Cloudflare Workers (100,000 requests/day free tier)
 * Runs automatically on a Cron Trigger every 1-5 minutes!
 */

export default {
  // Cron trigger handler
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledSweep(env));
  },

  // HTTP request handler for manual trigger or health check
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      const results = await handleScheduledSweep(env);
      return new Response(JSON.stringify({ status: 'ok', results }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/test-alert') {
      await sendAlert(env, {
        title: 'DUNE 3: MESSIAH (CHENNAI IMAX LASER)',
        platform: 'District & BookMyShow [CLOUDFLARE CHENNAI TEST]',
        url: 'https://in.bookmyshow.com/explore/movies-chennai',
        city: env.CITY || 'chennai',
        cinema: 'PVR Palazzo IMAX (Nexus Vijaya) & PVR Luxe IMAX (Phoenix Velachery)',
        format: 'IMAX Laser (1.90:1)',
        status: 'CHENNAI IMAX TICKETS DROPPED!',
        isBookingOpen: true
      });
      return new Response(JSON.stringify({ status: 'test alert dispatched' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Arrakis Radar Cloudflare Worker is active (Chennai IMAX Mode). Use /trigger or /test-alert', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function handleScheduledSweep(env) {
  const keyword = (env.MOVIE_KEYWORD || 'dune').toLowerCase();
  const city = (env.CITY || 'chennai').toLowerCase();

  try {
    const res = await fetch('https://www.district.in/movies/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
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

      if (isBookingOpen && hasImax) {
        const ticket = {
          title: slug.replace(/-movie-tickets.*$/, '').replace(/-/g, ' ').toUpperCase(),
          platform: 'District (Zomato)',
          url: `https://www.district.in/movies/${slug}`,
          city,
          format: 'IMAX Laser',
          status: 'BOOKINGS LIVE NOW!'
        };
        discoveries.push(ticket);
        await sendAlert(env, ticket);
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
    const text = `🚨 *DUNE 3 IMAX TICKETS DETECTED!* 🚨\n\n🎬 *Title:* ${ticket.title}\n📍 *Platform:* ${ticket.platform}\n🏙️ *City:* ${ticket.city.toUpperCase()}\n🎞️ *Format:* ${ticket.format}\n🎟️ *Status:* *${ticket.status}*\n\n🔗 [BOOK TICKETS IMMEDIATELY](${ticket.url})`;
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
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '🚨 @everyone **DUNE 3 IMAX TICKETS ARE LIVE!** 🎟️',
        embeds: [{
          title: `🔥 ${ticket.title} (${ticket.format})`,
          url: ticket.url,
          description: `Booking is open on **${ticket.platform}**!`,
          color: 0xe5a93c
        }]
      })
    });
  }

  // ntfy.sh
  if (env.NTFY_TOPIC) {
    const topic = env.NTFY_TOPIC.replace('https://ntfy.sh/', '');
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': '🚨 DUNE 3 IMAX TICKETS LIVE!',
        'Priority': 'urgent',
        'Tags': 'warning,ticket,fire',
        'Click': ticket.url
      },
      body: `${ticket.title} is now available on ${ticket.platform}! Tap to book!`
    });
  }
}
