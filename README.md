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

## Conector Tiny (OAuth + carga/sync)

### 1. Autenticar (uma vez, interativo)

```bash
node scripts/tiny-auth.mjs url          # imprime a URL — faça login e autorize
node scripts/tiny-auth.mjs code <CODE>  # troca o ?code= do redirect por tokens
node scripts/tiny-auth.mjs status       # confere validade dos tokens
```

Os tokens ficam em `sync_tokens`; `getAccessToken()` renova sozinho via
`refresh_token` quando faltam <60s para expirar (o refresh token do Tiny expira
se não for usado — por isso o incremental deve rodar em ciclo).

### 2. Sincronizar

```bash
node scripts/tiny-sync.mjs full         # carga completa (ordem da seção 5.3)
node scripts/tiny-sync.mjs incremental  # dataAtualizacao/dataAlteracao + janelas
node scripts/tiny-sync.mjs pedidos      # um recurso só (debug)
```

Sugestão: `full` de madrugada, `incremental` a cada 15–60 min (cron).

**Como funciona:**
- **Cliente HTTP** (`client.mjs`): throttle global ~1 req/s (`SYNC_RATE_LIMIT`),
  backoff exponencial em 429/5xx (respeita `Retry-After`), paginação automática
  do envelope `{ itens, paginacao }`.
- **Padrão lista→detalhe:** a listagem descobre ids/mudanças; o `GET /recurso/{id}`
  é a fonte da verdade (upsert por `(source, source_id)`, `payload` cru guardado).
- **Cursor incremental** em `sync_state` por recurso; vínculo pedido↔conta a
  receber capturado na direção inversa (`GET /contas-receber?idVenda=`).
- **Estoque** é snapshot dos produtos com `estoque.controlar=true`.

## Estrutura

```
db/schema.sql              DDL canônico (idempotente)
scripts/apply-sql.mjs      aplica um .sql via HTTP
scripts/query.mjs          query ad-hoc via HTTP
scripts/tiny-auth.mjs      fluxo OAuth2 (url / code / refresh / status)
scripts/tiny-sync.mjs      runner de sync (full / incremental / <recurso>)
src/lib/db.mjs             cliente Neon (HTTP + proxy)
src/lib/upsert.mjs         upsert genérico + coerção de tipos
src/connectors/tiny/
  auth.mjs                 OAuth2 + persistência/refresh de tokens
  client.mjs               HTTP: throttle, backoff, paginação
  persisters.mjs           mapeia detalhe da API → tabelas (todos os recursos)
  sync.mjs                 orquestração das fases 1–4 + incremental
```

## Próximos passos

- **Relatórios** (seção 5.5): vendas por canal/vendedor, fiscal por CFOP, aging
  financeiro, lead time logístico, cobertura de estoque — como views SQL.
- **XML fiscal**: baixar/armazenar `GET /notas/{id}/xml` das notas ≥ emitida.
- **Agendamento**: cron/worker chamando `tiny-sync.mjs incremental` em ciclo.
