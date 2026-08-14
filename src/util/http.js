// Wrappers de rede: timeout, User-Agent de navegador, concorrencia limitada.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} em ${url}`);
    this.status = status;
    this.url = url;
  }
}

export async function fetchWithTimeout(url, { timeout = 8000, headers = {}, ...rest } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...rest,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Buscadores publicos limitam por rajada. Uma tentativa extra com espera
 * resolve a maioria dos 429/503 sem penalizar o caso normal.
 */
async function fetchOk(url, { retries = 1, ...opts } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetchWithTimeout(url, opts);
    if (res.ok) return res;
    lastError = new HttpError(res.status, url);
    const retryable = res.status === 429 || res.status === 503 || res.status === 202;
    if (!retryable || attempt === retries) throw lastError;
    await sleep(600 * (attempt + 1));
  }
  throw lastError;
}

export async function fetchText(url, opts = {}) {
  const res = await fetchOk(url, opts);
  return res.text();
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchOk(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
  });
  return res.json();
}

/** map com limite de concorrencia; nunca rejeita, devolve {ok,value|error}. */
export async function pMapSettled(items, worker, concurrency = 6) {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;

  async function run() {
    while (cursor < list.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await worker(list[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, run));
  return results;
}
