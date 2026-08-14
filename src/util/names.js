// Casamento de nomes de pessoa.
//
// Regra central: o nome tem que aparecer como FRASE, nunca com os tokens
// espalhados pela pagina. Aceitar tokens soltos e o que faz uma busca por
// "Carlos Dumond Silva" devolver o "Carlos Alberto Silva" que por acaso tem a
// palavra "Dumond" no rodape - e, com sobrenome comum no Brasil, isso e a regra,
// nao a excecao.
//
// Segunda regra: uma frase parcial so vale se contiver um token DISTINTIVO.
// "Carlos Dumond" serve (Dumond e raro). "Carlos Silva" nao serve - sao duas
// palavras comuns e casa com milhares de pessoas diferentes.

const PARTICLES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'del', 'della', 'di', 'du', 'la', 'le',
  'van', 'von', 'der', 'den', 'bin', 'ibn', 'y', 'san', 'santa', 'st',
]);

const SUFFIXES = new Set([
  'jr', 'junior', 'filho', 'neto', 'sobrinho', 'ii', 'iii', 'iv', 'sr', 'senior',
]);

// Nomes e sobrenomes muito frequentes no Brasil e em Portugal. Nao servem, por
// si sos, para identificar alguem.
const COMMON = new Set([
  // sobrenomes
  'silva', 'santos', 'souza', 'sousa', 'oliveira', 'pereira', 'lima', 'carvalho',
  'ferreira', 'alves', 'ribeiro', 'rodrigues', 'almeida', 'costa', 'gomes',
  'martins', 'araujo', 'melo', 'barbosa', 'rocha', 'dias', 'nunes', 'moreira',
  'cardoso', 'teixeira', 'correia', 'correa', 'cavalcante', 'cavalcanti',
  'monteiro', 'mendes', 'freitas', 'ramos', 'goncalves', 'batista', 'castro',
  'campos', 'miranda', 'pinto', 'moura', 'azevedo', 'machado', 'andrade',
  'vieira', 'fernandes', 'nascimento', 'reis', 'borges', 'lopes', 'marques',
  'soares', 'farias', 'duarte', 'coelho', 'pires', 'fonseca', 'brito', 'braga',
  'aguiar', 'macedo', 'sampaio', 'siqueira', 'nogueira', 'viana', 'assis',
  // nomes
  'jose', 'joao', 'antonio', 'francisco', 'carlos', 'paulo', 'pedro', 'lucas',
  'luiz', 'luis', 'marcos', 'marco', 'gabriel', 'rafael', 'daniel', 'bruno',
  'eduardo', 'felipe', 'filipe', 'rodrigo', 'gustavo', 'guilherme', 'leonardo',
  'ricardo', 'roberto', 'sergio', 'marcelo', 'alexandre', 'fernando', 'fabio',
  'andre', 'thiago', 'tiago', 'vinicius', 'mateus', 'matheus', 'henrique',
  'julio', 'cesar', 'claudio', 'diego', 'renato', 'leandro', 'jorge', 'raimundo',
  'maria', 'ana', 'juliana', 'adriana', 'fernanda', 'patricia', 'aline', 'sandra',
  'camila', 'amanda', 'bruna', 'jessica', 'leticia', 'julia', 'luciana', 'vanessa',
  'mariana', 'gabriela', 'beatriz', 'larissa', 'carla', 'claudia', 'simone',
  'cristina', 'daniela', 'eliane', 'monica', 'paula', 'raquel', 'renata', 'rosa',
  'sonia', 'tatiane', 'vera', 'alice', 'helena', 'laura', 'sofia', 'isabela',
]);

