// Matriz de consultas ("dorks").
//
// Esta e a peca que separa um brinquedo de um buscador de pessoas de verdade.
// Uma consulta unica devolve ~10 links. O Google parece ter "muito mais" porque
// voce, humano, reformula a busca varias vezes. Aqui a reformulacao e sistematica:
// ~25 consultas dirigidas a documentos, redes, registros oficiais e academia.
//
// filetype:pdf e o dork mais valioso para pessoas: curriculos, teses, atas,
// listas de aprovados, nomeacoes e editais quase sempre sao PDF, e esse conteudo
// nao aparece numa busca simples pelo nome.

import { searchPhrases } from './util/names.js';

/** @typedef {{q:string, tag:string, priority:number, needsOperators:boolean}} Dork */

const SOCIAL_SITES = [
  'instagram.com',
  'linkedin.com/in',
  'facebook.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'github.com',
  'medium.com',
];

// in.gov.br = Diario Oficial da Uniao. A busca dele e renderizada por JavaScript
// (nao da para consultar por API), mas o conteudo esta indexado - entao chegamos
// nele por dork. Nomeacoes, exoneracoes, aposentadorias e concursos moram ali.
const BR_OFFICIAL = [
  'gov.br',
  'in.gov.br',
  'jus.br',
  'jusbrasil.com.br',
  'escavador.com',
  'lattes.cnpq.br',
  'tse.jus.br',
  'camara.leg.br',
  'senado.leg.br',
  'mp.br',
];

// Repositorios academicos: teses e artigos em PDF, com nome de autor, orientador
// e banca.
const REPOSITORIES = [
  'scielo.br',
  'bdtd.ibict.br',
  'teses.usp.br',
  'periodicos.capes.gov.br',
  'researchgate.net',
  'academia.edu',
];

/**
 * @param {string} name nome completo
 * @param {string} context cidade / profissao / empresa (opcional)
 * @returns {Dork[]} ordenada por prioridade (1 = mais importante)
 */
export function buildQueryPlan(name, context = '') {
  const exact = `"${name.trim()}"`;
  const ctx = context.trim();
  const plan = [];

  const add = (q, tag, priority, needsOperators = true) =>
    plan.push({ q, tag, priority, needsOperators });

  // --- 1. base: a consulta que qualquer um faria ---
  add(exact, 'base', 1, false);
  if (ctx) add(`${exact} ${ctx}`, 'base', 1, false);

  // Sem aspas: buscadores as vezes nao acham nada para frase exata rara, e o
  // filtro de relevancia (que exige a frase no resultado) segura o lixo.
  add(name.trim(), 'base', 2, false);

  // Frases parciais que MANTEM o token distintivo. Para "Carlos Dumond Silva"
  // gera "Carlos Dumond" e "Dumond Silva" - nunca "Carlos Silva", que casaria
  // com milhares de pessoas diferentes.
  for (const phrase of searchPhrases(name)) {
    add(`"${phrase}"`, 'variante', 2, false);
  }

  // --- 2. documentos: onde mora o volume que falta ---
  add(`${exact} filetype:pdf`, 'documento', 1);
  add(`${exact} filetype:doc OR filetype:docx`, 'documento', 3);
  add(`${exact} filetype:xls OR filetype:xlsx`, 'documento', 4);
  add(`${exact} filetype:ppt OR filetype:pptx`, 'documento', 5);
  add(`${exact} curriculo OR "curriculum vitae" OR CV filetype:pdf`, 'documento', 2);
  add(`${exact} ata OR edital OR portaria OR nomeacao filetype:pdf`, 'documento', 3);
  add(`${exact} tese OR dissertacao OR monografia filetype:pdf`, 'documento', 3);

  // --- 3. registros oficiais / juridicos (Brasil) ---
  for (const site of BR_OFFICIAL) {
    const priority = site === 'gov.br' ? 2 : site === 'in.gov.br' ? 2 : 4;
    add(`${exact} site:${site}`, 'oficial', priority);
  }
  add(`${exact} "diario oficial"`, 'oficial', 3, false);
  add(`${exact} site:gov.br filetype:pdf`, 'documento', 2);
  add(`${exact} nomeacao OR exoneracao OR aposentadoria site:in.gov.br`, 'oficial', 3);
  add(`${exact} concurso OR aprovados OR classificacao filetype:pdf`, 'documento', 3);

  // --- 3b. repositorios academicos ---
  for (const site of REPOSITORIES) {
    add(`${exact} site:${site}`, 'academico', 4);
  }

  // --- 4. redes e perfis ---
  for (const site of SOCIAL_SITES) {
    add(`${exact} site:${site}`, 'social', site === 'linkedin.com/in' ? 2 : 3);
  }

  // --- 5. contexto profissional e midia ---
  add(`${exact} entrevista OR palestra OR podcast`, 'midia', 4, false);
  add(`${exact} socio OR empresa OR CNPJ`, 'profissional', 4, false);
  if (ctx) {
    add(`${exact} ${ctx} filetype:pdf`, 'documento', 2);
    add(`${exact} ${ctx} contato OR email`, 'profissional', 5, false);
  }

  return plan.sort((a, b) => a.priority - b.priority);
}

/**
 * Quantas consultas cabem no orcamento.
 * Buscador com chave de API aguenta o plano inteiro; scraping gratuito bloqueia
 * por rajada, entao so leva o topo da lista.
 */
export function budgetFor(engine, plan) {
  if (engine.strong) return plan.filter((d) => engine.supportsOperators || !d.needsOperators);
  const usable = plan.filter((d) => engine.supportsOperators || !d.needsOperators);
  return usable.filter((d) => d.priority <= 3).slice(0, engine.maxQueries ?? 6);
}
