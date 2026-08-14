// Sondagem de perfis: monta usernames plausiveis a partir do nome e testa
// se a URL publica existe. So conta como "encontrado" quando a pagina responde
// 200 E o conteudo cita o nome da pessoa - senao vira apenas "possivel".
//
// Redes que bloqueiam bot (LinkedIn, Instagram, X, Facebook) nao sao sondadas:
// para elas o app devolve link de busca para conferencia manual.
import { fetchWithTimeout, pMapSettled } from '../util/http.js';
import { normalize, nameTokens, usernameCandidates, hasWord, distinctiveTokens } from '../util/text.js';

const SITES = [
  { id: 'github', label: 'GitHub', url: (u) => `https://github.com/${u}` },
  { id: 'gitlab', label: 'GitLab', url: (u) => `https://gitlab.com/${u}` },
  { id: 'youtube', label: 'YouTube', url: (u) => `https://www.youtube.com/@${u}` },
  { id: 'devto', label: 'DEV.to', url: (u) => `https://dev.to/${u}` },
  { id: 'medium', label: 'Medium', url: (u) => `https://medium.com/@${u}` },
  { id: 'soundcloud', label: 'SoundCloud', url: (u) => `https://soundcloud.com/${u}` },
  { id: 'behance', label: 'Behance', url: (u) => `https://www.behance.net/${u}` },
  { id: 'dribbble', label: 'Dribbble', url: (u) => `https://dribbble.com/${u}` },
  { id: 'aboutme', label: 'about.me', url: (u) => `https://about.me/${u}` },
  { id: 'linktree', label: 'Linktree', url: (u) => `https://linktr.ee/${u}` },
  { id: 'telegram', label: 'Telegram', url: (u) => `https://t.me/${u}`, needsBody: true },
  { id: 'npm', label: 'npm', url: (u) => `https://www.npmjs.com/~${u}` },
  { id: 'pypi', label: 'PyPI', url: (u) => `https://pypi.org/user/${u}/` },
  { id: 'vimeo', label: 'Vimeo', url: (u) => `https://vimeo.com/${u}` },
];

// Redes fechadas para robo: viram link de busca, nunca "confirmado".
const MANUAL_SITES = [
  { id: 'linkedin', label: 'LinkedIn', search: (n) => `https://www.bing.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${n}"`)}` },
  { id: 'instagram', label: 'Instagram', search: (n) => `https://www.bing.com/search?q=${encodeURIComponent(`site:instagram.com "${n}"`)}` },
  { id: 'x', label: 'X / Twitter', search: (n) => `https://www.bing.com/search?q=${encodeURIComponent(`site:x.com OR site:twitter.com "${n}"`)}` },
  { id: 'facebook', label: 'Facebook', search: (n) => `https://www.bing.com/search?q=${encodeURIComponent(`site:facebook.com "${n}"`)}` },
];

async function probe(site, username, tokens) {
  const url = site.url(username);
  let res;
  try {
    res = await fetchWithTimeout(url, { timeout: 7000, method: 'GET' });
  } catch {
    return { status: 'erro', url, site: site.id };
  }

  if (res.status === 404 || res.status === 410) return { status: 'ausente', url, site: site.id };
  if (res.status === 403 || res.status === 429 || res.status === 999) {
    return { status: 'bloqueado', url, site: site.id };
  }
  if (!res.ok) return { status: 'erro', url, site: site.id, http: res.status };

  let body = '';
  try {
    body = normalize((await res.text()).slice(0, 200_000));
  } catch {
    /* segue sem corpo */
  }

  // Telegram devolve 200 para usuario inexistente: confere marcador da pagina.
  if (site.needsBody && !body.includes('tgme_page_title')) {
    return { status: 'ausente', url, site: site.id };
  }

  // "confirmado" exige o nome completo escrito na pagina; todos os tokens
  // soltos (por palavra inteira, nao substring) valem apenas como "possivel".
  const fullName = tokens.join(' ');
  const compactBody = body.replace(/[\s._\-]/g, '');
  const named = body.includes(fullName) || compactBody.includes(tokens.join(''));

  // "possivel" exige os tokens E pelo menos um token distintivo: numa pagina em
  // portugues, achar "carlos" e "silva" soltos nao significa absolutamente nada.
  const distinctive = distinctiveTokens(tokens);
  const allTokens = tokens.length > 0 && tokens.every((t) => hasWord(body, t));
  const hasDistinctive = distinctive.some((t) => hasWord(body, t));

  if (named) {
    return { status: 'confirmado', url, site: site.id, label: site.label, username };
  }
  if (allTokens && hasDistinctive) {
    return { status: 'possivel', url, site: site.id, label: site.label, username };
  }
  // A URL existe, mas nada na pagina liga ao nome: nao vale reportar.
  return { status: 'sem-vinculo', url, site: site.id };
}

export const socialProbe = {
  id: 'perfis',
  label: 'Perfis publicos',
  kind: 'probe',
  enabled: () => true,
  async run(name, { maxUsernames = 4 } = {}) {
    const tokens = nameTokens(name);
    const usernames = usernameCandidates(name, maxUsernames);
    if (!usernames.length) return { profiles: [], manual: [] };

    const jobs = [];
    for (const site of SITES) for (const u of usernames) jobs.push([site, u]);

    const settled = await pMapSettled(jobs, ([site, u]) => probe(site, u, tokens), 10);

    const bySite = new Map();
    for (const r of settled) {
      if (!r.ok) continue;
      const found = r.value;
      if (found.status !== 'confirmado' && found.status !== 'possivel') continue;
      const current = bySite.get(found.site);
      // Confirmado sempre vence "possivel"; entre iguais, o primeiro username.
      if (!current || (current.status === 'possivel' && found.status === 'confirmado')) {
        bySite.set(found.site, found);
      }
    }

    return {
      profiles: [...bySite.values()],
      manual: MANUAL_SITES.map((s) => ({ id: s.id, label: s.label, url: s.search(name) })),
    };
  },
};
