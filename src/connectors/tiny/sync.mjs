// Orquestrador de sincronização Tiny → Neon.
// Ordem de carga da seção 5.3; incremental da seção 5.4 (cursor em sync_state).

import { sql } from '../../lib/db.mjs';
import { get, paginate } from './client.mjs';
import * as P from './persisters.mjs';

const SRC = 'tiny';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Isola falhas por recurso: 401/403 (sem permissão) e outros erros viram aviso
// e não derrubam a sincronização dos demais recursos.
async function safe(label, fn) {
  try {
    await fn();
  } catch (err) {
    const m = err?.message || String(err);
    if (m.includes('→ 401') || m.includes('→ 403')) {
      log(`SKIP ${label}: sem permissão (${m.match(/→ \d+/)?.[0] || 'auth'})`);
    } else {
      log(`ERRO ${label}: ${m}`);
    }
  }
}

// --- cursor -----------------------------------------------------------
async function getCursor(recurso) {
  const rows = await sql.query(
    'SELECT last_sync_at, full_done, last_offset FROM sync_state WHERE source=$1 AND recurso=$2',
    [SRC, recurso],
  );
  return rows[0] || { last_sync_at: null, full_done: false, last_offset: 0 };
}
async function setCursor(recurso, { last_sync_at, full_done, last_offset }) {
  await sql.query(
    `INSERT INTO sync_state (source, recurso, last_sync_at, full_done, last_offset, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (source, recurso) DO UPDATE SET
       last_sync_at = COALESCE(EXCLUDED.last_sync_at, sync_state.last_sync_at),
       full_done = EXCLUDED.full_done,
       last_offset = COALESCE(EXCLUDED.last_offset, sync_state.last_offset),
       updated_at = now()`,
    [SRC, recurso, last_sync_at ?? null, full_done ?? false, last_offset ?? null],
  );
}
// data 'YYYY-MM-DD' a partir de um Date/ISO (para os filtros da API)
const toDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
// data-e-hora 'YYYY-MM-DD 00:00:00' — alguns endpoints (contatos/produtos)
// validam dataAtualizacao/dataAlteracao como DATETIME e rejeitam só a data.
// Ancoramos na meia-noite do dia do last_sync_at: janela generosa (nunca perde
// alteração por diferença de fuso) e idempotente (upsert reprocessa sem duplicar).
const toDateTime = (d) => (d ? `${new Date(d).toISOString().slice(0, 10)} 00:00:00` : null);

// Erro sinalizando fim do orçamento de tempo do batch (interrupção limpa).
class Deadline extends Error {}

/**
 * Runner resumível list→detalhe com orçamento de tempo (batch).
 * Percorre /listPath paginado a partir de last_offset; para cada item busca
 * o detalhe e chama persistFn(detail, item). Salva o offset a cada página.
 * Ao esgotar o tempo (deadline), salva o offset e retorna sem concluir.
 * Ao terminar, zera o offset e marca full_done.
 * @returns {Promise<boolean>} true se concluiu o recurso, false se pausou.
 */
const CONCURRENCY = Math.max(1, Number(process.env.SYNC_CONCURRENCY || 6));

