const $ = (id) => document.getElementById(id);
const form = $('search-form');
const statusBox = $('status');
const progressBox = $('progress');
const resultsBox = $('results');

const PHASES = { buscando: 0.45, pdf: 0.8, perfis: 0.92 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let current = null;
let activeFilter = 'all';
let stream = null;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('q').value.trim();
  if (name.length < 3) return;
  startSearch(name, $('context').value.trim());
});

// sugestões preenchem e disparam a busca
document.querySelectorAll('.chip[data-fill]').forEach((chip) =>
  chip.addEventListener('click', () => {
    $('q').value = chip.dataset.fill;
    $('context').value = '';
    form.requestSubmit();
  }),
);

function startSearch(name, context) {
  if (stream) stream.close();
  $('submit').disabled = true;
  hide(statusBox);
  resultsBox.hidden = true;

  progressBox.hidden = false;
  $('phase-label').textContent = `Montando plano de busca para ${name}`;
  $('live-count').textContent = '0';
  $('progress-fill').style.width = '4%';
  $('progress-providers').innerHTML = '';

  const params = new URLSearchParams({ q: name });
  if (context) params.set('context', context);

  const providers = new Map();
  stream = new EventSource(`/api/search/stream?${params}`);

  stream.onmessage = (message) => {
    const event = JSON.parse(message.data);

    if (event.type === 'plan') {
      $('phase-label').textContent =
        `${event.queries} consultas planejadas · ${event.engines.length} buscador(es)`;
      $('progress-fill').style.width = '8%';
    }
    if (event.type === 'phase') {
      $('phase-label').textContent = event.label;
      $('progress-fill').style.width = `${(PHASES[event.phase] || 0.5) * 100}%`;
    }
    if (event.type === 'count') {
      $('live-count').textContent = `${event.total} resultados`;
    }
    if (event.type === 'provider') {
      providers.set(event.provider.id, event.provider);
      renderRunSources(providers);
    }
    if (event.type === 'pdf') {
      $('phase-label').textContent = event.found
        ? `Nome localizado em ${shortUrl(event.url)}`
        : `Lendo ${shortUrl(event.url)}`;
    }
    if (event.type === 'error') {
      finish();
      show(statusBox, escapeHtml(event.error));
    }
    if (event.type === 'done') {
      current = event.payload;
      activeFilter = 'all';
      $('progress-fill').style.width = '100%';
      render(current);
      finish();
    }
  };

  stream.onerror = () => {
    if (!current) show(statusBox, 'Conexão interrompida. Tente novamente.');
    finish();
  };
}

function finish() {
  if (stream) stream.close();
  stream = null;
  $('submit').disabled = false;
  setTimeout(() => {
    progressBox.hidden = true;
  }, 700);
}

function renderRunSources(providers) {
  $('progress-providers').innerHTML = [...providers.values()]
    .map(
      (p, i) =>
        `<li class="${p.status === 'ok' ? 'ok' : 'fail'}" style="animation-delay:${i * 20}ms">${escapeHtml(p.label)}<span>${
          p.status === 'ok' ? p.count : '—'
        }</span></li>`,
    )
    .join('');
}

const show = (el, html) => {
  el.innerHTML = html;
  el.hidden = false;
};
const hide = (el) => {
  el.hidden = true;
};

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(0, 56);
  } catch {
    return url.slice(0, 56);
  }
}

/**
 * Contagem animada do índice.
 * O valor final é escrito ANTES de animar: requestAnimationFrame não roda
 * enquanto a aba está oculta, e o número não pode depender da animação para
 * estar correto.
 */
