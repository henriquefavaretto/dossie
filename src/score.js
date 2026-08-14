// Indice de visibilidade 0-10, no espirito do "web visibility score" do WebMii.
//
// Ideia: nao contar links, e sim DOMINIOS distintos ponderados pela autoridade
// do site e pela certeza de que o resultado e mesmo sobre a pessoa. Um blog que
// cita o nome 40 vezes vale menos que uma Wikipedia + um LinkedIn + uma noticia.

const SATURATION = 18; // controla a curva; maior = mais dificil chegar em 10

// Teto de contribuicao por categoria: impede que uma unica frente (ex.: 30
// videos no YouTube) sozinha estoure a nota.
const CATEGORY_CAP = {
  enciclopedia: 8,
  noticias: 8,
  profissional: 6,
  social: 7,
  academico: 7,
  oficial: 6,
  video: 5,
  imagem: 4,
  midia: 4,
  blog: 4,
  arquivo: 3,
  web: 6,
  agregador: 1,
};
const DEFAULT_CAP = 6;

export function computeScore(results, { profiles = [] } = {}) {
  const byDomain = new Map();

  for (const r of results) {
    if (r.relevance < 0.5) continue;
    const value = r.weight * r.relevance;
    const prev = byDomain.get(r.host);
    if (!prev) {
      byDomain.set(r.host, { value, category: r.category, pages: 1 });
    } else {
      prev.value = Math.max(prev.value, value);
      prev.pages += 1;
    }
  }

  // Mais paginas no mesmo dominio somam pouco e de forma logaritmica:
  // 20 links de um site nao valem 20x um link.
  for (const domain of byDomain.values()) {
    domain.value *= 1 + Math.min(0.5, 0.12 * Math.log2(domain.pages));
  }

  const perCategory = new Map();
  for (const { value, category } of byDomain.values()) {
    perCategory.set(category, (perCategory.get(category) || 0) + value);
  }

  let raw = 0;
  for (const [category, total] of perCategory) {
    const capped = Math.min(total, CATEGORY_CAP[category] ?? DEFAULT_CAP);
    perCategory.set(category, capped);
    raw += capped;
  }

  // Perfis confirmados por sondagem entram como evidencia direta.
  raw += profiles.filter((p) => p.status === 'confirmado').length * 0.8;
  raw += profiles.filter((p) => p.status === 'possivel').length * 0.2;

  // Diversidade de categorias: presenca em varias frentes vale mais.
  const diversity = perCategory.size;
  raw *= 1 + Math.min(diversity, 6) * 0.05;

  const score = 10 * (1 - Math.exp(-raw / SATURATION));

  return {
    score: Number(score.toFixed(1)),
    raw: Number(raw.toFixed(2)),
    domains: byDomain.size,
    categories: Object.fromEntries(
      [...perCategory.entries()].map(([k, v]) => [k, Number(v.toFixed(2))]),
    ),
    label: labelFor(score),
  };
}

function labelFor(score) {
  if (score >= 8.5) return 'Figura pública';
  if (score >= 6.5) return 'Alta visibilidade';
  if (score >= 4.5) return 'Visibilidade média';
  if (score >= 2.5) return 'Presença discreta';
  if (score > 0) return 'Pegada mínima';
  return 'Nada encontrado';
}

/**
 * Confianca de que os resultados falam de UMA pessoa so.
 * Nome comum + muitos dominios sem sobreposicao = provavel homonimo.
 */
export function ambiguity(results, name) {
  if (!results.length) {
    return {
      level: 'n/a',
      hint: 'Nenhum resultado relevante. Tente outra grafia ou adicione contexto.',
    };
  }
  const strong = results.filter((r) => r.relevance >= 0.85).length;
  const total = results.length || 1;
  const tokens = name.trim().split(/\s+/).length;
  const ratio = strong / total;

  let level = 'baixa';
  if (tokens <= 2 && ratio < 0.5) level = 'alta';
  else if (ratio < 0.35) level = 'alta';
  else if (ratio < 0.6) level = 'media';

  return {
    level,
    hint:
      level === 'alta'
        ? 'Provavelmente há homônimos. Refine com cidade, profissão ou empresa.'
        : level === 'media'
          ? 'Alguns resultados podem ser de outra pessoa com nome parecido.'
          : 'Resultados consistentes com uma única pessoa.',
  };
}
