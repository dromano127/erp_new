-- =====================================================================
-- Views de BI para Google Looker Studio (e qualquer ferramenta SQL).
-- Cada view já traz labels legíveis (situação, tipo) e os joins prontos,
-- pra você arrastar campos no Looker sem escrever SQL.
-- Idempotente: CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- VENDAS — 1 linha por pedido (fato de vendas)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_vendas AS
SELECT
  p.source_id                         AS pedido_id,
  p.numero                            AS numero_pedido,
  p.data                              AS data_pedido,
  p.data_faturamento,
  p.data_entrega,
  EXTRACT(YEAR  FROM p.data)::int      AS ano,
  EXTRACT(MONTH FROM p.data)::int      AS mes,
  to_char(p.data, 'YYYY-MM')           AS ano_mes,
  CASE p.situacao
    WHEN 8 THEN 'Dados incompletos' WHEN 0 THEN 'Aberta'    WHEN 3 THEN 'Aprovada'
    WHEN 4 THEN 'Preparando envio'  WHEN 1 THEN 'Faturada'  WHEN 7 THEN 'Pronto envio'
    WHEN 5 THEN 'Enviada'           WHEN 6 THEN 'Entregue'  WHEN 2 THEN 'Cancelada'
    WHEN 9 THEN 'Não entregue'      ELSE 'Outro' END        AS situacao,
  p.situacao                          AS situacao_cod,
  CASE p.origem_pedido WHEN 0 THEN 'Pedido de venda' WHEN 1 THEN 'PDV' END AS origem,
  p.canal_venda,
  p.ecommerce_nome                    AS canal_nome,
  c.nome                              AS cliente,
  c.cpf_cnpj                          AS cliente_cpf_cnpj,
  c.endereco->>'uf'                   AS cliente_uf,
  c.endereco->>'municipio'            AS cliente_municipio,
  v.nome                              AS vendedor,
  p.valor_produtos,
  p.valor_frete,
  p.valor_desconto,
  p.valor_total,
  p.nota_fiscal_id
FROM pedidos p
LEFT JOIN contatos    c ON c.source = p.source AND c.source_id = p.cliente_id
LEFT JOIN vendedores  v ON v.source = p.source AND v.source_id = p.vendedor_id;

-- ---------------------------------------------------------------------
-- VENDAS POR ITEM — 1 linha por item de pedido (análise de produto/margem)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_vendas_itens AS
SELECT
  pi.pedido_id,
  p.numero                            AS numero_pedido,
  p.data                              AS data_pedido,
  to_char(p.data, 'YYYY-MM')           AS ano_mes,
  p.canal_venda,
  c.nome                              AS cliente,
  v.nome                              AS vendedor,
  pi.produto_id,
  pi.sku,
  COALESCE(pr.descricao, pi.descricao) AS produto,
  cat.descricao                       AS categoria,
  cat.caminho                         AS categoria_caminho,
  mc.nome                             AS marca,
  pi.quantidade,
  pi.valor_unitario,
  (pi.quantidade * pi.valor_unitario)  AS valor_item,
  pr.preco_custo_medio,
  (pi.quantidade * COALESCE(pr.preco_custo_medio,0))               AS custo_total,
  (pi.quantidade * (pi.valor_unitario - COALESCE(pr.preco_custo_medio,0))) AS margem_valor
FROM pedido_itens pi
JOIN pedidos p     ON p.source = pi.source AND p.source_id = pi.pedido_id
LEFT JOIN contatos   c  ON c.source = p.source AND c.source_id = p.cliente_id
LEFT JOIN vendedores v  ON v.source = p.source AND v.source_id = p.vendedor_id
LEFT JOIN produtos   pr ON pr.source = pi.source AND pr.source_id = pi.produto_id
LEFT JOIN categorias cat ON cat.source = pr.source AND cat.source_id = pr.categoria_id
LEFT JOIN marcas     mc ON mc.source = pr.source AND mc.source_id = pr.marca_id;

-- ---------------------------------------------------------------------
-- NOTAS FISCAIS — fato fiscal
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_notas AS
SELECT
  n.source_id                         AS nota_id,
  n.numero,
  n.serie,
  n.chave_acesso,
  n.data_emissao,
  to_char(n.data_emissao, 'YYYY-MM')   AS ano_mes,
  CASE n.tipo WHEN 'E' THEN 'Entrada' WHEN 'S' THEN 'Saída' END AS tipo,
  CASE n.situacao
    WHEN 1 THEN 'Pendente'  WHEN 2 THEN 'Emitida'   WHEN 3 THEN 'Cancelada'
    WHEN 4 THEN 'Aguard. recibo' WHEN 5 THEN 'Rejeitada' WHEN 6 THEN 'Autorizada'
    WHEN 7 THEN 'Emitida DANFE'  WHEN 8 THEN 'Registrada' WHEN 9 THEN 'Aguard. protocolo'
    WHEN 10 THEN 'Denegada' ELSE 'Outro' END        AS situacao,
  n.origem_tipo,
  n.origem_id,
  c.nome                              AS cliente,
  vd.nome                             AS vendedor,
  n.valor,
  n.valor_produtos,
  n.valor_frete,
  n.valor_desconto,
  n.valor_icms,
  n.valor_ipi,
  n.valor_issqn