function countUp(el, target) {
  el.textContent = target.toFixed(1);
  if (reduceMotion) return;

  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / 900, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (target * eased).toFixed(1);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --------------------------------------------------------------- renderização
function render(data) {
  resultsBox.hidden = false;

  countUp($('score'), data.visibility.score);
  $('score-label').textContent = data.visibility.label;
  // A transição do CSS já anima a partir de 0; não precisa de rAF.
  $('score-fill').style.width = `${(data.visibility.score / 10) * 100}%`;

  $('result-name').textContent = data.query.name;
  $('result-stats').innerHTML = [
    [data.results.length, 'resultados'],
    [data.exactMatches, 'nome completo'],
    [data.partialMatches, 'parciais'],
    [data.visibility.domains, 'domínios'],
    [data.query.plannedQueries, 'consultas'],
    [data.documents.length, 'documentos'],
    [data.docsWithExcerpt, 'com trecho do nome'],
    [`${(data.tookMs / 1000).toFixed(1)}s`, data.cached ? 'cache' : 'de busca'],
  ]
    .map(([value, label]) => `<li><b>${escapeHtml(String(value))}</b> ${escapeHtml(label)}</li>`)
    .join('');

  $('ambiguity').textContent = data.ambiguity.hint;

  const categories = Object.entries(data.visibility.categories).sort((a, b) => b[1] - a[1]);
  const max = categories.length ? categories[0][1] : 1;
  $('facets').innerHTML = categories
    .map(
      ([cat, value]) => `<li>
        <span>${escapeHtml(cat)}</span>
        <span class="bar"><span style="width:${(value / max) * 100}%"></span></span>
        <span class="val">${value.toFixed(1)}</span>
      </li>`,
    )
    .join('');

  if (data.advice?.length) {
    show($('advice'), data.advice.map((a) => `<p>${escapeHtml(a)}</p>`).join(''));
  } else {
    hide($('advice'));
  }

  renderFilters(data);
  renderGroups(data);

  $('profiles').innerHTML = data.profiles.length
    ? data.profiles
        .map(
          (p) => `<li>
            <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(p.label || p.site)}</a>
            <span class="stat ${p.status === 'confirmado' ? 'stat--ok' : ''}">${escapeHtml(p.status)}</span>
          </li>`,
        )
        .join('')
    : '<li class="empty">Nenhum perfil localizado pelos padrões testados.</li>';

  $('manual').innerHTML = data.manualChecks
    .map(
      (m) => `<li>
        <a href="${escapeAttr(m.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(m.label)}</a>
        <span class="stat">busca</span>
      </li>`,
    )
    .join('');

  $('domains').innerHTML = data.topDomains
    .map((d) => `<li><span>${escapeHtml(d.host)}</span><span class="stat">${d.count}</span></li>`)
    .join('');

  $('providers').innerHTML = data.providers
    .map(
      (p) => `<li>
        <span title="${escapeAttr(p.error || '')}">${escapeHtml(p.label)}</span>
        <span class="stat ${p.status === 'ok' ? 'stat--ok' : 'stat--fail'}">${
          p.status === 'ok' ? `${p.count}/${p.queries}q` : 'bloqueado'
        }</span>
      </li>`,
    )
    .join('');
}

function renderFilters(data) {
  const filters = [{ key: 'all', label: 'Tudo', count: data.results.length }];
  if (data.documents.length) {
    filters.push({ key: 'documentos', label: 'Documentos', count: data.documents.length });
  }
  for (const g of data.groups) {
    filters.push({ key: g.category, label: g.label, count: g.items.length });
  }

  $('filters').innerHTML = filters
    .map(
      (f) =>
        `<button data-filter="${escapeAttr(f.key)}" class="${f.key === activeFilter ? 'active' : ''}">${escapeHtml(f.label)}<span>${f.count}</span></button>`,
    )
    .join('');

  $('filters')
    .querySelectorAll('button')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        renderFilters(current);
        renderGroups(current);
      }),
    );
}

function renderGroups(data) {
  const isExact = (item) => item.match !== 'parcial';
  const counter = { n: 0 };
  let html = '';

  if (activeFilter === 'documentos') {
    const docs = data.documents;
    html += section(
      'Documentos',
      docs.filter(isExact),
      counter,
      'Currículos, teses, atas, editais e diários oficiais. Quando o arquivo é PDF, o texto é lido e o trecho com o nome aparece abaixo.',
    );
    html += partialSection(docs.filter((d) => !isExact(d)), counter);
  } else {
    const groups =
      activeFilter === 'all' ? data.groups : data.groups.filter((g) => g.category === activeFilter);

    // Correspondências parciais saem de todos os grupos e vão para o fim.
    for (const group of groups) {
      html += section(group.label, group.items.filter(isExact), counter);
    }
    html += partialSection(
      groups.flatMap((g) => g.items.filter((i) => !isExact(i))),
      counter,
    );
  }

  $('groups').innerHTML = html || '<p class="group-note">Nenhum resultado nesta categoria.</p>';
}

