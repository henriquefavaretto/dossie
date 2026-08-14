// Fontes de texto completo DENTRO de documentos.
//
// Buscador comum indexa a pagina; estas APIs indexam o conteudo de PDFs, atas,
// diarios oficiais e artigos. Sao a resposta para "o nome esta em algum PDF?" -
// e nenhuma delas exige chave nem bloqueia por rajada.
import { fetchJson, fetchText } from '../util/http.js';
import { normalize, nameTokens, stripTags, truncate } from '../util/text.js';

const clean = (v) => truncate(stripTags(v || ''), 320);

// -------------------------------------------------------------- Querido Diario
// Diarios oficiais municipais brasileiros, com o PDF e o TEXTO EXTRAIDO dele.
// Nomeacoes, exoneracoes, licitacoes, concursos: e onde nome de gente comum
// aparece em documento publico.
export const queridoDiario = {
  id: 'queridodiario',
  label: 'Diários Oficiais (Querido Diário)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      'https://api.queridodiario.ok.org.br/gazettes' +
        `?querystring=${encodeURIComponent(`"${name}"`)}` +
        '&size=12&excerpt_size=320&number_of_excerpts=2&sort_by=relevance',
      { timeout: 20000 },
    );

    return (data.gazettes || []).map((g) => ({
      url: g.url,
      title: `Diário Oficial de ${g.territory_name}/${g.state_code} — ${g.date}`,
      snippet: clean(g.excerpts?.[0] || 'Menção em diário oficial municipal'),
      source: 'queridodiario',
      category: 'oficial',
      publishedAt: g.date,
      isDocument: true,
      meta: {
        municipio: `${g.territory_name}/${g.state_code}`,
        edicao: g.edition_number || null,
        excerpts: (g.excerpts || []).map((e) => clean(e)),
        totalNoAcervo: data.total_gazettes,
      },
    }));
  },
};

// ------------------------------------------------------------- Internet Archive
// Acervo digitalizado: livros, relatorios, jornais antigos, capturas de sites.
export const internetArchive = {
  id: 'archive',
  label: 'Internet Archive',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      'https://archive.org/advancedsearch.php' +
        `?q=${encodeURIComponent(`"${name}"`)}` +
        '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=description&fl%5B%5D=year&fl%5B%5D=mediatype' +
        '&rows=10&page=1&output=json',
      { timeout: 15000 },
    );

    return (data.response?.docs || []).map((d) => ({
      url: `https://archive.org/details/${d.identifier}`,
      title: clean(Array.isArray(d.title) ? d.title[0] : d.title || d.identifier),
      snippet: clean(
        [Array.isArray(d.description) ? d.description[0] : d.description, d.year]
          .filter(Boolean)
          .join(' · '),
      ),
      source: 'archive',
      category: 'arquivo',
      isDocument: true,
      meta: { mediatype: d.mediatype || null },
    }));
  },
};

// -------------------------------------------------------------------- Crossref
// Metadados de ~150 milhoes de publicacoes com DOI. Filtra por autor de verdade.
export const crossref = {
  id: 'crossref',
  label: 'Crossref (publicações)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://api.crossref.org/works?query.author=${encodeURIComponent(name)}` +
        '&rows=12&select=title,author,issued,URL,DOI,container-title,type' +
        '&mailto=webmii-clone@example.com',
      { timeout: 15000 },
    );

    const tokens = nameTokens(name);
    return (data.message?.items || [])
      .filter((item) =>
        (item.author || []).some((a) => {
          const full = normalize(`${a.given || ''} ${a.family || ''}`);
          // exige o sobrenome E o primeiro nome, senao vem meio mundo junto
          return tokens.every((t) => full.includes(t));
        }),
      )
      .map((item) => ({
        url: item.URL || `https://doi.org/${item.DOI}`,
        title: clean(Array.isArray(item.title) ? item.title[0] : item.title || item.DOI),
        snippet: clean(
          [
            Array.isArray(item['container-title']) ? item['container-title'][0] : null,
            item.issued?.['date-parts']?.[0]?.[0],
            item.type,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        source: 'crossref',
        category: 'academico',
        isDocument: true,
        meta: { doi: item.DOI },
      }));
  },
};

// ----------------------------------------------------------------------- arXiv
export const arxiv = {
  id: 'arxiv',
  label: 'arXiv',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const xml = await fetchText(
      `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(`"${name}"`)}&max_results=8`,
      { timeout: 15000 },
    );
    const entries = xml.split('<entry>').slice(1);
    return entries.map((entry) => {
      const pick = (tag) => {
        const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
        return m ? stripTags(m[1]) : '';
      };
      const id = pick('id');
      return {
        url: id.replace('/abs/', '/pdf/'),
        title: clean(pick('title')),
        snippet: clean(pick('summary')),
        source: 'arxiv',
        category: 'academico',
        isDocument: true,
      };
    });
  },
};

// ------------------------------------------------------------------ OpenAIRE
// Agregador aberto que federa repositorios institucionais - inclusive os
// brasileiros. Cada registro costuma apontar para o PDF no repositorio de origem.
export const openaire = {
  id: 'openaire',
  label: 'OpenAIRE (repositórios)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://api.openaire.eu/search/publications?author=${encodeURIComponent(name)}&size=15&format=json`,
      { timeout: 20000 },
    );

    const records = asArray(data?.response?.results?.result);
    return records
      .map((record) => {
        const meta = record?.metadata?.['oaf:entity']?.['oaf:result'];
        if (!meta) return null;

        const title = pickValue(asArray(meta.title)[0]);
        const url = asArray(meta.children?.instance)
          .flatMap((instance) => asArray(instance?.webresource))
          .map((web) => pickValue(web?.url))
          .find(Boolean);
        if (!title || !url) return null;

        const authors = asArray(meta.creator).map(pickValue).filter(Boolean).join('; ');
        return {
          url,
          title: clean(title),
          snippet: clean([authors, pickValue(meta.dateofacceptance)].filter(Boolean).join(' · ')),
          source: 'openaire',
          category: 'academico',
          isDocument: true,
        };
      })
      .filter(Boolean);
  },
};

