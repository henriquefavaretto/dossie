// Extracao de texto de PDF.
//
// E o que responde a pergunta "o nome dessa pessoa aparece em algum documento?".
// Curriculo, tese, ata de reuniao, lista de aprovados, nomeacao em diario oficial:
// tudo isso e PDF, e o texto de dentro nao aparece no snippet do buscador.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fetchWithTimeout } from './util/http.js';
import { normalize, nameTokens, truncate } from './util/text.js';

const MAX_BYTES = 15 * 1024 * 1024; // PDF maior que isso quase sempre e digitalizacao
const MAX_PAGES = 30; // paginas lidas por documento (diario oficial e longo)
const CONTEXT_CHARS = 130; // texto mostrado de cada lado do nome

export function looksLikePdf(url = '') {
  return /\.pdf($|[?#])/i.test(url);
}

/**
 * Baixa o PDF, extrai o texto e devolve os trechos onde o nome aparece.
 * Nunca lanca: um PDF quebrado, protegido ou digitalizado apenas nao rende nada.
 */
export async function extractPdfEvidence(url, name, { maxPages = MAX_PAGES } = {}) {
  try {
    const res = await fetchWithTimeout(url, { timeout: 20000 });
    if (!res.ok) return null;

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return { skipped: 'arquivo grande demais' };

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) return { skipped: 'arquivo grande demais' };
    // "%PDF" no inicio: alguns servidores devolvem HTML de erro com .pdf na URL
    if (buffer[0] !== 0x25 || buffer[1] !== 0x50) return null;

    const doc = await pdfjs.getDocument({ data: buffer, verbosity: 0 }).promise;
    // Guardar antes de destruir o documento: ler doc.numPages depois do
    // destroy() lanca, e o erro derrubava silenciosamente TODA a extracao.
    const numPages = doc.numPages;
    const pages = Math.min(numPages, maxPages);

    let meta = {};
    try {
      const info = (await doc.getMetadata())?.info || {};
      meta = {
        title: info.Title?.trim() || null,
        author: info.Author?.trim() || null,
        creationDate: info.CreationDate || null,
      };
    } catch {
      /* metadados sao opcionais */
    }

    const excerpts = [];
    let totalChars = 0;
    const tokens = nameTokens(name);
    const full = tokens.join(' ');

    for (let i = 1; i <= pages && excerpts.length < 3; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ');
      totalChars += text.length;

      for (const excerpt of findName(text, full, tokens)) {
        excerpts.push({ page: i, text: excerpt });
        if (excerpts.length >= 3) break;
      }
    }

    try {
      await doc.destroy();
    } catch {
      /* liberar recurso nao pode quebrar o resultado */
    }

    return {
      pages: numPages,
      pagesRead: pages,
      // texto quase vazio em PDF longo = digitalizacao sem OCR
      scanned: totalChars < 200 * pages,
      meta,
      excerpts,
      nameFound: excerpts.length > 0,
    };
  } catch (error) {
    return { error: truncate(error.message, 90) };
  }
}

/**
 * Dobra que PRESERVA o comprimento: minusculas e sem acento, mas sem colapsar
 * espaco nem trocar pontuacao. E o que permite achar a posicao no texto dobrado
 * e recortar o trecho no texto original - normalize() muda o tamanho da string
 * e os indices saiam do lugar, cortando o trecho logo antes do nome.
 */
function fold(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escapeRe(token) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Acha o nome no texto da pagina e devolve o trecho ao redor. */
function findName(text, full, tokens) {
  const folded = fold(text);
  // Se a dobra mudou o tamanho (texto ja em NFD, ligaduras), recorta do proprio
  // texto dobrado: perde acento no trecho, mas nunca corta na posicao errada.
  const source = folded.length === text.length ? text : folded;
  const out = [];

  // Separador flexivel: em PDF o nome vem com espaco duplo, quebra de linha ou
  // hifen de silabacao entre as partes.
  const between = '[^a-z0-9]{1,4}';
  const patterns = [tokens.map(escapeRe).join(between)];
  if (tokens.length >= 2) {
    const [first] = tokens;
    const last = tokens[tokens.length - 1];
    patterns.push(`${escapeRe(last)},${between}${escapeRe(first)}`);
  }

  for (const pattern of patterns) {
    const re = new RegExp(pattern, 'g');
    let match;
    let lastIdx = -Infinity;
    while ((match = re.exec(folded)) !== null && out.length < 3) {
      // Duas ocorrencias proximas gerariam trechos praticamente iguais.
      if (match.index - lastIdx >= CONTEXT_CHARS) {
        out.push(cut(source, match.index, match[0].length));
        lastIdx = match.index;
      }
      if (re.lastIndex === match.index) re.lastIndex += 1;
    }
    if (out.length) break;
  }

  if (!out.length && folded.includes(full)) out.push(cut(source, folded.indexOf(full), full.length));
  return out;
}

function cut(text, idx, matchLength = 0) {
  const start = Math.max(0, idx - CONTEXT_CHARS);
  const end = Math.min(text.length, idx + matchLength + CONTEXT_CHARS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
