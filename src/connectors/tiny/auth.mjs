// OAuth2 (Authorization Code) do Tiny/Olist ERP v3, via Keycloak.
// Tokens persistidos em sync_tokens (access ~4h, refresh ~1 dia).
// O refresh token expira se não for usado — renovamos em ciclo a cada execução.

import { sql } from '../../lib/db.mjs';

const AUTH_BASE =
  process.env.TINY_AUTH_BASE ||
  'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect';
const SOURCE = 'tiny';

const cfg = () => ({
  clientId: process.env.TINY_CLIENT_ID,
  clientSecret: process.env.TINY_CLIENT_SECRET,
  redirectUri: process.env.TINY_REDIRECT_URI,
});

/** URL para o usuário autorizar o app (passo interativo, uma vez). */
export function authorizeUrl(state = 'erp') {
  const { clientId, redirectUri } = cfg();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid',
    state,
  });
  return `${AUTH_BASE}/auth?${q}`;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = cfg();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...params,
  });
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token endpoint ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function persist(tok) {
  const now = Date.now();
  await sql.query(
    `INSERT INTO sync_tokens (source, access_token, refresh_token, expires_at, refresh_expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (source) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       updated_at = now()`,
    [
      SOURCE,
      tok.access_token,
      tok.refresh_token,
      new Date(now + (tok.expires_in ?? 0) * 1000).toISOString(),
      new Date(now + (tok.refresh_expires_in ?? 0) * 1000).toISOString(),
    ],
  );
}

/** Troca o `code` do redirect por tokens e persiste. */
export async function exchangeCode(code) {
  const { redirectUri } = cfg();
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  await persist(tok);
  return tok;
}

/** Renova via refresh_token e persiste. */
export async function refresh(refreshToken) {
  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  await persist(tok);
  return tok;
}

/**
 * Retorna um access_token válido, renovando se estiver perto de expirar.
 * Lança se não houver tokens (é preciso rodar o fluxo interativo antes).
 */
// Cache do token em memória: sem isto, cada chamada da API fazia um SELECT no
// Neon (round-trip pelo proxy) — dominava a latência quando há concorrência.
// Guardamos o access_token válido e só tocamos o Neon perto do vencimento.
let cached = null; // { access_token, expMs }
let refreshing = null; // promessa única de refresh (evita corridas entre workers)

export async function getAccessToken() {
  if (cached && cached.expMs - Date.now() >= 60_000) return cached.access_token;
  if (refreshing) return refreshing; // um worker já está renovando/lendo
  refreshing = (async () => {
    const rows = await sql.query(
      'SELECT access_token, refresh_token, expires_at FROM sync_tokens WHERE source = $1',
      [SOURCE],
    );
    const row = rows[0];
    if (!row || !row.refresh_token) {
      throw new Error(
        'Sem tokens. Rode `node scripts/tiny-auth.mjs url`, autorize e depois ' +
          '`node scripts/tiny-auth.mjs code <CODE>`.',
      );
    }
    const expMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (expMs - Date.now() < 60_000) {
      const tok = await refresh(row.refresh_token);
      cached = { access_token: tok.access_token,
        expMs: Date.now() + (tok.expires_in ? tok.expires_in * 1000 : 3600_000) };
    } else {
      cached = { access_token: row.access_token, expMs };
    }
    return cached.access_token;
  })();
  try { return await refreshing; }
  finally { refreshing = null; }
}
