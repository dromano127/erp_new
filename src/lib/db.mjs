// Cliente Neon sobre HTTP (SQL over HTTPS).
//
// Neste ambiente a porta Postgres (5432) é bloqueada — só sai HTTPS pelo proxy.
// O driver serverless do Neon fala SQL sobre HTTPS, mas o `fetch` do Node (undici)
// NÃO respeita HTTPS_PROXY automaticamente; então instalamos um ProxyAgent global.
// A CA do proxy já é confiada via NODE_EXTRA_CA_CERTS.

import { existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { setGlobalDispatcher, ProxyAgent } from 'undici';

// Carrega o .env automaticamente (Node 22+). Assim os scripts funcionam sem
// precisar `export` das variáveis na mão.
if (typeof process.loadEnvFile === 'function' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxy) {
  // keep-alive alto + timeouts folgados: o proxy pode fechar conexões ociosas
  // durante cargas longas; sem isso o undici derruba com "fetch failed".
  setGlobalDispatcher(
    new ProxyAgent({
      uri: proxy,
      connections: 32,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 120_000,
      headersTimeout: 60_000,
      bodyTimeout: 60_000,
    }),
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL não definido (connection string do Neon).');
}

const _sql = neon(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Erros transitórios de rede/proxy (não são erros de SQL) → vale re-tentar.
function isTransient(err) {
  const m = (err?.message || '').toLowerCase();
  return (
    err?.name === 'TypeError' ||           // undici "fetch failed"
    m.includes('fetch failed') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    m.includes('socket') ||
    m.includes('network') ||
    m.includes('terminated') ||
    m.includes('other side closed')
  );
}

// Query com retry/backoff (1s,2s,4s,8s,16s). Erros de SQL não são re-tentados.
async function query(text, params) {
  const MAX = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      return await _sql.query(text, params);
    } catch (err) {
      if (attempt >= MAX || !isTransient(err)) throw err;
      await sleep(Math.min(16_000, 2 ** attempt * 1000));
    }
  }
}

// Interface usada em todo o projeto: sql.query(text, params) com retry embutido.
// `sql.raw` expõe o cliente neon original (tag template) se necessário.
export const sql = { query, raw: _sql };
