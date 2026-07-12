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

const serial = (v) => {
  v = nz(v);
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
};

/**
 * Insere/upserta várias linhas em UMA ÚNICA query (multi-row VALUES) em vez de
 * um round-trip por linha. É o caminho quente do sincronizador (itens/parcelas
 * de cada pedido): colapsar N inserts em 1 corta drasticamente a latência total
 * por registro (cada round-trip ao Neon passa pelo proxy). As linhas vindas dos
 * `.map` dos persisters têm o mesmo conjunto de colunas; ainda assim usamos a
 * UNIÃO das chaves e preenchemos ausentes com null, por segurança.
 */
export async function upsertMany(table, rows, conflict) {
  if (!rows || rows.length === 0) return;
  if (rows.length === 1) return upsert(table, rows[0], conflict);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (cols.length === 0) return;
  const vals = [];
  const tuples = rows.map((r) => {
    const ph = cols.map((c) => { vals.push(serial(r[c])); return `$${vals.length}`; });
    return `(${ph.join(', ')})`;
  });
  let text = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`;
  if (conflict) {
    const updates = cols
      .filter((c) => !conflict.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`);
    text += ` ON CONFLICT (${conflict.join(', ')}) ` +
      (updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING');
  }
  await sql.query(text, vals);
}

/**
 * Remove linhas duplicadas por um conjunto de colunas-chave (mantém a última).
 * A API às vezes repete itens (ex.: mesmo insumo no array de produção),
 * o que quebraria o INSERT puro pós-DELETE do replaceChildren.
 */
export function dedupeBy(rows, keyCols) {
  const map = new Map();
  for (const r of rows) {
    const k = keyCols.map((c) => r[c]).join('');
    map.set(k, r);
  }
  return [...map.values()];
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
// Data/hora: '' → null. A API às vezes devolve datas parciais (competência
// como "AAAA-MM" sem dia) que não castam pra DATE — normalizamos p/ dia 01.
// "AAAA" isolado → "AAAA-01-01". O resto passa como string (Postgres casta).
export const dt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const str = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(str)) return `${str}-01`;
  if (/^\d{4}$/.test(str)) return `${str}-01-01`;
  return str;
};
