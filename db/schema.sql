-- =====================================================================
-- ERP replica — schema canônico multi-fonte (Tiny/Olist ERP v3 → Postgres)
-- Baseado em APITinyv3AnaliseCompleta.md, seção 5 (modelo sugerido).
--
-- Princípios:
--   * PK composta (source, source_id): source='tiny' hoje; 'bling'/'omie' amanhã.
--   * FKs (cliente_id, produto_id...) guardam o source_id da entidade referida,
--     resolvido dentro do mesmo `source`.
--   * payload JSONB = backup fiel do detalhe da API (protege contra campos novos).
--   * Estoque/preços são snapshots (não há data de alteração consultável).
--
-- Idempotente: pode ser re-executado (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Infra do sincronizador
-- ---------------------------------------------------------------------

-- Tokens OAuth2 por conector (access_token curto + refresh_token).
CREATE TABLE IF NOT EXISTS sync_tokens (
  source         TEXT PRIMARY KEY DEFAULT 'tiny',
  access_token   TEXT,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Cursor de sincronização incremental por recurso.
CREATE TABLE IF NOT EXISTS sync_state (
  source        TEXT NOT NULL DEFAULT 'tiny',
  recurso       TEXT NOT NULL,          -- 'pedidos', 'contatos', 'produtos'...
  last_sync_at  TIMESTAMPTZ,            -- para filtros dataAtualizacao/dataAlteracao
  last_offset   INT DEFAULT 0,
  full_done     BOOLEAN DEFAULT false,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, recurso)
);

-- ---------------------------------------------------------------------
-- Empresa / conta
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresa (
  source           TEXT NOT NULL DEFAULT 'tiny',
  source_id        BIGINT NOT NULL DEFAULT 0,   -- /info não tem id; usamos 0
  razao_social     TEXT,
  fantasia         TEXT,
  cpf_cnpj         TEXT,
  inscricao_estadual TEXT,
  fone             TEXT,
  email            TEXT,
  regime_tributario SMALLINT,
  endereco         JSONB,
  payload          JSONB,
  synced_at        TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

-- =====================================================================
-- DIMENSÕES (carga completa, baixa frequência)
-- =====================================================================

CREATE TABLE IF NOT EXISTS contatos (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  nome          TEXT,
  codigo        TEXT,
  fantasia      TEXT,
  tipo_pessoa   CHAR(1),          -- J/F/E/X
  cpf_cnpj      TEXT,
  inscricao_estadual TEXT,
  rg            TEXT,
  email         TEXT,
  telefone      TEXT,
  celular       TEXT,
  situacao      CHAR(1),          -- B/A/I/E
  status_crm    CHAR(1),          -- L/P/C/I
  vendedor_id   BIGINT,
  limite_credito NUMERIC,
  endereco          JSONB,
  endereco_cobranca JSONB,
  data_criacao      TIMESTAMPTZ,
  data_atualizacao  TIMESTAMPTZ,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS contato_tipos (
  source     TEXT NOT NULL DEFAULT 'tiny',
  contato_id BIGINT NOT NULL,
  tipo_id    BIGINT NOT NULL,
  descricao  TEXT,
  PRIMARY KEY (source, contato_id, tipo_id)
);

CREATE TABLE IF NOT EXISTS contato_pessoas (
  source     TEXT NOT NULL DEFAULT 'tiny',
  source_id  BIGINT NOT NULL,
  contato_id BIGINT,
  nome       TEXT,
  telefone   TEXT,
  ramal      TEXT,
  email      TEXT,
  setor      TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS vendedores (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  codigo    TEXT,
  payload   JSONB,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS usuarios (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  email     TEXT,
  tipo      TEXT,               -- 'vendedor' | '' | 'contador'
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS categorias (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  descricao TEXT,
  pai_id    BIGINT,
  caminho   TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS marcas (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS tags_produto (
  source     TEXT NOT NULL DEFAULT 'tiny',
  source_id  BIGINT NOT NULL,
  nome       TEXT,
  grupo_id   BIGINT,
  grupo_nome TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS grupos_tags (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS formas_envio (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  tipo      TEXT,
  situacao  CHAR(1),
  gateway   JSONB,
  payload   JSONB,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS formas_frete (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  forma_envio_id BIGINT,
  nome          TEXT,
  codigo        TEXT,
  codigo_externo TEXT,
  tipo_entrega  TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS formas_pagamento (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  situacao  CHAR(1),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS formas_recebimento (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  situacao  CHAR(1),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS intermediadores (
  source          TEXT NOT NULL DEFAULT 'tiny',
  source_id       BIGINT NOT NULL,
  nome            TEXT,
  cnpj            TEXT,
  canal_venda     TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS cat_receita_despesa (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  descricao TEXT,
  grupo     TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS listas_preco (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  nome      TEXT,
  acrescimo_desconto NUMERIC,
  payload   JSONB,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS depositos (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  nome          TEXT,
  desconsiderar BOOLEAN,
  empresa       TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS servicos (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  codigo    TEXT,
  descricao TEXT,
  situacao  CHAR(1),
  payload   JSONB,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS crm_estagios (
  source    TEXT NOT NULL DEFAULT 'tiny',
  source_id BIGINT NOT NULL,
  descricao TEXT,
  ordem     INT,
  PRIMARY KEY (source, source_id)
);

-- =====================================================================
-- CATÁLOGO
-- =====================================================================

CREATE TABLE IF NOT EXISTS produtos (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  sku           TEXT,
  gtin          TEXT,
  descricao     TEXT,
  descricao_complementar TEXT,
  tipo          CHAR(1),   -- K kit, S simples, V variações, F fabricado, M matéria-prima
  tipo_variacao CHAR(1),   -- N / P (pai) / V (variação)
  situacao      CHAR(1),   -- A/I/E
  unidade       TEXT,
  ncm           TEXT,
  origem        TEXT,
  produto_pai_id BIGINT,
  categoria_id  BIGINT,
  marca_id      BIGINT,
  preco             NUMERIC,
  preco_promocional NUMERIC,
  preco_custo       NUMERIC,
  preco_custo_medio NUMERIC,
  dimensoes     JSONB,
  seo           JSONB,
  tributacao    JSONB,
  data_criacao  TIMESTAMPTZ,
  data_alteracao TIMESTAMPTZ,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS produto_fornecedores (
  source              TEXT NOT NULL DEFAULT 'tiny',
  produto_id          BIGINT NOT NULL,
  contato_id          BIGINT NOT NULL,
  codigo_no_fornecedor TEXT,
  PRIMARY KEY (source, produto_id, contato_id)
);

CREATE TABLE IF NOT EXISTS produto_grade (
  source     TEXT NOT NULL DEFAULT 'tiny',
  produto_id BIGINT NOT NULL,
  chave      TEXT NOT NULL,
  valor      TEXT,
  PRIMARY KEY (source, produto_id, chave)
);

CREATE TABLE IF NOT EXISTS produto_kit (
  source        TEXT NOT NULL DEFAULT 'tiny',
  kit_id        BIGINT NOT NULL,
  componente_id BIGINT NOT NULL,
  quantidade    NUMERIC,
  PRIMARY KEY (source, kit_id, componente_id)
);

CREATE TABLE IF NOT EXISTS produto_producao (
  source     TEXT NOT NULL DEFAULT 'tiny',
  produto_id BIGINT NOT NULL,
  insumo_id  BIGINT NOT NULL,
  quantidade NUMERIC,
  PRIMARY KEY (source, produto_id, insumo_id)
);

CREATE TABLE IF NOT EXISTS produto_tags (
  source     TEXT NOT NULL DEFAULT 'tiny',
  produto_id BIGINT NOT NULL,
  tag        TEXT NOT NULL,
  grupo      TEXT,
  PRIMARY KEY (source, produto_id, tag)
);

-- =====================================================================
-- SNAPSHOTS (estoque/custos — sem data de alteração consultável)
-- =====================================================================

CREATE TABLE IF NOT EXISTS estoque_snapshot (
  source      TEXT NOT NULL DEFAULT 'tiny',
  produto_id  BIGINT NOT NULL,
  deposito_id BIGINT NOT NULL DEFAULT 0,
  saldo       NUMERIC,
  reservado   NUMERIC,
  disponivel  NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, produto_id, deposito_id, captured_at)
);

CREATE TABLE IF NOT EXISTS custo_snapshot (
  source      TEXT NOT NULL DEFAULT 'tiny',
  produto_id  BIGINT NOT NULL,
  data        DATE NOT NULL,
  preco_custo NUMERIC,
  preco_custo_medio NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, produto_id, data, captured_at)
);

-- =====================================================================
-- TRANSAÇÕES
-- =====================================================================

CREATE TABLE IF NOT EXISTS pedidos (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  numero        INT,
  situacao      SMALLINT,   -- 8/0/3/4/1/7/5/6/2/9
  origem_pedido SMALLINT,   -- 0 venda / 1 PDV
  data          DATE,
  data_prevista DATE,
  data_envio    DATE,
  data_entrega  DATE,
  data_faturamento DATE,
  cliente_id    BIGINT,
  vendedor_id   BIGINT,
  deposito_id   BIGINT,
  lista_preco_id BIGINT,
  natureza_operacao_id BIGINT,
  intermediador_id BIGINT,
  transportador_id BIGINT,
  forma_envio_id  BIGINT,
  forma_frete_id  BIGINT,
  forma_recebimento_id BIGINT,
  meio_pagamento_id BIGINT,
  condicao_pagamento TEXT,
  ecommerce_id  BIGINT,
  ecommerce_nome TEXT,
  numero_pedido_ecommerce TEXT,
  canal_venda   TEXT,
  nota_fiscal_id BIGINT,                     -- vínculo pedido→nota
  valor_produtos NUMERIC,
  valor_frete    NUMERIC,
  valor_desconto NUMERIC,
  valor_outras   NUMERIC,
  valor_total    NUMERIC,
  endereco_entrega JSONB,
  codigo_rastreamento TEXT,
  url_rastreamento    TEXT,
  observacoes    TEXT,
  data_atualizacao TIMESTAMPTZ,
  payload        JSONB,
  synced_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS pedido_itens (
  source      TEXT NOT NULL DEFAULT 'tiny',
  pedido_id   BIGINT NOT NULL,
  seq         SMALLINT NOT NULL,
  produto_id  BIGINT,
  sku         TEXT,
  descricao   TEXT,
  quantidade  NUMERIC,
  valor_unitario NUMERIC,
  info_adicional TEXT,
  PRIMARY KEY (source, pedido_id, seq)
);

CREATE TABLE IF NOT EXISTS pedido_parcelas (
  source      TEXT NOT NULL DEFAULT 'tiny',
  pedido_id   BIGINT NOT NULL,
  seq         SMALLINT NOT NULL,
  dias        INT,
  data        DATE,
  valor       NUMERIC,
  forma_recebimento_id BIGINT,
  meio_pagamento_id    BIGINT,
  observacoes TEXT,
  PRIMARY KEY (source, pedido_id, seq)
);

CREATE TABLE IF NOT EXISTS pedido_pag_integrados (
  source      TEXT NOT NULL DEFAULT 'tiny',
  pedido_id   BIGINT NOT NULL,
  seq         SMALLINT NOT NULL,
  valor       NUMERIC,
  tipo_pagamento INT,
  cnpj_intermediador TEXT,
  codigo_autorizacao TEXT,
  codigo_bandeira INT,
  PRIMARY KEY (source, pedido_id, seq)
);

-- Marcadores (tags livres) de pedido/nota/cp/cr/oc/os/crm
CREATE TABLE IF NOT EXISTS marcadores (
  source    TEXT NOT NULL DEFAULT 'tiny',
  objeto    TEXT NOT NULL,        -- pedido/nota/contas_receber/contas_pagar/oc/os/crm
  objeto_id BIGINT NOT NULL,
  marcador  TEXT NOT NULL,
  cor       TEXT,
  PRIMARY KEY (source, objeto, objeto_id, marcador)
);

CREATE TABLE IF NOT EXISTS notas_fiscais (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  tipo          CHAR(1),   -- E/S
  situacao      SMALLINT,  -- 1..10
  finalidade    SMALLINT,
  numero        TEXT,
  serie         TEXT,
  chave_acesso  TEXT,
  data_emissao  TIMESTAMPTZ,
  data_inclusao TIMESTAMPTZ,
  cliente_id    BIGINT,
  vendedor_id   BIGINT,
  origem_tipo   TEXT,      -- venda/ordemservico/pedido_compra/devolucao...
  origem_id     BIGINT,
  forma_envio_id BIGINT,
  forma_frete_id BIGINT,
  intermediador_id BIGINT,
  natureza_operacao_id BIGINT,
  forma_pagamento_id BIGINT,
  meio_pagamento_id  BIGINT,
  valor          NUMERIC,
  valor_produtos NUMERIC,
  valor_frete    NUMERIC,
  valor_desconto NUMERIC,
  base_icms   NUMERIC,
  valor_icms  NUMERIC,
  valor_ipi   NUMERIC,
  valor_issqn NUMERIC,
  valor_ibs_uf NUMERIC,   -- reforma tributária
  valor_cbs    NUMERIC,
  ecommerce        JSONB,
  transportador    JSONB,
  endereco_entrega JSONB,
  codigo_rastreamento TEXT,
  xml            TEXT,
  payload        JSONB,
  synced_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS nf_itens (
  source        TEXT NOT NULL DEFAULT 'tiny',
  nota_id       BIGINT NOT NULL,
  item_id       BIGINT NOT NULL,
  produto_id    BIGINT,
  codigo        TEXT,
  ncm           TEXT,
  cfop          TEXT,
  descricao     TEXT,
  unidade       TEXT,
  quantidade    NUMERIC,
  valor_unitario NUMERIC,
  valor_total    NUMERIC,
  natureza_operacao TEXT,
  impostos      JSONB,
  PRIMARY KEY (source, nota_id, item_id)
);

CREATE TABLE IF NOT EXISTS nf_parcelas (
  source      TEXT NOT NULL DEFAULT 'tiny',
  nota_id     BIGINT NOT NULL,
  seq         SMALLINT NOT NULL,
  dias        INT,
  data        DATE,
  valor       NUMERIC,
  forma_pagamento_id BIGINT,
  meio_pagamento_id  BIGINT,
  observacoes TEXT,
  PRIMARY KEY (source, nota_id, seq)
);

CREATE TABLE IF NOT EXISTS contas_receber (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  situacao      TEXT,    -- aberto/cancelada/pago/parcial/prevista/atrasadas/emissao
  cliente_id    BIGINT,
  categoria_id  BIGINT,
  forma_recebimento_id BIGINT,
  venda_id      BIGINT,  -- via filtro idVenda
  nota_id       BIGINT,  -- via filtro idNota
  data          DATE,
  data_vencimento  DATE,
  data_competencia DATE,
  data_liquidacao  DATE,
  numero_documento TEXT,
  serie_documento  TEXT,
  numero_banco  TEXT,
  ocorrencia    TEXT,
  valor         NUMERIC,
  saldo         NUMERIC,
  valor_pago    NUMERIC,
  juros         NUMERIC,
  multa         NUMERIC,
  taxa          NUMERIC,
  historico     TEXT,
  link_boleto   TEXT,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS contas_pagar (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  situacao      TEXT,
  contato_id    BIGINT,   -- fornecedor/credor
  categoria_id  BIGINT,
  forma_pagamento_id BIGINT,
  data          DATE,
  data_vencimento  DATE,
  data_competencia DATE,
  data_liquidacao  DATE,
  numero_documento TEXT,
  serie_documento  TEXT,
  ocorrencia    TEXT,
  valor         NUMERIC,
  saldo         NUMERIC,
  valor_pago    NUMERIC,
  juros         NUMERIC,
  multa         NUMERIC,
  historico     TEXT,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

-- Baixas/liquidações (GET /contas-*/{id}/recebimentos)
CREATE TABLE IF NOT EXISTS baixas (
  source      TEXT NOT NULL DEFAULT 'tiny',
  conta_tipo  CHAR(2) NOT NULL,   -- 'cr' | 'cp'
  conta_id    BIGINT NOT NULL,
  source_id   BIGINT NOT NULL,
  data        DATE,
  valor_pago      NUMERIC,
  valor_juro      NUMERIC,
  valor_taxa      NUMERIC,
  valor_desconto  NUMERIC,
  valor_acrescimo NUMERIC,
  id_conta_bancaria TEXT,
  tipo        INT,
  PRIMARY KEY (source, conta_tipo, conta_id, source_id)
);

CREATE TABLE IF NOT EXISTS ordens_compra (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  numero        TEXT,
  situacao      SMALLINT,   -- 0/1/2/3
  data          DATE,
  data_prevista DATE,
  fornecedor_id BIGINT,
  categoria_id  BIGINT,
  nota_fiscal_id BIGINT,
  total         NUMERIC,
  frete         NUMERIC,
  desconto      NUMERIC,
  frete_por_conta TEXT,
  observacoes   TEXT,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS oc_itens (
  source     TEXT NOT NULL DEFAULT 'tiny',
  oc_id      BIGINT NOT NULL,
  seq        SMALLINT NOT NULL,
  produto_id BIGINT,
  gtin       TEXT,
  quantidade NUMERIC,
  preco      NUMERIC,
  ipi        NUMERIC,
  PRIMARY KEY (source, oc_id, seq)
);

CREATE TABLE IF NOT EXISTS oc_parcelas (
  source     TEXT NOT NULL DEFAULT 'tiny',
  oc_id      BIGINT NOT NULL,
  seq        SMALLINT NOT NULL,
  dias       INT,
  data_vencimento DATE,
  valor      NUMERIC,
  meio_pagamento TEXT,
  observacoes TEXT,
  PRIMARY KEY (source, oc_id, seq)
);

CREATE TABLE IF NOT EXISTS ordens_servico (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  numero        TEXT,
  situacao      SMALLINT,
  data          DATE,
  data_prevista DATE,
  data_conclusao DATE,
  contato_id    BIGINT,
  vendedor_id   BIGINT,
  categoria_id  BIGINT,
  forma_recebimento_id BIGINT,
  deposito_id   BIGINT,
  lista_preco_id BIGINT,
  equipamento   TEXT,
  total_servicos NUMERIC,
  total_pecas    NUMERIC,
  total          NUMERIC,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS separacoes (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  situacao      SMALLINT,   -- 1/2/3/4
  venda_id      BIGINT,
  nota_id       BIGINT,
  cliente_id    BIGINT,
  forma_envio_id BIGINT,
  usuario_embalador_id BIGINT,
  data_criacao   TIMESTAMPTZ,
  data_separacao TIMESTAMPTZ,
  data_checkout  TIMESTAMPTZ,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS expedicao_agrupamentos (
  source        TEXT NOT NULL DEFAULT 'tiny',
  source_id     BIGINT NOT NULL,
  identificacao TEXT,
  data          DATE,
  forma_envio_id BIGINT,
  payload       JSONB,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS expedicoes (
  source         TEXT NOT NULL DEFAULT 'tiny',
  source_id      BIGINT NOT NULL,
  agrupamento_id BIGINT,
  situacao       TEXT,
  tipo_objeto    TEXT,
  objeto_id      BIGINT,
  venda_id       BIGINT,
  nota_id        BIGINT,
  destinatario_id BIGINT,
  codigo_rastreio TEXT,
  url_rastreio    TEXT,
  transportador_id BIGINT,
  forma_frete_id  BIGINT,
  volume         JSONB,
  payload        JSONB,
  synced_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

-- =====================================================================
-- CRM
-- =====================================================================

CREATE TABLE IF NOT EXISTS crm_assuntos (
  source       TEXT NOT NULL DEFAULT 'tiny',
  source_id    BIGINT NOT NULL,
  assunto      TEXT,
  cliente_id   BIGINT,
  estagio_id   BIGINT,
  status_crm   CHAR(1),
  estrela      BOOLEAN,
  arquivado    BOOLEAN,
  data         TIMESTAMPTZ,
  data_atualizacao TIMESTAMPTZ,
  payload      JSONB,
  synced_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS crm_acoes (
  source       TEXT NOT NULL DEFAULT 'tiny',
  source_id    BIGINT NOT NULL,
  assunto_id   BIGINT,
  descricao    TEXT,
  tipo_data    CHAR(1),
  data         TIMESTAMPTZ,
  data_criacao TIMESTAMPTZ,
  data_concluida TIMESTAMPTZ,
  acao_concluida BOOLEAN,
  usuario_id   BIGINT,
  usuario_responsavel_id BIGINT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS crm_anotacoes (
  source     TEXT NOT NULL DEFAULT 'tiny',
  source_id  BIGINT NOT NULL,
  assunto_id BIGINT,
  data       TIMESTAMPTZ,
  anotacao   TEXT,
  usuario_id BIGINT,
  PRIMARY KEY (source, source_id)
);

-- =====================================================================
-- ÍNDICES (para relatórios e joins da seção 5.5)
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_contatos_cpfcnpj    ON contatos (cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_contatos_vendedor    ON contatos (source, vendedor_id);
CREATE INDEX IF NOT EXISTS idx_contatos_atualizacao ON contatos (data_atualizacao);

CREATE INDEX IF NOT EXISTS idx_produtos_sku      ON produtos (sku);
CREATE INDEX IF NOT EXISTS idx_produtos_gtin     ON produtos (gtin);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos (source, categoria_id);
CREATE INDEX IF NOT EXISTS idx_produtos_marca     ON produtos (source, marca_id);
CREATE INDEX IF NOT EXISTS idx_produtos_pai       ON produtos (source, produto_pai_id);
CREATE INDEX IF NOT EXISTS idx_produtos_alteracao ON produtos (data_alteracao);

CREATE INDEX IF NOT EXISTS idx_pedidos_data     ON pedidos (data);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON pedidos (source, cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor ON pedidos (source, vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_situacao ON pedidos (situacao);
CREATE INDEX IF NOT EXISTS idx_pedidos_canal    ON pedidos (canal_venda);
CREATE INDEX IF NOT EXISTS idx_pedidos_nf       ON pedidos (source, nota_fiscal_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_atualizacao ON pedidos (data_atualizacao);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_produto ON pedido_itens (source, produto_id);

CREATE INDEX IF NOT EXISTS idx_notas_emissao ON notas_fiscais (data_emissao);
CREATE INDEX IF NOT EXISTS idx_notas_cliente ON notas_fiscais (source, cliente_id);
CREATE INDEX IF NOT EXISTS idx_notas_origem  ON notas_fiscais (source, origem_tipo, origem_id);
CREATE INDEX IF NOT EXISTS idx_notas_chave   ON notas_fiscais (chave_acesso);

CREATE INDEX IF NOT EXISTS idx_nf_itens_produto ON nf_itens (source, produto_id);

CREATE INDEX IF NOT EXISTS idx_cr_venc    ON contas_receber (data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_cliente ON contas_receber (source, cliente_id);
CREATE INDEX IF NOT EXISTS idx_cr_situacao ON contas_receber (situacao);
CREATE INDEX IF NOT EXISTS idx_cr_venda   ON contas_receber (source, venda_id);

CREATE INDEX IF NOT EXISTS idx_cp_venc    ON contas_pagar (data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cp_contato ON contas_pagar (source, contato_id);
CREATE INDEX IF NOT EXISTS idx_cp_situacao ON contas_pagar (situacao);

CREATE INDEX IF NOT EXISTS idx_estoque_produto ON estoque_snapshot (source, produto_id);
CREATE INDEX IF NOT EXISTS idx_sep_venda ON separacoes (source, venda_id);
CREATE INDEX IF NOT EXISTS idx_exp_agrup ON expedicoes (source, agrupamento_id);
CREATE INDEX IF NOT EXISTS idx_crm_assunto_cliente ON crm_assuntos (source, cliente_id);