async function resumableListDetail(recurso, listPath, detailPath, persistFn, {
  query = {},
  pageSize = 100,
  deadline = Infinity,
} = {}) {
  const cur = await getCursor(recurso);
  let offset = cur.full_done ? 0 : (cur.last_offset || 0);
  if (cur.full_done) await setCursor(recurso, { full_done: false, last_offset: 0 });

  for (;;) {
    if (Date.now() >= deadline) {
      await setCursor(recurso, { last_offset: offset });
      log(`${recurso}: pausado no offset ${offset} (deadline)`);
      return false;
    }
    const page = await get(listPath, { ...query, limit: pageSize, offset });
    const itens = page?.itens ?? [];
    // Busca os detalhes com um POOL DE WORKERS (streaming). O gargalo é a
    // latência de rede por item, não o rate limit — o throttle global em
    // client.mjs continua limitando o INÍCIO das chamadas, mas a concorrência
    // sobrepõe as latências. Um pool streaming (em vez de lotes) evita que um
    // pedido lento — com muitos itens — trave os demais. Deadline checado por
    // item; ao pausar mid-página, salva o offset do INÍCIO da página (será
    // refeita — persist é idempotente).
    let cursor = 0;
    let paused = false;
    const worker = async () => {
      for (;;) {
        if (Date.now() >= deadline) { paused = true; return; }
        const idx = cursor++;
        if (idx >= itens.length) return;
        const item = itens[idx];
        try {
          const detail = await get(detailPath(item.id));
          if (detail) await persistFn(detail, item);
        } catch (err) {
          // um registro problemático não pode travar o recurso inteiro.
          log(`${recurso}: ERRO no id ${item.id} — ${err.message} (pulado)`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, itens.length || 1) }, worker));
    if (paused) {
      await setCursor(recurso, { last_offset: offset });
      log(`${recurso}: pausado no offset ${offset} (deadline, mid-página)`);
      return false;
    }
    const total = page?.paginacao?.total ?? 0;
    offset += pageSize;
    await setCursor(recurso, { last_offset: offset });
    log(`${recurso}: ${Math.min(offset, total)}/${total}`);
    if (offset >= total || itens.length === 0) break;
  }
  await setCursor(recurso, { last_sync_at: new Date().toISOString(), full_done: true, last_offset: 0 });
  return true;
}

// =====================================================================
// FASE 1 — dimensões (carga completa, baixa frequência)
// =====================================================================
export async function syncDimensoes() {
  await safe('/info', async () => {
    const info = await get('/info');
    if (info) await P.persistEmpresa(info);
  });

  await safe('/categorias/todas', async () => {
    const cats = await get('/categorias/todas');
    if (cats) await P.persistCategoriasTree(cats);
  });

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
    await safe(path, async () => {
      let n = 0;
      for await (const item of paginate(path)) { await fn(item); n++; }
      log(`dimensões: ${path} → ${n}`);
    });
  }

  // formas-envio: detalhe traz formasFrete
  await safe('/formas-envio', async () => {
    for await (const fe of paginate('/formas-envio')) {
      const detail = await get(`/formas-envio/${fe.id}`);
      await P.persistFormaEnvio(detail ?? fe);
    }
    log('dimensões: /formas-envio (+ detalhe) ok');
  });

  // listas-precos: detalhe traz exceções
  await safe('/listas-precos', async () => {
    for await (const lp of paginate('/listas-precos')) {
      const detail = await get(`/listas-precos/${lp.id}`);
      await P.persistListaPreco(detail ?? lp);
    }
    log('dimensões: /listas-precos (+ detalhe) ok');
  });

  await setCursor('dimensoes', { last_sync_at: new Date().toISOString(), full_done: true });
}

// =====================================================================
// FASE 2 — cadastros grandes (lista → detalhe)
// =====================================================================
export async function syncContatos({ incremental = false, deadline = Infinity } = {}) {
  const cur = await getCursor('contatos');
  const query = incremental && cur.last_sync_at ? { dataAtualizacao: toDateTime(cur.last_sync_at) } : {};
  return resumableListDetail('contatos', '/contatos', (id) => `/contatos/${id}`,
    (detail) => P.persistContato(detail), { query, deadline });
}