// ---------------------------------------------------------------------- DOAJ
// Artigos de acesso aberto: o nome aparece na lista de autores, nao no titulo.
export const doaj = {
  id: 'doaj',
  label: 'DOAJ (acesso aberto)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://doaj.org/api/search/articles/${encodeURIComponent(`"${name}"`)}?pageSize=15`,
      { timeout: 18000 },
    );

    return (data.results || [])
      .map((item) => {
        const b = item.bibjson || {};
        const authors = (b.author || []).map((a) => a.name).filter(Boolean);
        const link =
          (b.link || []).find((l) => l.type === 'fulltext')?.url ||
          (b.identifier || []).find((i) => i.type === 'doi')?.id;
        if (!link) return null;

        return {
          url: link.startsWith('http') ? link : `https://doi.org/${link}`,
          title: clean(b.title),
          // Os autores entram no trecho: e ali que o nome buscado aparece.
          snippet: clean(
            [authors.join('; '), b.journal?.title, b.year].filter(Boolean).join(' · '),
          ),
          source: 'doaj',
          category: 'academico',
          isDocument: true,
        };
      })
      .filter(Boolean);
  },
};

// -------------------------------------------------------------------- Zenodo
// Repositorio aberto do CERN. Entrega o link direto do arquivo, entao os PDFs
// daqui vao direto para a fase de leitura.
export const zenodo = {
  id: 'zenodo',
  label: 'Zenodo',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://zenodo.org/api/records?q=${encodeURIComponent(`"${name}"`)}&size=12`,
      { timeout: 18000 },
    );

    return (data.hits?.hits || []).map((hit) => {
      const pdf = (hit.files || []).find((f) => /\.pdf$/i.test(f.key || ''));
      const authors = (hit.metadata?.creators || []).map((c) => c.name).filter(Boolean);
      return {
        url: pdf?.links?.self || hit.links?.self_html || `https://zenodo.org/records/${hit.id}`,
        title: clean(hit.title || hit.metadata?.title),
        snippet: clean(
          [authors.join('; '), hit.metadata?.publication_date, hit.metadata?.description]
            .filter(Boolean)
            .join(' · '),
        ),
        source: 'zenodo',
        category: 'academico',
        isDocument: true,
      };
    });
  },
};

// ----------------------------------------------------------------------- BDTD
// Biblioteca Digital Brasileira de Teses e Dissertacoes: PDFs longos, com nomes
// de orientadores, bancas e citados no texto.
export const bdtd = {
  id: 'bdtd',
  label: 'BDTD (teses brasileiras)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://bdtd.ibict.br/vufind/api/v1/search?lookfor=${encodeURIComponent(`"${name}"`)}` +
        '&limit=12&field[]=title&field[]=authors&field[]=urls&field[]=summary&field[]=id',
      { timeout: 20000 },
    );

    return (data.records || [])
      .map((record) => {
        const url =
          (record.urls || []).map((u) => u.url).find(Boolean) ||
          (record.id ? `https://bdtd.ibict.br/vufind/Record/${record.id}` : null);
        if (!url) return null;

        const authors = Object.keys(record.authors?.primary || {}).join('; ');
        return {
          url,
          title: clean(record.title),
          snippet: clean([authors, (record.summary || [])[0]].filter(Boolean).join(' · ')),
          source: 'bdtd',
          category: 'academico',
          isDocument: true,
        };
      })
      .filter(Boolean);
  },
};

// --------------------------------------------------------------------- PubMed
export const pubmed = {
  id: 'pubmed',
  label: 'PubMed',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const search = await fetchJson(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=10' +
        `&term=${encodeURIComponent(`${name}[Author]`)}`,
      { timeout: 15000 },
    );
    const ids = search.esearchresult?.idlist || [];
    if (!ids.length) return [];

    const summary = await fetchJson(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
      { timeout: 15000 },
    );

    return ids
      .map((id) => summary.result?.[id])
      .filter(Boolean)
      .map((item) => ({
        url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
        title: clean(item.title),
        snippet: clean(
          [
            (item.authors || []).map((a) => a.name).join('; '),
            item.fulljournalname || item.source,
            item.pubdate,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        source: 'pubmed',
        category: 'academico',
        isDocument: true,
      }));
  },
};

// --------------------------------------------------------------- Open Library
export const openLibrary = {
  id: 'openlibrary',
  label: 'Open Library (livros)',
  kind: 'document',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(`"${name}"`)}&limit=10`,
      { timeout: 15000 },
    );

    return (data.docs || []).map((doc) => ({
      url: `https://openlibrary.org${doc.key}`,
      title: clean(doc.title),
      snippet: clean(
        [(doc.author_name || []).join('; '), doc.first_publish_year, (doc.publisher || [])[0]]
          .filter(Boolean)
          .join(' · '),
      ),
      source: 'openlibrary',
      category: 'arquivo',
      isDocument: true,
    }));
  },
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** OpenAIRE embrulha quase todo campo em { "$": valor }. */
function pickValue(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') return node.$ ?? node.content ?? '';
  return String(node);
}

export const documentProviders = [
  queridoDiario,
  internetArchive,
  crossref,
  arxiv,
  openaire,
  doaj,
  zenodo,
  bdtd,
  pubmed,
  openLibrary,
];
