// Provedores de identidade: APIs publicas que respondem "quem e essa pessoa"
// com dado estruturado, nao com link solto.
import { fetchJson, pMapSettled } from '../util/http.js';
import { nameTokens, normalize, truncate } from '../util/text.js';

// (providers abaixo compartilham estes utilitarios de nome)

// ------------------------------------------------------------------ Wikidata
export const wikidata = {
  id: 'wikidata',
  label: 'Wikidata / Wikipedia',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const search = await fetchJson(
      'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=5' +
        `&language=pt&uselang=pt&search=${encodeURIComponent(name)}`,
      { timeout: 8000 },
    );
    const ids = (search.search || []).map((s) => s.id).slice(0, 5);
    if (!ids.length) return [];

    const entities = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|descriptions|claims|sitelinks` +
        `&languages=pt|en&ids=${ids.join('|')}`,
      { timeout: 9000 },
    );

    const out = [];
    for (const id of ids) {
      const ent = entities.entities?.[id];
      if (!ent) continue;
      // P31 (instancia de) = Q5 (ser humano)
      const isHuman = (ent.claims?.P31 || []).some(
        (c) => c.mainsnak?.datavalue?.value?.id === 'Q5',
      );
      if (!isHuman) continue;

      const label = ent.labels?.pt?.value || ent.labels?.en?.value || id;
      const description = ent.descriptions?.pt?.value || ent.descriptions?.en?.value || '';
      const sitelinks = Object.keys(ent.sitelinks || {});
      const wiki =
        ent.sitelinks?.ptwiki?.title
          ? `https://pt.wikipedia.org/wiki/${encodeURIComponent(ent.sitelinks.ptwiki.title.replace(/ /g, '_'))}`
          : ent.sitelinks?.enwiki?.title
            ? `https://en.wikipedia.org/wiki/${encodeURIComponent(ent.sitelinks.enwiki.title.replace(/ /g, '_'))}`
            : `https://www.wikidata.org/wiki/${id}`;

      out.push({
        url: wiki,
        title: label,
        snippet: truncate(description || 'Entidade Wikidata (pessoa)', 300),
        source: 'wikidata',
        category: 'enciclopedia',
        authority: true,
        meta: { wikidataId: id, wikipedias: sitelinks.filter((s) => s.endsWith('wiki')).length },
      });
    }
    return out;
  },
};

// ------------------------------------------------------------------- OpenAlex
// Base academica aberta: producao cientifica, ORCID, instituicao.
export const openalex = {
  id: 'openalex',
  label: 'OpenAlex (academico)',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=5&mailto=webmii-clone@example.com`,
      { timeout: 9000 },
    );
    return (data.results || [])
      .filter((a) => (a.works_count || 0) > 0)
      .map((a) => ({
        url: a.orcid || a.ids?.openalex || `https://openalex.org/${a.id?.split('/').pop()}`,
        title: a.display_name,
        snippet: truncate(
          [
            a.last_known_institutions?.[0]?.display_name || a.last_known_institution?.display_name,
            `${a.works_count} publicacoes`,
            `${a.cited_by_count} citacoes`,
            a.topics?.slice(0, 3).map((t) => t.display_name).join(', '),
          ]
            .filter(Boolean)
            .join(' · '),
          300,
        ),
        source: 'openalex',
        category: 'academico',
        authority: (a.works_count || 0) >= 5,
        meta: { worksCount: a.works_count, citedBy: a.cited_by_count, orcid: a.orcid || null },
      }));
  },
};

// --------------------------------------------------------------------- GitHub
export const github = {
  id: 'github',
  label: 'GitHub',
  kind: 'identity',
  enabled: () => true,
  async run(name, { env = process.env } = {}) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

    const data = await fetchJson(
      `https://api.github.com/search/users?q=${encodeURIComponent(`${name} in:name`)}&per_page=5`,
      { timeout: 9000, headers },
    );
    const logins = (data.items || []).slice(0, 3).map((u) => u.login);
    const details = await pMapSettled(
      logins,
      (login) => fetchJson(`https://api.github.com/users/${login}`, { timeout: 8000, headers }),
      3,
    );

    return details
      .filter((r) => r.ok && r.value?.name)
      .map(({ value: u }) => ({
        url: u.html_url,
        title: `${u.name} (@${u.login})`,
        snippet: truncate(
          [u.bio, u.company, u.location, `${u.public_repos} repos`, `${u.followers} seguidores`]
            .filter(Boolean)
            .join(' · '),
          300,
        ),
        source: 'github',
        category: 'social',
        image: u.avatar_url,
        meta: { followers: u.followers, repos: u.public_repos, blog: u.blog || null },
      }));
  },
};

// ------------------------------------------------------------- Stack Overflow
export const stackoverflow = {
  id: 'stackoverflow',
  label: 'Stack Overflow',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://api.stackexchange.com/2.3/users?site=stackoverflow&order=desc&sort=reputation&pagesize=5&inname=${encodeURIComponent(name)}`,
      { timeout: 9000 },
    );
    const tokens = nameTokens(name);
    return (data.items || [])
      .filter((u) => {
        const n = normalize(u.display_name);
        return tokens.every((t) => n.includes(t));
      })
      .map((u) => ({
        url: u.link,
        title: u.display_name,
        snippet: `Reputacao ${u.reputation} · ${u.location || 'local nao informado'}`,
        source: 'stackoverflow',
        category: 'social',
        image: u.profile_image,
        meta: { reputation: u.reputation },
      }));
  },
};

