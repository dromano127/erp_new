// Servidor do dashboard interativo. Serve o frontend (public/) e uma API JSON
// que consulta as views do Neon ao vivo (via driver HTTP — funciona em rede
// que bloqueia a porta 5432).
//
//   node src/server.mjs           → http://localhost:3000
//   PORT=8080 node src/server.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { sql } from './lib/db.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const VENDA_OK = 'situacao_cod NOT IN (2, 8)'; // exclui cancelada/dados incompletos

// datas: default = 1900..hoje (tudo). from/to no formato YYYY-MM-DD.
const range = (u) => [u.searchParams.get('from') || '1900-01-01',
                      u.searchParams.get('to')   || '2999-12-31'];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function api(path, u) {
  const [from, to] = range(u);

  if (path === '/api/overview') {
    const [kpi] = await sql.query(`SELECT
      (SELECT COALESCE(SUM(valor_total),0) FROM vw_vendas WHERE ${VENDA_OK} AND data_pedido BETWEEN $1 AND $2) faturamento,
      (SELECT COUNT(*)            FROM vw_vendas WHERE ${VENDA_OK} AND data_pedido BETWEEN $1 AND $2) pedidos,
      (SELECT COALESCE(SUM(margem_valor),0) FROM vw_vendas_itens WHERE data_pedido BETWEEN $1 AND $2) margem,
      (SELECT COALESCE(SUM(saldo),0) FROM vw_contas_receber WHERE situacao <> 'pago') a_receber,
      (SELECT COALESCE(SUM(saldo),0) FROM vw_contas_pagar   WHERE situacao <> 'pago') a_pagar,
      (SELECT COALESCE(SUM(valor_estoque),0) FROM vw_estoque_atual) estoque`, [from, to]);
    const byMonth = await sql.query(`SELECT ano_mes k, SUM(valor_total)::float v FROM vw_vendas
      WHERE ${VENDA_OK} AND ano_mes IS NOT NULL AND data_pedido BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]);
    const byChannel = await sql.query(`SELECT COALESCE(NULLIF(canal_venda,''),'(sem canal)') k, SUM(valor_total)::float v
      FROM vw_vendas WHERE ${VENDA_OK} AND data_pedido BETWEEN $1 AND $2 GROUP BY 1 ORDER BY v DESC LIMIT 8`, [from, to]);
    const bySeller = await sql.query(`SELECT COALESCE(vendedor,'(sem vendedor)') k, SUM(valor_total)::float v
      FROM vw_vendas WHERE ${VENDA_OK} AND data_pedido BETWEEN $1 AND $2 GROUP BY 1 ORDER BY v DESC LIMIT 8`, [from, to]);
    const aging = await sql.query(`SELECT faixa_aging k, SUM(saldo)::float v FROM vw_contas_receber
      WHERE situacao <> 'pago' GROUP BY 1`);
    return { kpi, byMonth, byChannel, bySeller, aging };
  }

  if (path === '/api/products') {
    const qy = u.searchParams.get('q') || '';
    const limit = Math.min(200, Number(u.searchParams.get('limit') || 50));
    const rows = await sql.query(`SELECT produto_id id, sku, produto, categoria, marca,
        SUM(quantidade)::float qtd, SUM(valor_item)::float receita,
        SUM(margem_valor)::float margem, COUNT(DISTINCT pedido_id)::int pedidos
      FROM vw_vendas_itens
      WHERE data_pedido BETWEEN $1 AND $2
        AND ($3 = '' OR produto ILIKE '%'||$3||'%' OR sku ILIKE '%'||$3||'%')
      GROUP BY 1,2,3,4,5 ORDER BY receita DESC NULLS LAST LIMIT $4`, [from, to, qy, limit]);
    return { rows };
  }

  if (path.startsWith('/api/product/')) {
    const id = Number(path.split('/').pop());
    const [info] = await sql.query(`SELECT p.source_id id, p.sku, p.descricao, p.situacao, p.unidade, p.ncm,
        p.preco, p.preco_custo, p.preco_custo_medio, cat.descricao categoria, mc.nome marca
      FROM produtos p
      LEFT JOIN categorias cat ON cat.source=p.source AND cat.source_id=p.categoria_id
      LEFT JOIN marcas mc ON mc.source=p.source AND mc.source_id=p.marca_id
      WHERE p.source_id=$1`, [id]);
    const [stats] = await sql.query(`SELECT COALESCE(SUM(quantidade),0)::float qtd,
        COALESCE(SUM(valor_item),0)::float receita, COALESCE(SUM(margem_valor),0)::float margem,
        COUNT(DISTINCT pedido_id)::int pedidos
      FROM vw_vendas_itens WHERE produto_id=$1 AND data_pedido BETWEEN $2 AND $3`, [id, from, to]);
    const monthly = await sql.query(`SELECT ano_mes k, SUM(valor_item)::float v FROM vw_vendas_itens
      WHERE produto_id=$1 AND ano_mes IS NOT NULL AND data_pedido BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`, [id, from, to]);
    const stock = await sql.query(`SELECT deposito, saldo::float, disponivel::float, valor_estoque::float
      FROM vw_estoque_atual WHERE produto_id=$1`, [id]);
    const orders = await sql.query(`SELECT p.numero, p.data, c.nome cliente,
        pi.quantidade::float, pi.valor_unitario::float, (pi.quantidade*pi.valor_unitario)::float total
      FROM pedido_itens pi
      JOIN pedidos p ON p.source=pi.source AND p.source_id=pi.pedido_id
      LEFT JOIN contatos c ON c.source=p.source AND c.source_id=p.cliente_id
      WHERE pi.produto_id=$1 AND p.data BETWEEN $2 AND $3
      ORDER BY p.data DESC NULLS LAST LIMIT 12`, [id, from, to]);
    return { info: info || null, stats, monthly, stock, orders };
  }

  return null;
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname.startsWith('/api/')) {
      const data = await api(u.pathname, u);
      if (data === null) { res.writeHead(404).end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return;
    }
    // estáticos
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404).end('não encontrado'); return; }
    console.error(err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => console.log(`Dashboard em http://localhost:${PORT}`));