FROM notas_fiscais n
LEFT JOIN contatos   c  ON c.source = n.source AND c.source_id = n.cliente_id
LEFT JOIN vendedores vd ON vd.source = n.source AND vd.source_id = n.vendedor_id;

-- ---------------------------------------------------------------------
-- FINANCEIRO — contas a receber com aging
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_contas_receber AS
SELECT
  cr.source_id                        AS conta_id,
  cr.situacao,
  cr.data                             AS data_emissao,
  cr.data_vencimento,
  cr.data_liquidacao,
  to_char(cr.data_vencimento, 'YYYY-MM') AS venc_ano_mes,
  c.nome                              AS cliente,
  cat.descricao                       AS categoria,
  cr.numero_documento,
  cr.valor,
  cr.saldo,
  cr.valor_pago,
  (CURRENT_DATE - cr.data_vencimento) AS dias_atraso,
  CASE
    WHEN cr.situacao = 'pago' THEN 'Pago'
    WHEN cr.data_vencimento IS NULL THEN 'Sem vencimento'
    WHEN cr.data_vencimento >= CURRENT_DATE THEN 'A vencer'
    WHEN CURRENT_DATE - cr.data_vencimento BETWEEN 1 AND 30  THEN '1-30 dias'
    WHEN CURRENT_DATE - cr.data_vencimento BETWEEN 31 AND 60 THEN '31-60 dias'
    WHEN CURRENT_DATE - cr.data_vencimento BETWEEN 61 AND 90 THEN '61-90 dias'
    ELSE '90+ dias' END               AS faixa_aging,
  cr.venda_id,
  cr.nota_id
FROM contas_receber cr
LEFT JOIN contatos c   ON c.source = cr.source AND c.source_id = cr.cliente_id
LEFT JOIN cat_receita_despesa cat ON cat.source = cr.source AND cat.source_id = cr.categoria_id;

-- ---------------------------------------------------------------------
-- FINANCEIRO — contas a pagar com aging
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_contas_pagar AS
SELECT
  cp.source_id                        AS conta_id,
  cp.situacao,
  cp.data                             AS data_emissao,
  cp.data_vencimento,
  cp.data_liquidacao,
  to_char(cp.data_vencimento, 'YYYY-MM') AS venc_ano_mes,
  c.nome                              AS fornecedor,
  cat.descricao                       AS categoria,
  cp.numero_documento,
  cp.valor,
  cp.saldo,
  cp.valor_pago,
  (CURRENT_DATE - cp.data_vencimento) AS dias_atraso,
  CASE
    WHEN cp.situacao = 'pago' THEN 'Pago'
    WHEN cp.data_vencimento IS NULL THEN 'Sem vencimento'
    WHEN cp.data_vencimento >= CURRENT_DATE THEN 'A vencer'
    WHEN CURRENT_DATE - cp.data_vencimento BETWEEN 1 AND 30  THEN '1-30 dias'
    WHEN CURRENT_DATE - cp.data_vencimento BETWEEN 31 AND 60 THEN '31-60 dias'
    WHEN CURRENT_DATE - cp.data_vencimento BETWEEN 61 AND 90 THEN '61-90 dias'
    ELSE '90+ dias' END               AS faixa_aging
FROM contas_pagar cp
LEFT JOIN contatos c   ON c.source = cp.source AND c.source_id = cp.contato_id
LEFT JOIN cat_receita_despesa cat ON cat.source = cp.source AND cat.source_id = cp.categoria_id;

-- ---------------------------------------------------------------------
-- ESTOQUE — snapshot mais recente por produto/depósito
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_estoque_atual AS
SELECT DISTINCT ON (e.produto_id, e.deposito_id)
  e.produto_id,
  pr.sku,
  pr.descricao                        AS produto,
  cat.descricao                       AS categoria,
  mc.nome                             AS marca,
  d.nome                              AS deposito,
  e.saldo,
  e.reservado,
  e.disponivel,
  pr.preco_custo_medio,
  (e.saldo * COALESCE(pr.preco_custo_medio,0)) AS valor_estoque,
  e.captured_at
FROM estoque_snapshot e
LEFT JOIN produtos   pr ON pr.source = e.source AND pr.source_id = e.produto_id
LEFT JOIN categorias cat ON cat.source = pr.source AND cat.source_id = pr.categoria_id
LEFT JOIN marcas     mc ON mc.source = pr.source AND mc.source_id = pr.marca_id
LEFT JOIN depositos  d  ON d.source = e.source AND d.source_id = e.deposito_id
ORDER BY e.produto_id, e.deposito_id, e.captured_at DESC;
