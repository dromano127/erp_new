// Fluxo OAuth2 interativo do Tiny (rodar uma vez para obter os tokens).
//
//   node scripts/tiny-auth.mjs url            → imprime a URL de autorização
//   node scripts/tiny-auth.mjs code <CODE>    → troca o code do redirect por tokens
//   node scripts/tiny-auth.mjs refresh        → força um refresh
//   node scripts/tiny-auth.mjs status         → mostra o estado dos tokens
//
// Requer TINY_CLIENT_ID / TINY_CLIENT_SECRET / TINY_REDIRECT_URI e DATABASE_URL.

import { authorizeUrl, exchangeCode, refresh, getAccessToken } from '../src/connectors/tiny/auth.mjs';
import { sql } from '../src/lib/db.mjs';

const cmd = process.argv[2];

if (cmd === 'url') {
  console.log('\nAbra no navegador, faça login e autorize:\n');
  console.log(authorizeUrl());
  console.log('\nDepois copie o ?code=... do redirect e rode:');
  console.log('  node scripts/tiny-auth.mjs code <CODE>\n');
} else if (cmd === 'code') {
  const code = process.argv[3];
  if (!code) { console.error('Faltou o CODE.'); process.exit(1); }
  const tok = await exchangeCode(code);
  console.log('Tokens salvos. access_token expira em', tok.expires_in, 's.');
} else if (cmd === 'refresh') {
  const rows = await sql.query("SELECT refresh_token FROM sync_tokens WHERE source='tiny'");
  if (!rows[0]?.refresh_token) { console.error('Sem refresh_token salvo.'); process.exit(1); }
  const tok = await refresh(rows[0].refresh_token);
  console.log('Renovado. Novo access_token expira em', tok.expires_in, 's.');
} else if (cmd === 'status') {
  const rows = await sql.query(
    "SELECT source, expires_at, refresh_expires_at, updated_at FROM sync_tokens WHERE source='tiny'",
  );
  console.log(rows[0] || 'Sem tokens.');
} else if (cmd === 'token') {
  console.log(await getAccessToken());
} else {
  console.log('Uso: node scripts/tiny-auth.mjs <url|code <CODE>|refresh|status|token>');
}
