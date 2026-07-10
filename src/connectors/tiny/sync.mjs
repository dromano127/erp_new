// Orquestrador de sincronização Tiny → Neon.
// Ordem de carga da seção 5.3; incremental da seção 5.4 (cursor em sync_state).

import { sql } from '../../lib/db.mjs';
import { get, paginate } from './client.mjs';
import * as P from './persisters.mjs';

const SRC = 'tiny';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// --- cursor -----------------------------------------------------------
async function getCursor(recurso) {
  const rows = await sql.query(
    'SELECT last_sync_at, full_done FROM sync_state WHERE source=$1 AND recurso=$2',
    [SRC, recurso],
  );
  return rows[0] || { last_sync_at: null, full_done: false };
}
async function setCursor(recurso, { last_sync_at, full_done }) {
  await sql.query(
    `INSERT INTO sync_state (source, recurso, last_sync_at, full_done, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (source, recurso) DO UPDATE SET
       last_sync_at = COALESCE(EXCLUDED.last_sync_at, sync_state.last_sync_at),
       full_done = EXCLUDED.full_done, updated_at = now()`,
    [SRC, recurso, last_sync_at ?? null, full_done ?? false],
  );
}
// data 'YYYY-MM-DD' a partir de um Date/ISO (para os filtros da API)
const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// =====================================================================
// FASE 1 — dimensões (carga completa, baixa frequência)
// =====================================================================
export async function syncDimensoes() {
  log('dimensões: /info');
  const info = await get('/info');
  if (info) await P.persistEmpresa(info);

  log('dimensões: /categorias/todas');
  const cats = await get('/categorias/todas');
  if (cats) await P.persistCategoriasTree(cats);

  const simple = [
    ['/marcas', P.persistMarca],
    ['/grupos-tags', P.persistGrupoTag],
    ['/tags', P.persistTagProduto],
    ['/formas-pagamento', P.persistFormaPagamento],
    ['/formas-recebimento', P.persistFormaRecebimento],
    ['/intermediadores', P.persistIntermediador],
    ['/categorias-receita-despesa', P.persistCatReceitaDespesa],
    ['/vendedores', P.persistVendedor],
    ['/usuarios', P.persistUsuario],
    ['/servicos', P.persistServico],
    ['/crm/estagios', P.persistCrmEstagio],
  ];
  for (const [path, fn] of simple) {
    log('dimensões:', path);
    for await (const item of paginate(path)) await fn(item);
  }

  // formas-envio: detalhe traz formasFrete
  log('dimensões: /formas-envio (+ detalhe)');
  for await (const fe of paginate('/formas-envio')) {
    const detail = await get(`/formas-envio/${fe.id}`);
    await P.persistFormaEnvio(detail ?? fe);
  }

  // listas-precos: detalhe traz exceções
  log('dimensões: /listas-precos (+ detalhe)');
  for await (const lp of paginate('/listas-precos')) {
    const detail = await get(`/listas-precos/${lp.id}`);
    await P.persistListaPreco(detail ?? lp);
  }

  await setCursor('dimensoes', { last_sync_at: new Date().toISOString(), full_done: true });
}

// =====================================================================
// FASE 2 — cadastros grandes (lista → detalhe)
// =====================================================================
export async function syncContatos({ incremental = false } = {}) {
  const cur = await getCursor('contatos');
  const query = incremental && cur.last_sync_at
    ? { dataAtualizacao: toDate(cur.last_sync_at) }
    : {};
  log('contatos', incremental ? `(inc desde ${query.dataAtualizacao})` : '(full)');
  let n = 0;
  for await (const c of paginate('/contatos', query)) {
    const detail = await get(`/contatos/${c.id}`);
    if (detail) await P.persistContato(detail);
    n++;
  }
  await setCursor('contatos', { last_sync_at: new Date().toISOString(), full_done: true });
  log(`contatos: ${n} processados`);
}

