// Helpers de upsert para o schema canônico (source, source_id).
import { sql } from './db.mjs';

// Converte undefined/'' → null; mantém 0 e false.
const nz = (v) => (v === undefined || v === '' ? null : v);

/**
 * Upsert genérico.
 * @param {string} table        nome da tabela
 * @param {object} row          { coluna: valor, ... }
 * @param {string[]} conflict   colunas do ON CONFLICT (default: source, source_id)
 * Colunas de conflito nunca entram no SET.
 */
export async function upsert(table, row, conflict = ['source', 'source_id']) {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const vals = cols.map((c) => {
    const v = nz(row[c]);
    // JSONB: serializa objetos/arrays
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  const params = cols.map((_, i) => `$${i + 1}`);

  // conflict === null → INSERT puro (usado após DELETE em replaceChildren).
  if (conflict === null) {
    await sql.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${params.join(', ')})`,
      vals,
    );
    return;
  }

  const updates = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `${c} = EXCLUDED.${c}`);

  const setClause = updates.length
    ? `DO UPDATE SET ${updates.join(', ')}`
    : 'DO NOTHING';

  const text =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${params.join(', ')}) ` +
    `ON CONFLICT (${conflict.join(', ')}) ${setClause}`;

  await sql.query(text, vals);
}

/** Upsert de várias linhas (sequencial, simples). */
export async function upsertMany(table, rows, conflict) {
  for (const row of rows) await upsert(table, row, conflict);
}

/**
 * Substitui as linhas-filhas de um pai: apaga as existentes e reinsere.
 * Usado para itens/parcelas/grade onde não há id estável por linha.
 */
export async function replaceChildren(table, whereCol, whereVal, rows, source = 'tiny') {
  await sql.query(`DELETE FROM ${table} WHERE source = $1 AND ${whereCol} = $2`, [
    source,
    whereVal,
  ]);
  await upsertMany(table, rows, null); // insert puro
}

// Coerção de tipos ------------------------------------------------------
export const s = (v) => (v === undefined || v === null || v === '' ? null : String(v));
export const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
export const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
export const bool = (v) => (v === undefined || v === null ? null : Boolean(v));
// Data/hora: '' → null; passa o resto como string (Postgres faz o cast).
export const dt = (v) => (v === undefined || v === null || v === '' ? null : v);
