// Buscadores web.
//
// Cada motor declara o que sabe fazer, e o orquestrador decide quantas consultas
// da matriz de dorks mandar para ele:
//   strong            - tem chave/instancia propria, aguenta o plano inteiro
//   supportsOperators - respeita site: e filetype: (verificado na marra)
//   pages             - quantas paginas de paginacao vale a pena puxar
//
// Medido nesta maquina: o Bing IGNORA site:/filetype: no feed publico (devolve
// os mesmos 10 itens para qualquer operador), enquanto o DuckDuckGo respeita os
// dois - mas bloqueia depois de ~12 requisicoes seguidas.
import * as cheerio from 'cheerio';
import { fetchText, fetchJson } from '../util/http.js';
import { stripTags, truncate } from '../util/text.js';

const clean = (v) => truncate(stripTags(v || ''), 320);

function absolute(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ Brave Search API
// Plano gratuito: 2.000 consultas/mes. Respeita operadores e pagina de verdade.
// E o caminho recomendado - scraping gratuito nao chega perto.
export const brave = {
  id: 'brave',
  label: 'Brave Search',
  kind: 'engine',
  strong: true,
  supportsOperators: true,
  pages: 3,
  enabled: (env) => Boolean(env.BRAVE_API_KEY),
  async search(query, { env = process.env, page = 0 } = {}) {
    const data = await fetchJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
        `&count=20&offset=${page}&country=BR&search_lang=pt`,
      {
        timeout: 12000,
        headers: { 'X-Subscription-Token': env.BRAVE_API_KEY, Accept: 'application/json' },
      },
    );
    return (data?.web?.results || []).map((r) => ({
      url: r.url,
      title: clean(r.title),
      snippet: clean(r.description),
      source: 'brave',
    }));
  },
};

// --------------------------------------------- Google Programmable Search (CSE)
// 100 consultas/dia gratis. Indice do Google, com operadores completos.
export const googleCse = {
  id: 'google',
  label: 'Google (CSE)',
  kind: 'engine',
  strong: true,
  supportsOperators: true,
  pages: 2,
  enabled: (env) => Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID),
  async search(query, { env = process.env, page = 0 } = {}) {
    const data = await fetchJson(
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(env.GOOGLE_API_KEY)}` +
        `&cx=${encodeURIComponent(env.GOOGLE_CSE_ID)}&num=10&start=${page * 10 + 1}` +
        `&q=${encodeURIComponent(query)}`,
      { timeout: 12000 },
    );
    return (data.items || []).map((r) => ({
      url: r.link,
      title: clean(r.title),
      snippet: clean(r.snippet),
      source: 'google',
      image: r.pagemap?.cse_thumbnail?.[0]?.src || null,
    }));
  },
};

// ---------------------------------------------------------- SearXNG (self-host)
export const searxng = {
  id: 'searxng',
  label: 'SearXNG',
  kind: 'engine',
  strong: true,
  supportsOperators: true,
  pages: 2,
  enabled: (env) => Boolean(env.SEARXNG_URL),
  async search(query, { env = process.env, page = 0 } = {}) {
    const base = env.SEARXNG_URL.replace(/\/+$/, '');
    const data = await fetchJson(
      `${base}/search?q=${encodeURIComponent(query)}&format=json&language=pt-BR&pageno=${page + 1}`,
      { timeout: 15000 },
    );
    return (data.results || []).map((r) => ({
      url: r.url,
      title: clean(r.title),
      snippet: clean(r.content),
      source: 'searxng',
    }));
  },
};

// ------------------------------------------------------- Brave (HTML, sem chave)
// Achado importante: a busca web do Brave responde sem chave, RESPEITA
// site:/filetype: e ainda pagina. E o melhor motor gratuito para a matriz de
// dorks - bem mais confiavel que o DuckDuckGo, que bloqueia por rajada.
export const braveHtml = {
  id: 'bravehtml',
  label: 'Brave (web)',
  kind: 'engine',
  strong: false,
  supportsOperators: true,
  maxQueries: 12,
  pages: 3,
  enabled: (env) => !env.BRAVE_API_KEY, // com chave, usa a API oficial
  async search(query, { page = 0 } = {}) {
    const html = await fetchText(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}&offset=${page}&country=br`,
      { timeout: 14000, retries: 0 },
    );
    const $ = cheerio.load(html);
    const out = [];

    $('.snippet').each((_, el) => {
      const node = $(el);
      const href = node.find('a[href^="http"]').first().attr('href');
      if (!href || href.includes('search.brave.com')) return;

      const title = node.find('.title').first().text().trim();
      // As classes do Brave sao geradas pelo Svelte e mudam entre deploys;
      // por isso a descricao sai do texto do bloco menos o titulo.
      const whole = node.text().replace(/\s+/g, ' ').trim();
      const snippet = title ? whole.replace(title, '').trim() : whole;

      out.push({
        url: href,
        title: clean(title || href),
        snippet: clean(snippet),
        source: 'bravehtml',
      });
    });
    return out;
  },
};

