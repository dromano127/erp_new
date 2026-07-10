// Aplica um arquivo .sql no Neon via HTTP (porta 5432 é bloqueada neste ambiente).
// Uso: DATABASE_URL=... node scripts/apply-sql.mjs db/schema.sql

import { readFileSync } from 'node:fs';
import { sql } from '../src/lib/db.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/apply-sql.mjs <arquivo.sql>');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');

// Divide em statements por ';' no fim da linha, ignorando comentários de linha.
// Suficiente para DDL sem funções/DO blocks (o schema não usa ';' embutido).
const statements = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Aplicando ${statements.length} statements de ${file}...`);

let ok = 0;
for (const stmt of statements) {
  try {
    await sql.query(stmt);
    ok++;
  } catch (err) {
    console.error('\nFALHOU:\n' + stmt.slice(0, 200) + '\n→ ' + err.message);
    process.exit(1);
  }
}

console.log(`OK — ${ok} statements aplicados.`);
