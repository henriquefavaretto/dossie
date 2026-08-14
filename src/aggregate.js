// Orquestracao da busca.
//
// Fases: 1) matriz de dorks nos buscadores  2) fontes auxiliares e de documentos
// 3) fusao/dedupe/relevancia  4) leitura dos PDFs  5) sondagem de perfis.
// Cada fase emite evento, para a interface ir preenchendo em vez de esperar tudo.
import { engines, auxProviders } from './providers/web.js';
import { identityProviders } from './providers/identity.js';
import { documentProviders } from './providers/documents.js';
import { socialProbe } from './providers/socialProbe.js';
import { buildQueryPlan, budgetFor } from './dorks.js';
import { createLimiters } from './util/limiter.js';
import { pMapSettled } from './util/http.js';
import { matchName, isAboutPerson, truncate } from './util/text.js';
import { classify, CATEGORY_ORDER, CATEGORY_LABEL } from './classify.js';
import { computeScore, ambiguity } from './score.js';
import { looksLikePdf, extractPdfEvidence } from './pdf.js';

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref|source|igshid|si)$/i;
const MAX_PDFS = 24; // PDFs abertos e lidos por busca

function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING.test(key)) u.searchParams.delete(key);
    }
    return `${u.hostname}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

class Tracker {
  constructor(onEvent) {
    this.onEvent = onEvent || (() => {});
    this.status = new Map();
  }

  ensure(id, label) {
    if (!this.status.has(id)) {
      this.status.set(id, { id, label, count: 0, queries: 0, ms: 0, status: 'ok', error: null });
    }
    return this.status.get(id);
  }

  record(id, label, { count = 0, ms = 0, error = null }) {
    const entry = this.ensure(id, label);
    entry.queries += 1;
    entry.count += count;
    entry.ms += ms;
    if (error && entry.count === 0) {
      entry.status = 'falhou';
      entry.error = truncate(error, 140);
    } else if (entry.count > 0) {
      entry.status = 'ok';
      entry.error = null;
    }
    this.onEvent({ type: 'provider', provider: { ...entry } });
  }

  list() {
    return [...this.status.values()];
  }
}

/** Fase 1: matriz de dorks contra cada buscador, respeitando o orcamento. */
async function runEngines(plan, env, limiters, tracker, collect) {
  const active = engines.filter((e) => {
    try {
      return e.enabled(env);
    } catch {
      return false;
    }
  });

  await Promise.all(
    active.map(async (engine) => {
      const limiter = limiters[engine.id] || limiters.default;
      const dorks = budgetFor(engine, plan);

      // A consulta base merece paginacao; os dorks, so a primeira pagina.
      const jobs = [];
      for (const dork of dorks) {
        const pages = dork.tag === 'base' ? engine.pages || 1 : 1;
        for (let page = 0; page < pages; page += 1) jobs.push({ dork, page });
      }

      for (const { dork, page } of jobs) {
        if (!limiter.isOpen) {
          tracker.record(engine.id, engine.label, {
            error: 'bloqueado após respostas vazias seguidas',
          });
          break;
        }
        const t0 = Date.now();
        try {
          const items = await limiter.run(() => engine.search(dork.q, { env, page }));
          limiter.report(items.length > 0);
          collect(items, dork);
          tracker.record(engine.id, engine.label, { count: items.length, ms: Date.now() - t0 });
        } catch (error) {
          limiter.report(false);
          tracker.record(engine.id, engine.label, {
            ms: Date.now() - t0,
            error: error.message,
          });
        }
      }
    }),
  );
}

/** Fases 2: provedores de indice proprio (um disparo cada). */
async function runSimpleProviders(list, name, env, tracker, collect) {
  await pMapSettled(
    list.filter((p) => {
      try {
        return p.enabled(env);
      } catch {
        return false;
      }
    }),
    async (provider) => {
      const t0 = Date.now();
      try {
        const items = await provider.run(name, { env });
        collect(items, { tag: provider.kind === 'document' ? 'documento' : 'base' });
        tracker.record(provider.id, provider.label, {
          count: items.length,
          ms: Date.now() - t0,
        });
      } catch (error) {
        tracker.record(provider.id, provider.label, { ms: Date.now() - t0, error: error.message });
      }
    },
    6,
  );
}

export async function searchPerson(name, options = {}) {
  const {
    context = '',
    includeProfiles = true,
    readPdfs = true,
    // 0.5 deixa passar frase parcial com token distintivo e barra o resto.
    minRelevance = 0.5,
    env = process.env,
    onEvent = () => {},
  } = options;

  const t0 = Date.now();
  const plan = buildQueryPlan(name, context);
  const limiters = createLimiters();
  const tracker = new Tracker(onEvent);

  const merged = new Map();
  const collect = (items, dork) => {
    let added = 0;
    for (const raw of items || []) {
      if (!raw?.url || !/^https?:\/\//i.test(raw.url)) continue;
      const key = canonical(raw.url);

      const match = matchName(name, raw);
      // Fonte de identidade (Wikidata, OpenAlex) ja resolveu a pessoa, mas
      // mesmo ela precisa casar a frase - senao vira homonimo com selo de
      // qualidade.
      const rel = raw.authority && match.score > 0 ? Math.max(0.85, match.score) : match.score;
      if (rel < minRelevance) continue;

      const existing = merged.get(key);
      if (existing) {
        existing.sources = [...new Set([...existing.sources, raw.source])];
        if (rel > existing.relevance) {
          existing.relevance = rel;
          existing.match = match.kind;
          existing.matched = match.matched;
        }
        if (!existing.snippet && raw.snippet) existing.snippet = raw.snippet;
        if (!existing.image && raw.image) existing.image = raw.image;
        if (dork?.tag && !existing.tags.includes(dork.tag)) existing.tags.push(dork.tag);
        continue;
      }

      const { host, category, weight } = classify(raw);
      const aboutPerson = raw.authority || raw.isDocument || isAboutPerson(name, raw);
      const isPdf = looksLikePdf(raw.url);

      merged.set(key, {
        url: raw.url,
        title: raw.title || host,
        snippet: raw.snippet || '',
        host,
        category,
        // Casamento parcial ("Carlos Dumond" quando se buscou "Carlos Dumond
        // Silva") pode ser outra pessoa: pesa menos e vai marcado na interface.
        weight: (aboutPerson ? weight : weight * 0.35) * (match.kind === 'parcial' ? 0.5 : 1),
        mention: !aboutPerson,
        match: match.kind,
        matched: match.matched,
        relevance: rel,
        sources: [raw.source],
        tags: dork?.tag ? [dork.tag] : [],
        image: raw.image || null,
        publishedAt: raw.publishedAt || null,
        isPdf,
        isDocument: Boolean(raw.isDocument) || isPdf,
        meta: raw.meta || null,
        pdf: null,
      });
      added += 1;
    }
    if (added) onEvent({ type: 'count', total: merged.size });
  };

  onEvent({
    type: 'plan',
    queries: plan.length,
    engines: engines.filter((e) => e.enabled(env)).map((e) => e.label),
    hasStrongEngine: engines.some((e) => e.strong && e.enabled(env)),
  });

  // --- fase 1 + 2 em paralelo ---
  onEvent({ type: 'phase', phase: 'buscando', label: 'Consultando buscadores e documentos' });
  await Promise.all([
    runEngines(plan, env, limiters, tracker, collect),
    runSimpleProviders([...auxProviders, ...identityProviders], name, env, tracker, collect),
    runSimpleProviders(documentProviders, name, env, tracker, collect),
  ]);

  let results = [...merged.values()];
  onEvent({ type: 'partial', total: results.length });

  // --- fase 3: ler os PDFs encontrados ---
  if (readPdfs) {
    const pdfs = results
      .filter((r) => r.isPdf)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_PDFS);

    if (pdfs.length) {
      onEvent({
        type: 'phase',
        phase: 'pdf',
        label: `Lendo ${pdfs.length} documento(s) PDF`,
      });
      await pMapSettled(
        pdfs,
        async (item) => {
          const evidence = await extractPdfEvidence(item.url, name);
          if (!evidence) return;
          item.pdf = evidence;
          if (evidence.nameFound) {
            // Nome confirmado DENTRO do arquivo: evidencia forte, nao mencao.
            item.mention = false;
            item.relevance = Math.max(item.relevance, 0.95);
            item.weight = Math.max(item.weight, 2.2);
            if (evidence.excerpts[0]) item.snippet = evidence.excerpts[0].text;
          }
          onEvent({ type: 'pdf', url: item.url, found: evidence.nameFound });
        },
        6,
      );
    }
  }

  // --- fase 4: sondagem de perfis ---
  let probe = { profiles: [], manual: [] };
  if (includeProfiles) {
    onEvent({ type: 'phase', phase: 'perfis', label: 'Sondando perfis públicos' });
    probe = await socialProbe.run(name).catch(() => ({ profiles: [], manual: [] }));
  }

  // --- fase 5: ordenar, pontuar, agrupar ---
  results = [...merged.values()].sort((a, b) => {
    // Chave primaria: nome completo sempre antes de correspondencia parcial.
    const ka = a.match === 'parcial' ? 1 : 0;
    const kb = b.match === 'parcial' ? 1 : 0;
    if (ka !== kb) return ka - kb;

    const sa = a.relevance * a.weight + a.sources.length * 0.15 + (a.pdf?.nameFound ? 1.5 : 0);
    const sb = b.relevance * b.weight + b.sources.length * 0.15 + (b.pdf?.nameFound ? 1.5 : 0);
    return sb - sa;
  });

  const visibility = computeScore(results, { profiles: probe.profiles });
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category] || category,
    items: results.filter((r) => r.category === category),
  })).filter((g) => g.items.length);

  const documents = results.filter((r) => r.isDocument);

  const payload = {
    query: { name: name.trim(), context: context.trim(), plannedQueries: plan.length },
    tookMs: Date.now() - t0,
    visibility,
    ambiguity: ambiguity(results, name),
    groups,
    results,
    exactMatches: results.filter((r) => r.match === 'exato').length,
    partialMatches: results.filter((r) => r.match === 'parcial').length,
    documents,
    pdfsRead: documents.filter((d) => d.pdf).length,
    // Vale como evidencia tanto o trecho extraido do PDF aqui quanto o trecho
    // que a fonte ja entregou (o Querido Diario devolve o texto do diario).
    docsWithExcerpt: documents.filter((d) => d.pdf?.nameFound || d.meta?.excerpts?.length).length,
    profiles: probe.profiles,
    manualChecks: probe.manual,
    topDomains: topDomains(results),
    providers: tracker.list(),
    advice: adviceFor(env, tracker),
  };

  onEvent({ type: 'done', payload });
  return payload;
}

/** Diz ao usuario, com franqueza, por que o resultado veio curto. */
function adviceFor(env, tracker) {
  const notes = [];
  const hasStrong = engines.some((e) => e.strong && e.enabled(env));
  if (!hasStrong) {
    notes.push(
      'Rodando no modo gratuito: Brave web e DuckDuckGo respeitam os operadores, ' +
        'mas bloqueiam por rajada, então só a parte de maior prioridade da matriz de ' +
        'consultas é enviada. Com BRAVE_API_KEY ou GOOGLE_API_KEY no .env as 24 ' +
        'consultas rodam completas, com paginação.',
    );
  }
  const blocked = tracker.list().filter((p) => p.status === 'falhou');
  if (blocked.length) {
    notes.push(`Fontes que não responderam: ${blocked.map((b) => b.label).join(', ')}.`);
  }
  return notes;
}

function topDomains(results, limit = 12) {
  const counts = new Map();
  for (const r of results) counts.set(r.host, (counts.get(r.host) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([host, count]) => ({ host, count }));
}