// ---------------------------------------------------------- DuckDuckGo (HTML)
// Gratuito e respeita site:/filetype:, mas bloqueia por rajada - por isso vai
// limitado as consultas de maior prioridade, uma por vez, com intervalo.
export const duckduckgo = {
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  kind: 'engine',
  strong: false,
  supportsOperators: true,
  maxQueries: 7,
  pages: 1,
  enabled: () => true,
  async search(query, { page = 0 } = {}) {
    const offset = page > 0 ? `&s=${page * 20}&dc=${page * 20 + 1}` : '';
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt${offset}`,
      { timeout: 12000, retries: 0 },
    );
    const results = parseDdgHtml(html);
    if (results.length) return results;

    const liteHtml = await fetchText(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      { timeout: 12000, retries: 0 },
    );
    return parseDdgLite(liteHtml);
  },
};

/** DDG embrulha o destino real em /l/?uddg=<url>. */
function unwrapDdg(href) {
  const abs = absolute(href, 'https://duckduckgo.com');
  if (!abs) return null;
  try {
    const real = new URL(abs).searchParams.get('uddg');
    if (real) return real;
  } catch {
    /* mantem */
  }
  return abs.startsWith('http') ? abs : null;
}

function parseDdgHtml(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.result, .web-result').each((_, el) => {
    const node = $(el);
    const anchor = node.find('a.result__a').first();
    const href = unwrapDdg(anchor.attr('href') || '');
    if (!href) return;
    out.push({
      url: href,
      title: clean(anchor.text()),
      snippet: clean(node.find('.result__snippet').first().text()),
      source: 'duckduckgo',
    });
  });
  return out;
}

function parseDdgLite(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a.result-link').each((_, el) => {
    const anchor = $(el);
    const href = unwrapDdg(anchor.attr('href') || '');
    if (!href) return;
    out.push({
      url: href,
      title: clean(anchor.text()),
      snippet: clean(anchor.closest('tr').next('tr').find('.result-snippet').text()),
      source: 'duckduckgo',
    });
  });
  return out;
}

// ---------------------------------------------------------------- Bing (RSS)
// Estavel para o nome puro, mas RELAXA a consulta e ignora operadores: pedir
// filetype:pdf aqui devolve os mesmos links de sempre. So recebe consulta base.
export const bing = {
  id: 'bing',
  label: 'Bing',
  kind: 'engine',
  strong: false,
  supportsOperators: false,
  maxQueries: 3,
  pages: 1,
  enabled: () => true,
  async search(query) {
    const xml = await fetchText(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20`,
      { timeout: 12000 },
    );
    const $ = cheerio.load(xml, { xmlMode: true });
    const out = [];
    $('item').each((_, el) => {
      const item = $(el);
      const link = item.find('link').text().trim();
      if (!link.startsWith('http')) return;
      out.push({
        url: link,
        title: clean(item.find('title').text()),
        snippet: clean(item.find('description').text()),
        source: 'bing',
      });
    });
    return out;
  },
};

export const engines = [brave, googleCse, searxng, braveHtml, duckduckgo, bing];

