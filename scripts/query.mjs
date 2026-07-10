// Executa uma query rápida no Neon via HTTP.
// Uso: DATABASE_URL=... node scripts/query.mjs "select count(*) from produtos"

import { sql } from '../src/lib/db.mjs';

const text = process.argv[2] || 'select version()';
const rows = await sql.query(text);
console.log(JSON.stringify(rows, null, 2));
