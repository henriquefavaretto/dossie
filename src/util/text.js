// Normalizacao de texto e utilitarios de string.
// Tudo aqui trabalha com string "achatada": sem acento, minuscula, espaco simples.
import { matchName, nameTokens } from './names.js';

export function normalize(input = '') {
  return String(input)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9@._\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { nameTokens };

/** Slugs plausiveis de username a partir do nome, para sondar perfis. */
export function usernameCandidates(name, limit = 6) {
  const t = nameTokens(name);
  if (!t.length) return [];
  const first = t[0];
  const last = t[t.length - 1];
  const out = [];
  if (t.length === 1) {
    out.push(first);
  } else {
    out.push(`${first}${last}`, `${first}.${last}`, `${first}-${last}`, `${first}_${last}`);
    out.push(`${first[0]}${last}`, `${first}${last[0]}`);
    if (t.length > 2) out.push(t.join(''));
  }
  return [...new Set(out)].filter((u) => u.length >= 3 && u.length <= 39).slice(0, limit);
}

const wordCache = new Map();

/**
 * Casamento por palavra inteira. Sem isso, "ada" casaria dentro de "nada",
 * "cada", "usada" - fonte enorme de falso positivo em texto em portugues.
 */
export function hasWord(haystack, token) {
  let re = wordCache.get(token);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    wordCache.set(token, re);
  }
  return re.test(haystack);
}

// O casamento de nomes mora em ./names.js - exigir FRASE em vez de tokens
// espalhados e o que impede "Carlos Dumond Silva" de casar com "Carlos Silva".
export { matchName, isAboutPerson, searchPhrases, distinctiveTokens, fold } from './names.js';

/** Compatibilidade: devolve so a nota do casamento. */
export function relevance(name, result) {
  return matchName(name, result).score;
}

export function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s = '', n = 260) {
  const v = String(s).trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}