// ---------------------------------------------------------------------------
// Auxiliares: rodam so na consulta base, cada um no seu indice proprio.
// ---------------------------------------------------------------------------

export const wikipedia = {
  id: 'wikipedia',
  label: 'Wikipedia (texto)',
  kind: 'aux',
  enabled: () => true,
  async run(name) {
    const out = [];
    for (const lang of ['pt', 'en']) {
      try {
        const data = await fetchJson(
          `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*` +
            `&srlimit=8&srsearch=${encodeURIComponent(`"${name}"`)}`,
          { timeout: 10000 },
        );
        for (const hit of data.query?.search || []) {
          out.push({
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
            title: hit.title,
            snippet: clean(hit.snippet),
            source: 'wikipedia',
          });
        }
      } catch {
        /* um idioma pode falhar sem derrubar o outro */
      }
    }
    return out;
  },
};

export const youtube = {
  id: 'youtube',
  label: 'YouTube',
  kind: 'aux',
  enabled: () => true,
  async run(name) {
    const html = await fetchText(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`"${name}"`)}`,
      { timeout: 15000 },
    );
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!match) return [];
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return [];
    }

    const out = [];
    walk(data, (node) => {
      if (out.length >= 14) return;
      if (node.videoRenderer?.videoId) {
        const v = node.videoRenderer;
        out.push({
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          title: clean(runs(v.title)),
          snippet: clean(
            [runs(v.ownerText), runs(v.detailedMetadataSnippets?.[0]?.snippetText)]
              .filter(Boolean)
              .join(' — '),
          ),
          source: 'youtube',
          category: 'video',
        });
      } else if (node.channelRenderer?.channelId) {
        const c = node.channelRenderer;
        out.push({
          url: `https://www.youtube.com/channel/${c.channelId}`,
          title: clean(c.title?.simpleText || runs(c.title)),
          snippet: clean(runs(c.descriptionSnippet) || 'Canal do YouTube'),
          source: 'youtube',
          category: 'video',
        });
      }
    });
    return out;
  },
};

function runs(field) {
  if (!field) return '';
  if (field.simpleText) return field.simpleText;
  return (field.runs || []).map((r) => r.text).join('');
}

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return;
  visit(node);
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    if (value && typeof value === 'object') walk(value, visit, depth + 1);
  }
}

export const hackernews = {
  id: 'hackernews',
  label: 'Hacker News',
  kind: 'aux',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${name}"`)}&hitsPerPage=8`,
      { timeout: 10000 },
    );
    return (data.hits || [])
      .filter((h) => h.objectID)
      .map((h) => ({
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: clean(h.title || h.story_title || 'Discussão no Hacker News'),
        snippet: clean(h.story_text || h.comment_text || `por ${h.author}`),
        source: 'hackernews',
      }));
  },
};

export const news = {
  id: 'news',
  label: 'Google News',
  kind: 'aux',
  enabled: () => true,
  async run(name) {
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
      { timeout: 10000 },
    );
    const $ = cheerio.load(xml, { xmlMode: true });
    const out = [];
    $('item').each((_, el) => {
      if (out.length >= 20) return;
      const item = $(el);
      const link = item.find('link').text().trim();
      if (!link.startsWith('http')) return;
      out.push({
        url: link,
        title: clean(item.find('title').text()),
        snippet: clean(item.find('source').text() || item.find('description').text()),
        source: 'news',
        category: 'noticias',
        publishedAt: item.find('pubDate').text().trim() || null,
      });
    });
    return out;
  },
};

// Marginalia: indice proprio, rastreado de forma independente. Acha sites
// pequenos e paginas antigas que Google e Bing ja largaram.
export const marginalia = {
  id: 'marginalia',
  label: 'Marginalia',
  kind: 'aux',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://api.marginalia.nu/public/search/${encodeURIComponent(`"${name}"`)}`,
      { timeout: 12000 },
    );
    return (data.results || []).slice(0, 12).map((r) => ({
      url: r.url,
      title: clean(r.title),
      snippet: clean(r.description),
      source: 'marginalia',
    }));
  },
};

export const auxProviders = [wikipedia, youtube, hackernews, news, marginalia];
