import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { searchPerson } from './src/aggregate.js';
import { TTLCache } from './src/util/cache.js';
import { normalize } from './src/util/text.js';

try {
  process.loadEnvFile();
} catch {
  // sem .env: roda so com os provedores que nao pedem chave
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPTOUT_FILE = path.join(__dirname, 'data', 'optout.json');

const cache = new TTLCache({ ttlMs: 30 * 60 * 1000, max: 300 });

app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  // Buscas sobre pessoas nao devem ser indexadas por outros buscadores.
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------- limite por IP simples
const buckets = new Map();
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);

function rateLimit(req, res, next) {
  const ip = req.ip || 'anon';
  const now = Date.now();
  const bucket = buckets.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  buckets.set(ip, bucket);
  if (bucket.count > LIMIT) {
    return res.status(429).json({
      error: 'Muitas buscas. Aguarde um minuto.',
      retryAfterMs: bucket.resetAt - now,
    });
  }
  return next();
}

// --------------------------------------------------------------------- opt-out
async function readOptOut() {
  try {
    return JSON.parse(await fs.readFile(OPTOUT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function isBlocked(name) {
  const list = await readOptOut();
  return list.includes(normalize(name));
}

app.post('/api/optout', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 3) return res.status(400).json({ error: 'Informe o nome completo.' });
  const list = await readOptOut();
  const key = normalize(name);
  if (!list.includes(key)) list.push(key);
  await fs.mkdir(path.dirname(OPTOUT_FILE), { recursive: true });
  await fs.writeFile(OPTOUT_FILE, JSON.stringify(list, null, 2), 'utf8');
  cache.store.clear();
  res.json({ ok: true, message: 'Nome bloqueado para buscas nesta instância.' });
});

// ---------------------------------------------------------------------- busca
app.get('/api/search', rateLimit, async (req, res) => {
  const name = String(req.query.q || '').trim();
  const context = String(req.query.context || '').trim();
  const includeProfiles = req.query.profiles !== '0';

  if (name.length < 3) {
    return res.status(400).json({ error: 'Digite um nome com pelo menos 3 caracteres.' });
  }
  if (name.length > 80) {
    return res.status(400).json({ error: 'Nome muito longo.' });
  }
  if (await isBlocked(name)) {
    return res.status(451).json({
      error: 'Este nome foi removido a pedido do titular (LGPD/GDPR).',
      optOut: true,
    });
  }

  const key = `${normalize(name)}|${normalize(context)}|${includeProfiles ? 1 : 0}`;
  try {
    const { value, cached } = await cache.wrap(key, () =>
      searchPerson(name, { context, includeProfiles }),
    );
    res.json({ ...value, cached });
  } catch (error) {
    console.error('[busca]', error);
    res.status(500).json({ error: 'Falha ao consultar os provedores.', detail: error.message });
  }
});

// -------------------------------------------------- busca com streaming (SSE)
// A matriz de dorks leva dezenas de segundos: em vez de deixar a tela parada,
// manda cada fase assim que acontece.
app.get('/api/search/stream', rateLimit, async (req, res) => {
  const name = String(req.query.q || '').trim();
  const context = String(req.query.context || '').trim();

  if (name.length < 3 || name.length > 80) {
    return res.status(400).json({ error: 'Nome inválido.' });
  }
  if (await isBlocked(name)) {
    return res.status(451).json({ error: 'Nome removido a pedido do titular.', optOut: true });
  }

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const key = `${normalize(name)}|${normalize(context)}|1`;
  const cached = cache.get(key);
  if (cached) {
    send({ type: 'done', payload: { ...cached, cached: true } });
    return res.end();
  }

  try {
    const payload = await searchPerson(name, {
      context,
      includeProfiles: req.query.profiles !== '0',
      readPdfs: req.query.pdf !== '0',
      onEvent: (event) => {
        if (!aborted && event.type !== 'done') send(event);
      },
    });
    cache.set(key, payload);
    send({ type: 'done', payload });
  } catch (error) {
    console.error('[stream]', error);
    send({ type: 'error', error: error.message });
  }
  res.end();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    providers: {
      brave: Boolean(process.env.BRAVE_API_KEY),
      google: Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID),
      searxng: Boolean(process.env.SEARXNG_URL),
      github: Boolean(process.env.GITHUB_TOKEN),
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n  WebMii clone rodando em http://localhost:${PORT}\n`);
});
