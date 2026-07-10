// Cliente HTTP para a API Tiny v3.
// - Bearer token (renovado automaticamente por auth.getAccessToken).
// - Throttle global (~1 req/s por padrão, seguro em qualquer plano).
// - Backoff exponencial em 429/5xx (respeita Retry-After quando presente).
// - Helper de paginação (envelope { itens, paginacao: {limit, offset, total} }).

import { getAccessToken } from './auth.mjs';

const API_BASE =
  process.env.TINY_API_BASE || 'https://api.tiny.com.br/public-api/v3';
const RATE = Number(process.env.SYNC_RATE_LIMIT || 1); // req/s
const MIN_INTERVAL = 1000 / RATE;
const MAX_RETRIES = 6;

let lastAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL - (Date.now() - lastAt);
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, { query, body } = {}) {
  const url = new URL(API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  for (let attempt = 0; ; attempt++) {
    await throttle();
    const token = await getAccessToken();

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // blip de rede/proxy ("fetch failed") — re-tenta com backoff
      if (attempt >= MAX_RETRIES) throw new Error(`${method} ${path} → rede: ${err.message}`);
      await sleep(Math.min(30_000, 2 ** attempt * 1000));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`${method} ${path} → ${res.status} após ${attempt} tentativas`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 1000);
      await sleep(backoff);
      continue;
    }

    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body, query) => request('POST', path, { body, query });
export const put = (path, body, query) => request('PUT', path, { body, query });

/**
 * Itera todas as páginas de uma listagem, entregando cada item.
 * @param {string} path      ex. '/pedidos'
 * @param {object} query     filtros (limit/offset são gerenciados aqui)
 * @param {number} pageSize  default 100
 */
export async function* paginate(path, query = {}, pageSize = 100) {
  let offset = 0;
  for (;;) {
    const page = await get(path, { ...query, limit: pageSize, offset });
    const itens = page?.itens ?? [];
    for (const item of itens) yield item;

    const total = page?.paginacao?.total ?? 0;
    offset += pageSize;
    if (offset >= total || itens.length === 0) break;
  }
}

/** Coleta todos os itens de uma listagem em array. */
export async function listAll(path, query, pageSize) {
  const out = [];
  for await (const item of paginate(path, query, pageSize)) out.push(item);
  return out;
}