function section(label, items, counter, note = '') {
  if (!items.length) return '';
  return `
    <section class="group">
      <div class="group-head">
        <h3>${escapeHtml(label)}</h3>
        <span class="count">${items.length}</span>
      </div>
      ${note ? `<p class="group-note">${escapeHtml(note)}</p>` : ''}
      ${items.map((item) => entry(item, counter)).join('')}
    </section>`;
}

function partialSection(items, counter) {
  if (!items.length) return '';
  return `
    <section class="group">
      <div class="partial-divider"><span>Correspondências parciais · ${items.length}</span></div>
      <p class="partial-note">
        Nestes o nome não aparece completo — apenas parte dele, em sequência. Pode ser a mesma
        pessoa citada de forma abreviada, ou outra pessoa.
      </p>
      ${items.map((item) => entry(item, counter, true)).join('')}
    </section>`;
}

function entry(item, counter, partial = false) {
  const i = counter.n++;

  const tags = [];
  if (item.isPdf) tags.push('<span class="tag tag--pdf">PDF</span>');
  if (item.mention) {
    tags.push(
      '<span class="tag tag--mention" title="a página cita o nome, mas não é sobre a pessoa">menção</span>',
    );
  }

  const sources = item.sources.map(escapeHtml).join('<span class="sep"> / </span>');

  let evidence = '';
  if (item.pdf?.excerpts?.length) {
    const head = [
      'Nome localizado dentro do arquivo',
      item.pdf.pages ? `${item.pdf.pages} páginas` : '',
      item.pdf.meta?.author ? `autor: ${item.pdf.meta.author}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    evidence =
      `<p class="evidence-head">${escapeHtml(head)}</p>` +
      item.pdf.excerpts
        .map(
          (e) =>
            `<blockquote class="excerpt"><span class="folio">fl. ${e.page}</span>${escapeHtml(e.text)}</blockquote>`,
        )
        .join('');
  } else if (item.pdf?.scanned) {
    evidence = '<p class="evidence-head">PDF digitalizado sem texto — exigiria OCR</p>';
  } else if (item.meta?.excerpts?.length) {
    evidence =
      '<p class="evidence-head">Trecho do documento oficial</p>' +
      item.meta.excerpts
        .map((e) => `<blockquote class="excerpt">${escapeHtml(e)}</blockquote>`)
        .join('');
  }

  const classes = ['entry'];
  if (item.pdf?.nameFound) classes.push('entry--evidence');
  if (partial) classes.push('entry--partial');

  return `
    <article class="${classes.join(' ')}" style="--i:${Math.min(i, 24)}">
      <div class="entry-meta">
        <span class="entry-host">${escapeHtml(item.host)}</span>
        <span class="sep">/</span>
        <span>${sources}</span>
        ${tags.join('')}
        <span class="entry-rel">${Math.round(item.relevance * 100)}%</span>
      </div>
      <h4><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(item.title)}</a></h4>
      ${item.snippet && !item.pdf?.excerpts?.length ? `<p>${escapeHtml(item.snippet)}</p>` : ''}
      ${evidence}
    </article>`;
}

// -------------------------------------------------------------------- opt-out
const dialog = $('optout');
$('optout-open').addEventListener('click', () => dialog.showModal());
$('optout-submit').addEventListener('click', async (event) => {
  event.preventDefault();
  const name = $('optout-name').value.trim();
  if (name.length < 3) {
    $('optout-msg').textContent = 'Informe o nome completo.';
    return;
  }
  const res = await fetch('/api/optout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  $('optout-msg').textContent = data.message || data.error || '';
  if (res.ok) setTimeout(() => dialog.close(), 1200);
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
const escapeAttr = escapeHtml;