export async function syncProdutos({ incremental = false, deadline = Infinity } = {}) {
  const cur = await getCursor('produtos');
  const query = incremental && cur.last_sync_at ? { dataAlteracao: toDateTime(cur.last_sync_at) } : {};
  return resumableListDetail('produtos', '/produtos', (id) => `/produtos/${id}`,
    async (detail, item) => {
      await P.persistProduto(detail);
      const tags = await get(`/produtos/${item.id}/tags`);
      if (tags) await P.persistProdutoTags(item.id, tags.tags ?? tags);
    }, { query, deadline });
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

// Uma conta só tem baixas/recebimentos se houve pagamento. O detalhe já traz
// valorPago e situacao; se nada foi pago (aberto/cancelada/prevista), pular a
// chamada de /recebimentos evita metade dos round-trips no backfill. Em caso de
// dúvida (situação de pagamento), busca — nunca perde uma baixa existente.
function temBaixa(detail) {
  const pago = Number(detail?.valorPago);
  if (Number.isFinite(pago) && pago > 0) return true;
  const sit = String(detail?.situacao ?? '').toLowerCase();
  return sit === 'pago' || sit === 'parcial' || sit === 'baixado' || sit === 'recebido';
}

export async function syncPedidos({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('pedidos');
  const query = incremental && cur.last_sync_at
    ? { dataAtualizacao: toDate(cur.last_sync_at) }
    : windowQuery(cur, false, fullDays);
  return resumableListDetail('pedidos', '/pedidos', (id) => `/pedidos/${id}`,
    async (detail, item) => {
      await P.persistPedido(detail);
      const marc = await get(`/pedidos/${item.id}/marcadores`);
      if (marc) await P.persistMarcadores('pedido', item.id, marc.itens ?? marc);
      // vínculo pedido→contas a receber (idVenda) — capturado na direção inversa
      if (detail.idNotaFiscal || detail.situacao === 1) {
        for await (const cr of paginate('/contas-receber', { idVenda: item.id })) {
          const crDetail = await get(`/contas-receber/${cr.id}`);
          if (crDetail) await P.persistContaReceber(crDetail, { vendaId: item.id });
        }
      }
    }, { query, deadline });
}

export async function syncNotas({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('notas');
  const query = windowQuery(cur, incremental, incremental ? 7 : fullDays);
  return resumableListDetail('notas', '/notas', (id) => `/notas/${id}`,
    async (detail, item) => {
      await P.persistNota(detail);
      if (detail.marcadores) await P.persistMarcadores('nota', item.id, detail.marcadores);
    }, { query, deadline });
}

export async function syncOrdemCompra({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('ordem_compra');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  return resumableListDetail('ordem_compra', '/ordem-compra', (id) => `/ordem-compra/${id}`,
    (detail) => P.persistOrdemCompra(detail), { query, deadline });
}

export async function syncOrdemServico({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('ordem_servico');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  return resumableListDetail('ordem_servico', '/ordem-servico', (id) => `/ordem-servico/${id}`,
    (detail) => P.persistOrdemServico(detail), { query, deadline });
}

export async function syncContasReceber({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('contas_receber');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  return resumableListDetail('contas_receber', '/contas-receber', (id) => `/contas-receber/${id}`,
    async (detail, item) => {
      await P.persistContaReceber(detail);
      // Só busca as baixas quando houve pagamento: contas abertas/canceladas
      // não têm recebimentos, então pular a 2ª chamada aqui ~dobra a vazão do
      // backfill sem perder dado (o detalhe já traz valorPago/saldo/situacao).
      if (temBaixa(detail)) {
        const rec = await get(`/contas-receber/${item.id}/recebimentos`);
        if (rec) await P.persistBaixas('cr', item.id, rec.itens ?? rec);
      }
    }, { query, deadline });
}

export async function syncContasPagar({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('contas_pagar');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { dataInicialEmissao: w.dataInicial, dataFinalEmissao: w.dataFinal };
  return resumableListDetail('contas_pagar', '/contas-pagar', (id) => `/contas-pagar/${id}`,
    async (detail, item) => {
      await P.persistContaPagar(detail);
      if (temBaixa(detail)) {
        const rec = await get(`/contas-pagar/${item.id}/recebimentos`);
        if (rec) await P.persistBaixas('cp', item.id, rec.itens ?? rec);
      }
    }, { query, deadline });
}

export async function syncSeparacao({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('separacao');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  return resumableListDetail('separacao', '/separacao', (id) => `/separacao/${id}`,
    (detail) => P.persistSeparacao(detail), { query, deadline });
}

export async function syncExpedicao({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('expedicao');
  const query = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  return resumableListDetail('expedicao', '/expedicao', (id) => `/expedicao/${id}`,
    (detail) => P.persistExpedicaoAgrupamento(detail), { query, deadline });
}

export async function syncCrm({ incremental = false, fullDays = 3650, deadline = Infinity } = {}) {
  const cur = await getCursor('crm');
  const w = windowQuery(cur, incremental, incremental ? 30 : fullDays);
  const query = { filtrarPor: 'data-criacao', dataInicial: w.dataInicial, dataFinal: w.dataFinal };
  return resumableListDetail('crm', '/crm/assuntos', (id) => `/crm/assuntos/${id}`,
    (detail) => P.persistCrmAssunto(detail), { query, deadline });
}

// =====================================================================
// FASE 4 — snapshots de estoque (produtos com controlar=true)
// =====================================================================
export async function syncEstoque({ deadline = Infinity } = {}) {
  const cur = await getCursor('estoque');
  let start = cur.full_done ? 0 : (cur.last_offset || 0);
  if (cur.full_done) await setCursor('estoque', { full_done: false, last_offset: 0 });

  const rows = await sql.query(
    `SELECT source_id FROM produtos
     WHERE source=$1 AND situacao <> 'E'
       AND COALESCE((payload->'estoque'->>'controlar')::boolean, false) = true
     ORDER BY source_id`,
    [SRC],
  );
  for (let i = start; i < rows.length; i++) {
    if (Date.now() >= deadline) {
      await setCursor('estoque', { last_offset: i });
      log(`estoque: pausado em ${i}/${rows.length} (deadline)`);
      return false;
    }
    const est = await get(`/estoque/${rows[i].source_id}`);
    if (est) await P.persistEstoque(est);
    if (i % 50 === 0) { await setCursor('estoque', { last_offset: i }); log(`estoque: ${i}/${rows.length}`); }
  }
  await setCursor('estoque', { last_sync_at: new Date().toISOString(), full_done: true, last_offset: 0 });
  log(`estoque: ${rows.length} snapshots`);
  return true;
}

// =====================================================================
// Runners
// =====================================================================
export async function runFull() {
  await safe('dimensoes', () => syncDimensoes());
  await safe('contatos', () => syncContatos());
  await safe('produtos', () => syncProdutos());
  await safe('pedidos', () => syncPedidos());
  await safe('notas', () => syncNotas());
  await safe('ordem-compra', () => syncOrdemCompra());
  await safe('ordem-servico', () => syncOrdemServico());
  await safe('contas-receber', () => syncContasReceber());
  await safe('contas-pagar', () => syncContasPagar());
  await safe('separacao', () => syncSeparacao());
  await safe('expedicao', () => syncExpedicao());
  await safe('crm', () => syncCrm());
  await safe('estoque', () => syncEstoque());
  log('carga full concluída');
}

// Carga inicial pragmática: cadastros finitos + janela recente de transações.
// O backfill histórico completo (runFull) deve rodar num worker persistente.
export async function runRecent(days = 90) {
  await safe('dimensoes', () => syncDimensoes());
  await safe('contatos', () => syncContatos());
  await safe('produtos', () => syncProdutos());
  await safe('estoque', () => syncEstoque());
  await safe('pedidos', () => syncPedidos({ fullDays: days }));
  await safe('notas', () => syncNotas({ fullDays: days }));
  await safe('ordem-compra', () => syncOrdemCompra({ fullDays: days }));
  await safe('ordem-servico', () => syncOrdemServico({ fullDays: days }));
  await safe('contas-receber', () => syncContasReceber({ fullDays: days }));
  await safe('contas-pagar', () => syncContasPagar({ fullDays: days }));
  await safe('separacao', () => syncSeparacao({ fullDays: days }));
  await safe('expedicao', () => syncExpedicao({ fullDays: days }));
  await safe('crm', () => syncCrm({ fullDays: days }));
  log(`carga recent (${days} dias) concluída`);
}

// safe() que propaga o resultado da fn (para detectar pausa por deadline).
async function safeRet(label, fn) {
  try { return await fn(); }
  catch (err) {
    const m = err?.message || String(err);
    if (m.includes('→ 401') || m.includes('→ 403')) log(`SKIP ${label}: sem permissão`);
    else log(`ERRO ${label}: ${m}`);
    return 'error';
  }
}

/**
 * Carga em batch com orçamento de tempo (segundos). Feito para o ambiente
 * efêmero: cada invocação avança até o deadline e persiste o offset; a próxima
 * retoma de onde parou. Roda em foreground (não morre por suspensão de container).
 * Retorna true quando TODOS os recursos estão concluídos.
 */
export async function runBatch(seconds = 480, days = 30) {
  const deadline = Date.now() + seconds * 1000;

  if (!(await getCursor('dimensoes')).full_done) {
    await safe('dimensoes', () => syncDimensoes());
  }

  const produtosDone = () => getCursor('produtos').then((c) => c.full_done);
  const steps = [
    ['contatos', () => syncContatos({ deadline })],
    ['produtos', () => syncProdutos({ deadline })],
    ['estoque', async () => (await produtosDone()) ? syncEstoque({ deadline }) : true],
    ['pedidos', () => syncPedidos({ fullDays: days, deadline })],
    ['notas', () => syncNotas({ fullDays: days, deadline })],
    // NB: o `name` deve ser o MESMO recurso usado no cursor (underscore),
    // senão o guard `full_done` não casa e o recurso re-roda todo batch.
    ['ordem_compra', () => syncOrdemCompra({ fullDays: days, deadline })],
    ['ordem_servico', () => syncOrdemServico({ fullDays: days, deadline })],
    ['contas_receber', () => syncContasReceber({ fullDays: days, deadline })],
    ['contas_pagar', () => syncContasPagar({ fullDays: days, deadline })],
    ['separacao', () => syncSeparacao({ fullDays: days, deadline })],
    ['expedicao', () => syncExpedicao({ fullDays: days, deadline })],
    ['crm', () => syncCrm({ fullDays: days, deadline })],
  ];

  for (const [name, fn] of steps) {
    const cur = await getCursor(name);
    if (cur.full_done) continue;                 // já concluído em batch anterior
    if (Date.now() >= deadline) { log('batch: deadline atingido'); return false; }
    const r = await safeRet(name, fn);
    if (r === false) { log(`batch: ${name} pausado (deadline) — fim do batch`); return false; }
  }
  log('batch: TODOS os recursos concluídos ✅');
  return true;
}

export async function runIncremental() {
  await safe('dimensoes', () => syncDimensoes()); // baratas; recarrega sempre
  await safe('contatos', () => syncContatos({ incremental: true }));
  await safe('produtos', () => syncProdutos({ incremental: true }));
  await safe('pedidos', () => syncPedidos({ incremental: true }));
  await safe('notas', () => syncNotas({ incremental: true }));
  await safe('ordem-compra', () => syncOrdemCompra({ incremental: true }));
  await safe('ordem-servico', () => syncOrdemServico({ incremental: true }));
  await safe('contas-receber', () => syncContasReceber({ incremental: true }));
  await safe('contas-pagar', () => syncContasPagar({ incremental: true }));
  await safe('separacao', () => syncSeparacao({ incremental: true }));
  await safe('expedicao', () => syncExpedicao({ incremental: true }));
  await safe('crm', () => syncCrm({ incremental: true }));
  await safe('estoque', () => syncEstoque());
  log('sync incremental concluída');
}