export async function syncProdutos({ incremental = false } = {}) {
  const cur = await getCursor('produtos');
  const query = incremental && cur.last_sync_at
    ? { dataAlteracao: toDate(cur.last_sync_at) }
    : {};
  log('produtos', incremental ? `(inc desde ${query.dataAlteracao})` : '(full)');
  let n = 0;
  for await (const p of paginate('/produtos', query)) {
    const detail = await get(`/produtos/${p.id}`);
    if (detail) {
      await P.persistProduto(detail);
      const tags = await get(`/produtos/${p.id}/tags`);
      if (tags) await P.persistProdutoTags(p.id, tags.tags ?? tags);
    }
    n++;
  }
  await setCursor('produtos', { last_sync_at: new Date().toISOString(), full_done: true });
  log(`produtos: ${n} processados`);
}

// =====================================================================
// FASE 3 — transações (janela por data; detalhe é a fonte da verdade)
// =====================================================================

// janela deslizante default: últimos N dias (para recursos sem dataAtualizacao)
function windowQuery(cur, incremental, days = 30) {
  if (incremental && cur.last_sync_at) {
    return { dataInicial: toDate(cur.last_sync_at), dataFinal: toDate(new Date()) };
  }
  const ini = new Date();
  ini.setDate(ini.getDate() - days);
  return { dataInicial: toDate(ini), dataFinal: toDate(new Date()) };
}