export function fold(input = '') {
  return String(input)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Tokens significativos do nome (sem particulas e sem sufixos). */
export function nameTokens(name) {
  return fold(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !PARTICLES.has(t) && !SUFFIXES.has(t));
}

/**
 * Tokens que realmente identificam a pessoa.
 * Se TODOS forem comuns (ex.: "Maria Silva"), devolve todos - nesse caso nao ha
 * o que destacar e a exigencia passa a ser a frase completa.
 */
export function distinctiveTokens(tokens) {
  const rare = tokens.filter((t) => !COMMON.has(t) && t.length >= 3);
  return rare.length ? rare : tokens;
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SEP = '[^a-z0-9]{1,4}';

// Entre dois tokens do nome pode haver pontuacao E particulas: os tokens de
// "Carlos Drummond de Andrade" sao [carlos, drummond, andrade], mas no texto o
// "de" continua la. Sem aceitar particulas no meio, o titulo exato da Wikipedia
// batia como "parcial" - e praticamente todo nome brasileiro caia nessa.
const BETWEEN = `${SEP}(?:(?:${[...PARTICLES].join('|')})${SEP})*`;

/**
 * Regex de frase: tokens em sequencia, aceitando separador curto e particulas
 * entre eles (espaco duplo, ponto, hifen, barra de URL, "de", "da", "dos").
 */
export function phraseRegex(tokens) {
  const body = tokens.map(escapeRe).join(BETWEEN);
  return new RegExp(`(^|[^a-z0-9])${body}([^a-z0-9]|$)`);
}

/** Todas as sequencias contiguas de tamanho >= 2 dentro do nome. */
function contiguousRuns(tokens) {
  const runs = [];
  for (let size = tokens.length; size >= 2; size -= 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      runs.push(tokens.slice(start, start + size));
    }
  }
  return runs;
}

/**
 * Compara o nome buscado com um resultado.
 * @returns {{score:number, kind:'exato'|'parcial'|'nenhum', matched:string|null}}
 */
export function matchName(name, { title = '', snippet = '', url = '' } = {}) {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return { score: 0, kind: 'nenhum', matched: null };

  const foldedTitle = fold(title);
  const foldedUrl = fold(decodeSafe(url));
  const foldedBody = `${fold(snippet)} ${foldedUrl}`;

  // Nome de um token so: exige palavra inteira, sem meio termo.
  if (tokens.length === 1) {
    const re = phraseRegex(tokens);
    if (re.test(foldedTitle)) return { score: 1, kind: 'exato', matched: tokens[0] };
    if (re.test(foldedBody)) return { score: 0.85, kind: 'exato', matched: tokens[0] };
    return { score: 0, kind: 'nenhum', matched: null };
  }

  // 1) Nome completo como frase.
  const full = phraseRegex(tokens);
  if (full.test(foldedTitle)) return { score: 1, kind: 'exato', matched: tokens.join(' ') };
  if (full.test(foldedBody)) return { score: 0.9, kind: 'exato', matched: tokens.join(' ') };

  // 2) Frase parcial, desde que carregue um token distintivo.
  const distinctive = new Set(distinctiveTokens(tokens));
  for (const run of contiguousRuns(tokens)) {
    if (run.length === tokens.length) continue;
    if (!run.some((t) => distinctive.has(t))) continue;

    const re = phraseRegex(run);
    const completeness = run.length / tokens.length;
    if (re.test(foldedTitle)) {
      return { score: 0.6 + completeness * 0.2, kind: 'parcial', matched: run.join(' ') };
    }
    if (re.test(foldedBody)) {
      return { score: 0.5 + completeness * 0.2, kind: 'parcial', matched: run.join(' ') };
    }
  }

  // Tokens espalhados NAO contam. Era exatamente a fonte do resultado errado.
  return { score: 0, kind: 'nenhum', matched: null };
}

/** A pagina e SOBRE a pessoa, ou so a menciona no meio do texto? */
export function isAboutPerson(name, { title = '', url = '' } = {}) {
  const tokens = nameTokens(name);
  if (!tokens.length) return false;
  const re = phraseRegex(tokens);
  return re.test(fold(title)) || re.test(fold(decodeSafe(url)));
}

/**
 * Frases alternativas para CONSULTAR o buscador - todas mantendo pelo menos um
 * token distintivo. Nunca gera "Carlos Silva" a partir de "Carlos Dumond Silva".
 */
export function searchPhrases(name) {
  const tokens = nameTokens(name);
  if (tokens.length < 2) return [];
  const distinctive = new Set(distinctiveTokens(tokens));

  return contiguousRuns(tokens)
    .filter((run) => run.length < tokens.length && run.some((t) => distinctive.has(t)))
    .map((run) => run.join(' '));
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
