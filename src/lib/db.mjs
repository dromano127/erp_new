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
  setGlobalDispatcher(new ProxyAgent(proxy));
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL não definido (connection string do Neon).');
}

// sql`...` para queries parametrizadas; sql.query(text, params) para dinâmicas.
export const sql = neon(url);