// ---------------------------------------------------------------------- ORCID
// Identificador global de pesquisador. A busca solta casa qualquer um dos nomes,
// entao vai com consulta estruturada: nome E sobrenome nos campos certos.
export const orcid = {
  id: 'orcid',
  label: 'ORCID',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const tokens = nameTokens(name);
    if (tokens.length < 2) return [];
    const given = tokens[0];
    const family = tokens[tokens.length - 1];

    const data = await fetchJson(
      'https://pub.orcid.org/v3.0/expanded-search/?rows=8&q=' +
        encodeURIComponent(`given-names:${given} AND family-name:${family}`),
      { timeout: 15000, headers: { Accept: 'application/json' } },
    );

    return (data['expanded-result'] || []).map((r) => ({
      url: `https://orcid.org/${r['orcid-id']}`,
      title: [r['given-names'], r['family-names']].filter(Boolean).join(' ') || r['orcid-id'],
      snippet: truncate(
        [(r['institution-name'] || []).slice(0, 3).join(', '), r['credit-name']]
          .filter(Boolean)
          .join(' · ') || 'Perfil de pesquisador ORCID',
        300,
      ),
      source: 'orcid',
      category: 'academico',
      meta: { orcid: r['orcid-id'] },
    }));
  },
};

// ------------------------------------------------------- Câmara dos Deputados
export const camara = {
  id: 'camara',
  label: 'Câmara dos Deputados',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      `https://dadosabertos.camara.leg.br/api/v2/deputados?nome=${encodeURIComponent(name)}&itens=10&ordem=ASC&ordenarPor=nome`,
      { timeout: 15000, headers: { Accept: 'application/json' } },
    );

    return (data.dados || []).map((d) => ({
      url: d.uri ? `https://www.camara.leg.br/deputados/${d.id}` : d.uri,
      title: d.nome,
      snippet: truncate(
        [d.siglaPartido, d.siglaUf, d.email].filter(Boolean).join(' · ') || 'Deputado federal',
        300,
      ),
      source: 'camara',
      category: 'oficial',
      image: d.urlFoto || null,
      authority: true,
    }));
  },
};

// ---------------------------------------------------------------- Senado
export const senado = {
  id: 'senado',
  label: 'Senado Federal',
  kind: 'identity',
  enabled: () => true,
  async run(name) {
    const data = await fetchJson(
      'https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json',
      { timeout: 15000 },
    );

    const list = data?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar || [];
    const tokens = nameTokens(name);

    return list
      .map((p) => p.IdentificacaoParlamentar || {})
      .filter((p) => {
        const full = normalize(`${p.NomeCompletoParlamentar || ''} ${p.NomeParlamentar || ''}`);
        return tokens.length >= 2 && tokens.every((t) => full.includes(t));
      })
      .map((p) => ({
        url: p.UrlPaginaParlamentar || `https://www25.senado.leg.br/web/senadores`,
        title: p.NomeCompletoParlamentar || p.NomeParlamentar,
        snippet: truncate(
          [p.SiglaPartidoParlamentar, p.UfParlamentar, p.EmailParlamentar]
            .filter(Boolean)
            .join(' · ') || 'Senador(a) em exercício',
          300,
        ),
        source: 'senado',
        category: 'oficial',
        image: p.UrlFotoParlamentar || null,
        authority: true,
      }));
  },
};

// -------------------------------------------------- Portal da Transparência
// Servidores publicos federais. Exige chave gratuita (cadastro por e-mail).
export const transparencia = {
  id: 'transparencia',
  label: 'Portal da Transparência',
  kind: 'identity',
  enabled: (env) => Boolean(env.TRANSPARENCIA_API_KEY),
  async run(name, { env = process.env } = {}) {
    const data = await fetchJson(
      `https://api.portaldatransparencia.gov.br/api-de-dados/servidores?nome=${encodeURIComponent(name)}&pagina=1`,
      { timeout: 20000, headers: { 'chave-api-dados': env.TRANSPARENCIA_API_KEY } },
    );

    return (Array.isArray(data) ? data : []).slice(0, 10).map((s) => {
      const pessoa = s.servidor?.pessoaFisica || {};
      return {
        url: `https://portaldatransparencia.gov.br/servidores/${s.id || ''}`,
        title: pessoa.nome || name,
        snippet: truncate(
          [
            s.orgaoServidorLotacao?.nome,
            s.cargo?.descricao,
            s.situacao,
            pessoa.cpfFormatado,
          ]
            .filter(Boolean)
            .join(' · '),
          300,
        ),
        source: 'transparencia',
        category: 'oficial',
        authority: true,
      };
    });
  },
};

export const identityProviders = [
  wikidata,
  openalex,
  github,
  stackoverflow,
  orcid,
  camara,
  senado,
  transparencia,
];
