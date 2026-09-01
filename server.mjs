import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query } from './db.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const demoMode = process.env.DEMO_MODE === 'true';
const demoOtp = '1234';
const otpSecret = process.env.OTP_SECRET;
const adminPhones = new Set(
  String(process.env.ADMIN_PHONE_NUMBERS || '')
    .split(',')
    .map(normalizePhone)
    .filter(Boolean)
);
const rateLimits = new Map();

if (!otpSecret) {
  throw new Error('OTP_SECRET est requis. Copiez .env.example vers .env et renseignez une valeur secrète.');
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function applySecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('Payload too large');
  }
  return data ? JSON.parse(data) : {};
}

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

function normalizePhone(value) {
  return safeText(value, 25).replace(/[\s().-]/g, '');
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function isRateLimited(key, { windowMs, limit }) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function asNumber(value) {
  return Number(value ?? 0);
}

function productFromRow(row) {
  return {
    id: asNumber(row.id), name: row.name, price: asNumber(row.price_cdf), usd: asNumber(row.price_usd),
    area: row.area, delivery: row.delivery, seller: row.seller, rating: row.rating,
    sales: asNumber(row.sales), emoji: row.emoji, tone: row.tone, tag: row.tag,
    category: row.category, stock: asNumber(row.stock), vehicle: row.vehicle,
    year: row.year || '', km: row.km || '', fuel: row.fuel || '', gearbox: row.gearbox || '',
    description: row.description || ''
  };
}

function userFromRow(row) {
  return { id: row.id, phone: row.phone, name: row.name, roles: row.roles || [], createdAt: row.created_at };
}

function orderFromRow(row) {
  return {
    id: row.order_number, userId: row.user_id, items: row.items, total: asNumber(row.total_cdf),
    payment: row.payment, status: row.status, createdAt: row.created_at
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function hashOtp(phone, code) {
  return createHmac('sha256', otpSecret).update(`${phone}:${code}`).digest('hex');
}

async function currentUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const result = await query(
    `SELECT u.id, u.phone, u.name, u.roles, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  return result.rowCount ? userFromRow(result.rows[0]) : null;
}

async function requireRole(req, res, roles) {
  const user = await currentUser(req);
  if (!user) {
    send(res, 401, { error: 'Connexion requise.' });
    return null;
  }
  if (!roles.some(role => user.roles.includes(role))) {
    send(res, 403, { error: 'Accès non autorisé.' });
    return null;
  }
  return user;
}

function normalizeListing(input, previous = {}) {
  const category = safeText(input.category, 40) || previous.category || 'Mode';
  const vehicle = category === 'Automobile';
  const price = Number(String(input.price ?? previous.price ?? 0).replace(/[^0-9]/g, ''));
  return {
    ...previous,
    name: safeText(input.name, 80) || previous.name,
    price: Number.isFinite(price) ? price : previous.price,
    category,
    area: safeText(input.area, 40) || previous.area || 'Gombe',
    description: safeText(input.description, 700),
    vehicle,
    year: vehicle ? safeText(input.year, 10) : '',
    km: vehicle ? safeText(input.km, 20) : '',
    fuel: vehicle ? safeText(input.fuel, 30) || 'Essence' : '',
    gearbox: vehicle ? safeText(input.gearbox, 30) || 'Automatique' : '',
    emoji: vehicle ? '🚙' : previous.emoji || '🛍️',
    tone: vehicle ? 'green' : previous.tone || 'peach',
    tag: vehicle ? 'À vérifier' : previous.tag || 'Nouvelle annonce',
    delivery: vehicle ? 'Sur rendez-vous' : previous.delivery || 'Aujourd’hui',
    stock: vehicle ? 1 : Number(input.stock || previous.stock || 5),
    usd: Math.round(price / 2880)
  };
}

const listingFields = [
  'name', 'price_cdf', 'price_usd', 'area', 'delivery', 'seller', 'rating', 'sales', 'emoji', 'tone', 'tag',
  'category', 'stock', 'vehicle', 'year', 'km', 'fuel', 'gearbox', 'description', 'owner_user_id'
];

function listingValues(listing, ownerUserId) {
  return [
    listing.name, listing.price, listing.usd, listing.area, listing.delivery, listing.seller, listing.rating,
    listing.sales, listing.emoji, listing.tone, listing.tag, listing.category, listing.stock, listing.vehicle,
    listing.year, listing.km, listing.fuel, listing.gearbox, listing.description, ownerUserId
  ];
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/sw.js', ['sw.js', 'application/javascript; charset=utf-8']]
]);

const server = createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && url.pathname === '/api/health') {
      await query('SELECT 1');
      return send(res, 200, { ok: true, mode: demoMode ? 'demo' : 'production', database: 'postgresql', version: '0.3.0' });
    }

    if (method === 'GET' && url.pathname === '/api/products') {
      const q = safeText(url.searchParams.get('q'), 80).toLowerCase();
      const category = safeText(url.searchParams.get('category'), 40);
      const clauses = [];
      const params = [];
      if (q) {
        params.push(`%${q}%`);
        clauses.push(`(LOWER(name) LIKE $${params.length} OR LOWER(category) LIKE $${params.length} OR LOWER(area) LIKE $${params.length})`);
      }
      if (category) {
        params.push(category);
        clauses.push(`category = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await query(`SELECT * FROM products ${where} ORDER BY created_at DESC, id DESC`, params);
      return send(res, 200, { products: result.rows.map(productFromRow) });
    }

    if (method === 'POST' && url.pathname === '/api/auth/request-otp') {
      const { phone } = await readJson(req);
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone.length < 8) return send(res, 400, { error: 'Numéro de téléphone invalide.' });
      if (isRateLimited(`otp:${requestIp(req)}:${normalizedPhone}`, { windowMs: 10 * 60_000, limit: 5 })) {
        return send(res, 429, { error: 'Trop de demandes. Réessayez dans quelques minutes.' });
      }
      if (!demoMode) return send(res, 503, { error: 'Le service SMS n’est pas encore configuré.' });
      await query(
        `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
         ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at`,
        [normalizedPhone, hashOtp(normalizedPhone, demoOtp)]
      );
      return send(res, 200, { ok: true, demoCode: demoOtp, message: 'Mode démo : aucun SMS envoyé.' });
    }

    if (method === 'POST' && url.pathname === '/api/auth/verify') {
      const { phone, code } = await readJson(req);
      const normalizedPhone = normalizePhone(phone);
      if (isRateLimited(`verify:${requestIp(req)}:${normalizedPhone}`, { windowMs: 10 * 60_000, limit: 8 })) {
        return send(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      }
      const otpResult = await query(
        'SELECT code_hash FROM otp_codes WHERE phone = $1 AND expires_at > NOW()',
        [normalizedPhone]
      );
      if (!otpResult.rowCount || hashOtp(normalizedPhone, safeText(code, 6)) !== otpResult.rows[0].code_hash) {
        return send(res, 401, { error: 'Code incorrect ou expiré.' });
      }
      const roles = demoMode
        ? ['buyer', 'seller', 'courier', 'admin']
        : adminPhones.has(normalizedPhone) ? ['buyer', 'seller', 'admin'] : ['buyer'];
      const userResult = await query(
        `INSERT INTO users (id, phone, name, roles) VALUES ($1, $2, $3, $4::text[])
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone, roles = EXCLUDED.roles
         RETURNING id, phone, name, roles, created_at`,
        [randomUUID(), normalizedPhone, 'Jean-Marc Mbuyi', roles]
      );
      const user = userFromRow(userResult.rows[0]);
      const token = randomUUID();
      await query('DELETE FROM otp_codes WHERE phone = $1', [normalizedPhone]);
      await query(
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [hashToken(token), user.id]
      );
      return send(res, 200, { token, user, demo: demoMode });
    }

    if (method === 'GET' && url.pathname === '/api/me') {
      const user = await currentUser(req);
      return user ? send(res, 200, { user }) : send(res, 401, { error: 'Connexion requise.' });
    }

    if (method === 'POST' && url.pathname === '/api/listings') {
      const user = await requireRole(req, res, ['seller', 'admin']);
      if (!user) return;
      const input = await readJson(req);
      const normalized = normalizeListing(input);
      const listing = {
        seller: normalized.category === 'Automobile' ? 'Auto Kin RDC' : user.name,
        rating: '4,9', sales: 0, ...normalized
      };
      if (!listing.name || !listing.price) return send(res, 400, { error: 'Un titre et un prix sont nécessaires.' });
      const placeholders = listingFields.map((_, index) => `$${index + 1}`).join(', ');
      const result = await query(
        `INSERT INTO products (${listingFields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        listingValues(listing, user.id)
      );
      return send(res, 201, { listing: productFromRow(result.rows[0]) });
    }

    const listingMatch = url.pathname.match(/^\/api\/listings\/(\d+)$/);
    if (method === 'PATCH' && listingMatch) {
      const user = await requireRole(req, res, ['seller', 'admin']);
      if (!user) return;
      const existing = await query('SELECT * FROM products WHERE id = $1', [Number(listingMatch[1])]);
      if (!existing.rowCount) return send(res, 404, { error: 'Annonce introuvable.' });
      const row = existing.rows[0];
      if (!user.roles.includes('admin') && row.owner_user_id !== user.id) return send(res, 403, { error: 'Vous ne pouvez modifier que vos annonces.' });
      const previous = productFromRow(row);
      const listing = { ...previous, ...normalizeListing(await readJson(req), previous), seller: row.seller, rating: row.rating, sales: asNumber(row.sales) };
      const assignments = listingFields.slice(0, -1).map((field, index) => `${field} = $${index + 1}`).join(', ');
      const result = await query(
        `UPDATE products SET ${assignments}, updated_at = NOW() WHERE id = $${listingFields.length} RETURNING *`,
        [...listingValues(listing, row.owner_user_id).slice(0, -1), row.id]
      );
      return send(res, 200, { listing: productFromRow(result.rows[0]) });
    }

    if (method === 'GET' && url.pathname === '/api/orders') {
      const user = await requireRole(req, res, ['buyer', 'seller', 'courier', 'admin']);
      if (!user) return;
      const result = user.roles.includes('admin')
        ? await query('SELECT * FROM orders ORDER BY created_at DESC')
        : await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
      return send(res, 200, { orders: result.rows.map(orderFromRow) });
    }

    if (method === 'POST' && url.pathname === '/api/orders') {
      const user = await requireRole(req, res, ['buyer']);
      if (!user) return;
      const { items = [], payment = 'Mobile Money' } = await readJson(req);
      const productIds = Array.isArray(items) ? items.map(item => Number(item.id)).filter(Number.isFinite) : [];
      const productResult = await query('SELECT * FROM products WHERE id = ANY($1::bigint[])', [productIds]);
      const products = productResult.rows.map(productFromRow);
      if (!products.length) return send(res, 400, { error: 'Le panier est vide.' });
      const total = products.reduce((sum, product) => sum + product.price, 0) + 10000;
      const order = {
        id: `TK-${randomUUID().slice(0, 8).toUpperCase()}`, userId: user.id,
        items: products.map(product => ({ id: product.id, name: product.name, price: product.price })),
        total, payment: safeText(payment, 40), status: 'Confirmée'
      };
      const result = await query(
        `INSERT INTO orders (order_number, user_id, items, total_cdf, payment, status)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
        [order.id, order.userId, JSON.stringify(order.items), order.total, order.payment, order.status]
      );
      return send(res, 201, { order: orderFromRow(result.rows[0]) });
    }

    if (method === 'POST' && url.pathname === '/api/messages') {
      const user = await requireRole(req, res, ['buyer', 'seller', 'courier', 'admin']);
      if (!user) return;
      const { recipient, text } = await readJson(req);
      const message = { id: randomUUID(), sender: user.name, recipient: safeText(recipient, 80), text: safeText(text, 1000) };
      if (!message.text) return send(res, 400, { error: 'Message vide.' });
      const result = await query(
        'INSERT INTO messages (id, sender, recipient, body) VALUES ($1, $2, $3, $4) RETURNING id, sender, recipient, body, created_at',
        [message.id, message.sender, message.recipient, message.text]
      );
      const saved = result.rows[0];
      return send(res, 201, { message: { id: saved.id, sender: saved.sender, recipient: saved.recipient, text: saved.body, createdAt: saved.created_at } });
    }

    if (method === 'GET' && files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      const filePath = path.join(root, file);
      await access(filePath);
      const content = await readFile(filePath);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(content);
      return;
    }

    send(res, 404, { error: 'Ressource introuvable.' });
  } catch (error) {
    console.error(error);
    const status = error instanceof SyntaxError ? 400 : 500;
    send(res, status, { error: status === 400 ? 'JSON invalide.' : 'Erreur serveur.', detail: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

server.listen(port, '0.0.0.0', async () => {
  try {
    await query('SELECT 1');
    console.log(`TekaSafe disponible sur http://127.0.0.1:${port} (PostgreSQL connecté)`);
    if (demoMode) console.log('Mode démo : OTP 1234. Ne pas exposer ce mode sur Internet.');
  } catch (error) {
    console.error('Connexion PostgreSQL impossible. Vérifiez DATABASE_URL puis lancez npm run db:init.');
    console.error(error.message);
    server.close();
    await closeDatabase();
    process.exitCode = 1;
  }
});

async function shutdown() {
  server.close();
  await closeDatabase();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
