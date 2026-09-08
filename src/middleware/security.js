const crypto = require('crypto');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const MAX_FAILED_AUTH = 10;
const clients = new Map();
const failedAuthClients = new Map();

function getCookie(request, name) {
  const cookies = request.get('cookie') || '';
  const match = cookies.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return '';
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return ''; }
}

function sameOriginCsrf(req) {
  const origin = req.get('origin');
  const referer = req.get('referer');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  let requestOrigin = origin || '';
  try { if (!requestOrigin && referer) requestOrigin = new URL(referer).origin; } catch { return false; }
  const provided = req.get('x-redline-csrf') || '';
  const cookie = getCookie(req, 'redline_csrf');
  return requestOrigin === expectedOrigin && provided.length === cookie.length && cookie.length > 0 && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(cookie));
}

function sameSecret(provided, expected) {
  const providedBuffer = Buffer.from(provided || '');
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function apiProtection(req, res, next) {
  const now = Date.now();
  const clientId = req.ip || req.socket.remoteAddress || 'unknown';
  if (clients.size > 10000) {
    for (const [key, value] of clients) {
      if (now - value.startedAt >= WINDOW_MS) clients.delete(key);
    }
  }
  if (failedAuthClients.size > 10000) {
    for (const [key, value] of failedAuthClients) {
      if (now - value.startedAt >= WINDOW_MS) failedAuthClients.delete(key);
    }
  }
  const configuredKey = process.env.REDLINE_API_KEY;
  if (configuredKey && !sameSecret(req.get('x-redline-api-key'), configuredKey) && !sameOriginCsrf(req)) {
    const failed = failedAuthClients.get(clientId);
    if (!failed || now - failed.startedAt >= WINDOW_MS) failedAuthClients.set(clientId, { startedAt: now, count: 1 });
    else failed.count += 1;
    const failedCount = failedAuthClients.get(clientId).count;
    if (failedCount > MAX_FAILED_AUTH) {
      res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - failedAuthClients.get(clientId).startedAt)) / 1000)));
      return res.status(429).json({ error: 'Too many authentication attempts' });
    }
    return res.status(401).json({ error: 'API key required' });
  }
  const current = clients.get(clientId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    clients.set(clientId, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
  }
  if (clients.get(clientId).count > MAX_REQUESTS) {
    res.set('Retry-After', String(Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1000)));
    return res.status(429).json({ error: 'Too many requests' });
  }
  return next();
}

function issueCsrfCookie(req, res, next) {
  if (!getCookie(req, 'redline_csrf')) {
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `redline_csrf=${encodeURIComponent(crypto.randomBytes(32).toString('hex'))}; Path=/; SameSite=Strict${secure}`);
  }
  next();
}

module.exports = { apiProtection, issueCsrfCookie };
