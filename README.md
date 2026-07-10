# ERP Replica — Tiny/Olist ERP v3 → Neon (Postgres)

Réplica em Postgres dos dados expostos pela **API Tiny/Olist ERP v3**, para
**relatórios** e **backup**. O modelo segue a análise em
[`APITinyv3AnaliseCompleta.md`](./APITinyv3AnaliseCompleta.md) (seção 5).

## Estado atual

- **Banco:** Neon, projeto **ERP** (`sparkling-heart-63527951`), branch `production`,
  database `neondb`, Postgres 18.
- **Schema aplicado:** 51 tabelas (`db/schema.sql`) — dimensões, catálogo,
  snapshots, transações, CRM + infra de sync (`sync_tokens`, `sync_state`).

## Modelagem (resumo)

- **Schema canônico multi-fonte:** toda tabela usa `(source, source_id)` como PK
  composta. Hoje `source = 'tiny'`; amanhã `'bling'`/`'omie'` reusam as mesmas
  tabelas — o conector do Tiny é só um tradutor API → schema.
- **Desnormaliza o embutido, normaliza o referenciado:** objetos aninhados só
  com `id`+`nome` viram FK (`cliente_id`, `vendedor_id`...) alimentadas pelas
  tabelas-dimensão; blocos sem endpoint próprio (parcelas, grade, endereço de
  entrega) viram tabelas-filhas ou colunas.
- **`payload JSONB`** em cada tabela transacional = backup fiel do detalhe da API
  (protege contra campos novos, ex. IBS/CBS da reforma tributária).
- **Estoque e preços são snapshots** (`estoque_snapshot`, `custo_snapshot`) com
  `captured_at` — a API não expõe data de alteração desses dados.

Ver o mapa de relacionamentos e a estratégia de carga/sync na seção 4 e 5 da análise.

## Conexão — porta 5432 bloqueada, use HTTP

Neste ambiente de execução a porta Postgres (5432) é bloqueada; só sai HTTPS.
Por isso os scripts usam o driver **`@neondatabase/serverless`** (SQL sobre HTTPS).
Como o `fetch` do Node não respeita `HTTPS_PROXY` sozinho, `src/lib/db.mjs`
instala um `ProxyAgent` global do `undici`. Fora deste ambiente (máquina local,
mesma região do Neon), um `psql`/`pg` normal sobre 5432 funciona igual.

## Uso

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL

# (re)aplicar o schema — idempotente
npm run db:apply

# query rápida
npm run db:query "select count(*) from produtos"
```

Obter a connection string via neonctl:

```bash
NEON_API_KEY=... npx neonctl connection-string production \
  --project-id sparkling-heart-63527951 --database-name neondb
```

## Estrutura

```
db/schema.sql        DDL canônico (idempotente)
scripts/apply-sql.mjs  aplica um .sql via HTTP
scripts/query.mjs      query ad-hoc via HTTP
src/lib/db.mjs         cliente Neon (HTTP + proxy)
src/connectors/        (próximo passo) conector Tiny: OAuth + carga/sync
```

## Próximos passos

1. **Conector Tiny** (`src/connectors/tiny/`): fluxo OAuth2 (persistir tokens em
   `sync_tokens`, refresh em ciclo), cliente HTTP com throttle (~1 req/s) e backoff
   em 429/5xx.
2. **Carga full** na ordem da seção 5.3: dimensões → contatos/produtos →
   transações → snapshots. Upsert por `(source, source_id)` com `ON CONFLICT`.
3. **Sync incremental** (seção 5.4): `dataAtualizacao`/`dataAlteracao` por recurso,
   guardando cursor em `sync_state`.
4. **Relatórios** (seção 5.5): vendas por canal/vendedor, fiscal por CFOP, aging
   financeiro, lead time logístico, cobertura de estoque.