export async function syncPedidos({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('pedidos');
  const query = incremental && cur.last_sync_at
    ? { dataAtualizacao: toDate(cur.last_sync_at) }
    : windowQuery(cur, false, fullDays);
  log('pedidos', JSON.stringify(query));
  let n = 0;
  for await (const p of paginate('/pedidos', query)) {
    const detail = await get(`/pedidos/${p.id}`);
    if (!detail) continue;
    await P.persistPedido(detail);
    const marc = await get(`/pedidos/${p.id}/marcadores`);
    if (marc) await P.persistMarcadores('pedido', p.id, marc.itens ?? marc);

    // vínculo pedido→contas a receber (idVenda) — capturado na direção inversa
    if (detail.idNotaFiscal || detail.situacao === 1) {
      for await (const cr of paginate('/contas-receber', { idVenda: p.id })) {
        const crDetail = await get(`/contas-receber/${cr.id}`);
        if (crDetail) await P.persistContaReceber(crDetail, { vendaId: p.id });
      }
    }
    n++;
  }
  await setCursor('pedidos', { last_sync_at: new Date().toISOString(), full_done: true });
  log(`pedidos: ${n} processados`);
}

export async function syncNotas({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('notas');
  const query = windowQuery(cur, incremental, incremental ? 7 : fullDays);
  log('notas', JSON.stringify(query));
  let n = 0;
  for await (const nf of paginate('/notas', query)) {
    const detail = await get(`/notas/${nf.id}`);
    if (!detail) continue;
    await P.persistNota(detail);
    if (detail.marcadores) await P.persistMarcadores('nota', nf.id, detail.marcadores);
    n++;
  }
  await setCursor('notas', { last_sync_at: new Date().toISOString(), full_done: true });
  log(`notas: ${n} processadas`);
}

export async function syncOrdemCompra({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('ordem_compra');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  log('ordem-compra', JSON.stringify(query));
  for await (const oc of paginate('/ordem-compra', query)) {
    const detail = await get(`/ordem-compra/${oc.id}`);
    if (detail) await P.persistOrdemCompra(detail);
  }
  await setCursor('ordem_compra', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncOrdemServico({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('ordem_servico');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  log('ordem-servico', JSON.stringify(query));
  for await (const os of paginate('/ordem-servico', query)) {
    const detail = await get(`/ordem-servico/${os.id}`);
    if (detail) await P.persistOrdemServico(detail);
  }
  await setCursor('ordem_servico', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncContasReceber({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('contas_receber');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  log('contas-receber', JSON.stringify(query));
  for await (const cr of paginate('/contas-receber', query)) {
    const detail = await get(`/contas-receber/${cr.id}`);
    if (!detail) continue;
    await P.persistContaReceber(detail);
    const rec = await get(`/contas-receber/${cr.id}/recebimentos`);
    if (rec) await P.persistBaixas('cr', cr.id, rec.itens ?? rec);
  }
  await setCursor('contas_receber', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncContasPagar({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('contas_pagar');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  log('contas-pagar', JSON.stringify(query));
  for await (const cp of paginate('/contas-pagar', query)) {
    const detail = await get(`/contas-pagar/${cp.id}`);
    if (!detail) continue;
    await P.persistContaPagar(detail);
    const rec = await get(`/contas-pagar/${cp.id}/recebimentos`);
    if (rec) await P.persistBaixas('cp', cp.id, rec.itens ?? rec);
  }
  await setCursor('contas_pagar', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncSeparacao({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('separacao');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  log('separacao', JSON.stringify(query));
  for await (const sp of paginate('/separacao', query)) {
    const detail = await get(`/separacao/${sp.id}`);
    if (detail) await P.persistSeparacao(detail);
  }
  await setCursor('separacao', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncExpedicao({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('expedicao');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  log('expedicao', JSON.stringify(query));
  for await (const ag of paginate('/expedicao', query)) {
    const detail = await get(`/expedicao/${ag.id}`);
    if (detail) await P.persistExpedicaoAgrupamento(detail);
  }
  await setCursor('expedicao', { last_sync_at: new Date().toISOString(), full_done: true });
}

export async function syncCrm({ incremental = false, fullDays = 3650 } = {}) {
  const cur = await getCursor('crm');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { filtrarPor: 'data-criacao', dataInicial: w.dataInicial, dataFinal: w.dataFinal };
  log('crm/assuntos', JSON.stringify(query));
  for await (const a of paginate('/crm/assuntos', query)) {
    const detail = await get(`/crm/assuntos/${a.id}`);
    if (detail) await P.persistCrmAssunto(detail);
  }
  await setCursor('crm', { last_sync_at: new Date().toISOString(), full_done: true });
}

// =====================================================================
// FASE 4 — snapshots de estoque (produtos com controlar=true)
// =====================================================================
export async function syncEstoque() {
  log('estoque: snapshot dos produtos com estoque.controlar=true');
  const rows = await sql.query(
    `SELECT source_id FROM produtos
     WHERE source=$1 AND situacao <> 'E'
       AND COALESCE((payload->'estoque'->>'controlar')::boolean, false) = true`,
    [SRC],
  );
  let n = 0;
  for (const r of rows) {
    const est = await get(`/estoque/${r.source_id}`);
    if (est) { await P.persistEstoque(est); n++; }
  }
  await setCursor('estoque', { last_sync_at: new Date().toISOString(), full_done: true });
  log(`estoque: ${n} snapshots`);
}

// =====================================================================
// Runners
// =====================================================================
export async function runFull() {
  await syncDimensoes();
  await syncContatos();
  await syncProdutos();
  await syncPedidos();
  await syncNotas();
  await syncOrdemCompra();
  await syncOrdemServico();
  await syncContasReceber();
  await syncContasPagar();
  await syncSeparacao();
  await syncExpedicao();
  await syncCrm();
  await syncEstoque();
  log('carga full concluída');
}

export async function runIncremental() {
  await syncDimensoes(); // dimensões são baratas; recarrega sempre
  await syncContatos({ incremental: true });
  await syncProdutos({ incremental: true });
  await syncPedidos({ incremental: true });
  await syncNotas({ incremental: true });
  await syncOrdemCompra({ incremental: true });
  await syncOrdemServico({ incremental: true });
  await syncContasReceber({ incremental: true });
  await syncContasPagar({ incremental: true });
  await syncSeparacao({ incremental: true });
  await syncExpedicao({ incremental: true });
  await syncCrm({ incremental: true });
  await syncEstoque();
  log('sync incremental concluída');
}
