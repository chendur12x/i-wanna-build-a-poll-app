/**
 * ARRAKIS RADAR - Local Web & API Server
 * Provides Web Dashboard + Scraper Proxy + Test Alert Dispatcher
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { runSweep, testAlert, config } = require('./poller');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. API: Trigger live sweep
  if (url.pathname === '/api/poll') {
    try {
      const results = await runSweep();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: results.length, data: results, timestamp: new Date() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 2. API: Trigger test alert
  if (url.pathname === '/api/test-alert' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let customCfg = {};
        if (body) {
          try { customCfg = JSON.parse(body); } catch (_) {}
        }
        // Temporarily overlay any custom test credentials if provided
        const origToken = config.TELEGRAM_BOT_TOKEN;
        const origChat = config.TELEGRAM_CHAT_ID;
        const origWebhook = config.DISCORD_WEBHOOK_URL;
        const origTopic = config.NTFY_TOPIC;

        if (customCfg.telegramToken) config.TELEGRAM_BOT_TOKEN = customCfg.telegramToken;
        if (customCfg.telegramChatId) config.TELEGRAM_CHAT_ID = customCfg.telegramChatId;
        if (customCfg.discordWebhook) config.DISCORD_WEBHOOK_URL = customCfg.discordWebhook;
        if (customCfg.ntfyTopic) config.NTFY_TOPIC = customCfg.ntfyTopic;

        await testAlert();

        // Restore
        config.TELEGRAM_BOT_TOKEN = origToken;
        config.TELEGRAM_CHAT_ID = origChat;
        config.DISCORD_WEBHOOK_URL = origWebhook;
        config.NTFY_TOPIC = origTopic;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Test alert dispatched successfully' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 3. Serve Static Files (index.html, etc.)
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[Arrakis Radar Server] Running on http://localhost:${PORT}`);
});
