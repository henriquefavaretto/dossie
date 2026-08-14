// Classifica cada resultado por dominio: categoria + peso na pontuacao.

const RULES = [
  // [regex de host, categoria, peso]
  [/(^|\.)wikipedia\.org$/, 'enciclopedia', 6],
  [/(^|\.)wikidata\.org$/, 'enciclopedia', 4],
  [/(^|\.)imdb\.com$/, 'midia', 3],
  [/(^|\.)linkedin\.com$/, 'profissional', 3],
  [/(^|\.)crunchbase\.com$/, 'profissional', 2.5],
  [/(^|\.)glassdoor\./, 'profissional', 1.5],
  [/(^|\.)github\.com$|(^|\.)gitlab\.com$|(^|\.)bitbucket\.org$/, 'social', 2],
  [/(^|\.)stackoverflow\.com$|(^|\.)stackexchange\.com$/, 'social', 1.8],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$|(^|\.)twitch\.tv$/, 'video', 2],
  [/(^|\.)instagram\.com$|(^|\.)tiktok\.com$|(^|\.)threads\.net$/, 'social', 2],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)bsky\.app$|(^|\.)mastodon\./, 'social', 1.8],
  [/(^|\.)facebook\.com$/, 'social', 1.5],
  [/(^|\.)flickr\.com$|(^|\.)behance\.net$|(^|\.)dribbble\.com$|(^|\.)500px\.com$/, 'imagem', 1.8],
  [/(^|\.)soundcloud\.com$|(^|\.)spotify\.com$|(^|\.)bandcamp\.com$/, 'midia', 1.8],
  [/(^|\.)medium\.com$|(^|\.)substack\.com$|(^|\.)dev\.to$|(^|\.)wordpress\.com$|(^|\.)blogspot\./, 'blog', 1.5],
  [/(^|\.)orcid\.org$|(^|\.)openalex\.org$|(^|\.)scholar\.google\.|(^|\.)researchgate\.net$|(^|\.)academia\.edu$|(^|\.)lattes\.cnpq\.br$|(^|\.)escavador\.com$/, 'academico', 2.5],
  // Repositorios institucionais: teses, dissertacoes e artigos em PDF
  [/(^|\.)(teses|repositorio|repositorios|periodicos|bdtd|lume|locus|ridi)\./, 'academico', 2.5],
  [/(^|\.)(usp|unicamp|unesp|ufrj|ufmg|ufrgs|ufsc|ufpe|ufba|unb|puc-rio|pucsp|fgv)\.br$/, 'academico', 2.5],
  [/(^|\.)(doi\.org|crossref\.org|arxiv\.org|scielo\.br|semanticscholar\.org)$/, 'academico', 2.2],
  [/(^|\.)archive\.org$/, 'arquivo', 1.5],
  [/(^|\.)queridodiario\.ok\.org\.br$|(^|\.)data\.queridodiario\.ok\.org\.br$/, 'oficial', 3],
  [/\.gov(\.[a-z]{2})?$|\.gov\.br$|(^|\.)jusbrasil\.com\.br$/, 'oficial', 3],
  [/\.edu(\.[a-z]{2})?$|\.edu\.br$|\.ac\.[a-z]{2}$/, 'academico', 2.5],
  // Agregadores de dados pessoais: reciclam a mesma informacao, valem pouco.
  [/(^|\.)(spokeo|radaris|peekyou|whitepages|beenverified|intelius|pipl|zoominfo|rocketreach|signalhire|contactout|apollo\.io|lusha)\./, 'agregador', 0.3],
  [/(^|\.)(consultasocio|econodata|cnpj\.biz|casadosdados|informecadastral)\./, 'agregador', 0.5],
];

const NEWS_HINT = /(^|\.)(g1|globo|uol|folha|estadao|terra|r7|ig|band|cnnbrasil|bbc|nytimes|reuters|forbes|exame|valor|infomoney|metropoles|gazetadopovo|correiobraziliense|veja|istoe)\./;

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function classify(result) {
  const host = hostOf(result.url);
  if (!host) return { host: '', category: result.category || 'web', weight: 0.5 };

  if (result.category === 'noticias' || NEWS_HINT.test(host)) {
    return { host, category: 'noticias', weight: 2.2 };
  }

  for (const [re, category, weight] of RULES) {
    if (re.test(host)) return { host, category, weight };
  }

  // Dominio proprio curto costuma ser site pessoal/portfolio.
  const personal = host.split('.').length <= 3 && /\.(me|dev|io|com\.br|com|net|org|site|blog|art\.br)$/.test(host);
  return { host, category: result.category || 'web', weight: personal ? 1.2 : 1 };
}

export const CATEGORY_ORDER = [
  'enciclopedia',
  'noticias',
  'profissional',
  'social',
  'academico',
  'oficial',
  'video',
  'imagem',
  'midia',
  'blog',
  'arquivo',
  'web',
  'agregador',
];

export const CATEGORY_LABEL = {
  enciclopedia: 'Enciclopédia',
  noticias: 'Notícias',
  profissional: 'Profissional',
  social: 'Redes sociais',
  academico: 'Acadêmico',
  oficial: 'Oficial / jurídico',
  video: 'Vídeo',
  imagem: 'Imagem / portfólio',
  midia: 'Mídia',
  blog: 'Blog / publicações',
  arquivo: 'Acervos e arquivos',
  web: 'Web',
  agregador: 'Agregadores de dados',
};
