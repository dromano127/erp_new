# API Tiny/Olist ERP v3 — Análise completa de endpoints, campos e relacionamentos

> Fonte: especificação OpenAPI 3.0 oficial da API v3 (título "Olist ERP API v3", versão 3.1) + documentação de ajuda da Olist. Objetivo: mapear tudo que a API expõe para replicar os dados em um banco próprio (relatórios + backup).

---

## 1. Como a requisição é feita

### 1.1 Base e protocolo
- **Base URL:** `https://api.tiny.com.br/public-api/v3`
- 100% JSON, métodos HTTP padrão: `GET` (consultar), `POST` (incluir/ações), `PUT` (editar), `DELETE` (excluir).
- Header obrigatório em toda chamada: `Authorization: Bearer {access_token}` e `Content-Type: application/json` nos POST/PUT.

### 1.2 Autenticação (OAuth2 Authorization Code)
1. No ERP: **menu > configurações > geral > Aplicativos > + novo aplicativo** → gera `client_id` e `client_secret` e cadastra a **URL de redirecionamento**.
2. Fluxo OAuth2 (Keycloak da Tiny):
   - **Authorize:** `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope=openid`
   - Usuário loga e autoriza → você recebe `?code=...` no redirect.
   - **Token:** `POST https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token` (form-urlencoded) com `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`.
3. Resposta traz `access_token` (validade curta, ~4h) e `refresh_token` (~1 dia). Renovação: mesmo endpoint com `grant_type=refresh_token`.
4. **Importante para um sincronizador headless:** o refresh token expira se não for usado; renove-o em ciclo (ex.: a cada execução do job) e persista o par de tokens no banco/secret manager. Se expirar, é preciso refazer o fluxo interativo.
5. As permissões efetivas = permissões do **aplicativo** (módulos com leitura/edição/exclusão) ∩ permissões do **usuário** que autorizou. Erro `401` geralmente é usuário sem acesso ao módulo.

### 1.3 Paginação, ordenação e filtros
- Listagens usam **`limit`** e **`offset`** (query string) e retornam envelope paginado:

```json
{
  "itens": [ ... ],
  "paginacao": { "limit": 100, "offset": 0, "total": 3542 }
}
```

- `orderBy=asc|desc` na maioria das listagens.
- Filtros específicos por recurso (detalhados na seção 2). Os mais importantes para sincronização incremental: `dataAtualizacao` (pedidos, contatos), `dataAlteracao` (produtos), `dataInicial/dataFinal` (notas, expedição, ordens, contas).
- Datas no formato `YYYY-MM-DD` (algumas aceitam data e hora).

### 1.4 Limites (rate limit)
Por **conta** (compartilhado entre todos os aplicativos), por minuto:

| Plano | Total req/min | Escrita req/min |
|---|---|---|
| Básico / Crescer | 60 | 30 |
| Essencial / Evoluir | 120 | 60 |
| Grande / Potencializar | 240 | 100 |

Estourou → HTTP 429. Para sync: throttle de ~1 req/s é seguro em qualquer plano, com backoff exponencial em 429/5xx.

### 1.5 Erros
Formato padrão:

```json
{ "mensagem": "Ocorreram erros de validação",
  "detalhes": [ { "campo": "codigo", "mensagem": "O campo código é obrigatório" } ] }
```

Códigos: `400` validação, `401` sem permissão/token inválido, `404` não encontrado, `429` rate limit, `5xx` erro interno.

### 1.6 Padrão geral dos recursos
Quase todo módulo segue o mesmo desenho:
- `GET /recurso` → **listagem resumida paginada** (menos campos);
- `GET /recurso/{id}` → **detalhe completo** (é aqui que estão os campos ricos e os objetos aninhados);
- `POST /recurso` → criar; `PUT /recurso/{id}` → editar; sub-rotas de **ação** (`/situacao`, `/emitir`, `/baixar`, `/lancar-estoque`, `/lancar-contas`, `/gerar-nota-fiscal`...);
- Sub-recurso **`/marcadores`** (tags livres) presente em pedidos, notas, contas a pagar/receber, ordem de compra, ordem de serviço, CRM.

**Consequência prática:** para popular o banco você sempre faz *lista → percorre ids → busca detalhe*. A listagem serve para descobrir ids e detectar mudanças; o detalhe é a fonte da verdade dos campos.

---
## 2. Catálogo completo de endpoints (106 rotas)

Base: `https://api.tiny.com.br/public-api/v3` — todas as respostas em JSON, autenticação `Authorization: Bearer {access_token}`.


### 2.1 Dados da empresa

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/info` | Obter informações da conta da empresa | — | `ObterInfoContaModelResponse` |

### 2.2 Contatos

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/contatos` | Listar contatos | — | lista paginada de `ListagemContatoModelResponse` |
| POST | `/contatos` | Criar contato | `CriarContatoModelRequest` | `CriarContatoModelResponse` |
| GET | `/contatos/tipos` | Listar tipos de contatos | — | lista paginada de `ListarTiposDeContatosModelResponse` |
| GET | `/contatos/{idContato}` | Obter contato | — | `ObterContatoModelResponse` |
| PUT | `/contatos/{idContato}` | Atualizar contato | `AtualizarContatoModelRequest` | — |
| GET | `/contatos/{idContato}/pessoas` | Listar pessoas de contato | — | lista paginada de `ListagemContatosContatoModelResponse` |
| POST | `/contatos/{idContato}/pessoas` | Criar pessoa de contato | `CriarContatoContatoModelRequest` | `CriarContatoContatoModelResponse` |
| DELETE | `/contatos/{idContato}/pessoas/{idPessoa}` | Excluir pessoa de contato | — | — |
| GET | `/contatos/{idContato}/pessoas/{idPessoa}` | Obter pessoa de contato | — | `ObterContatoContatoModelResponse` |
| PUT | `/contatos/{idContato}/pessoas/{idPessoa}` | Atualizar pessoa de contato | `AtualizarContatoContatoModelRequest` | — |
| PUT | `/contatos/{idContato}/status-crm` | Atualizar status CRM do contato | `AtualizarContatoStatusCrmRequestModel` | — |

**Filtros de `GET /contatos`:** `nome`, `codigo`, `situacao` (B/A/I/E), `idVendedor`, `cpfCnpj`, `celular`, `dataCriacao`, `dataAtualizacao`, `orderBy` (asc/desc), `limit`, `offset`

**Filtros de `GET /contatos/tipos`:** `nome`, `limit`, `offset`

**Filtros de `GET /contatos/{idContato}/pessoas`:** `limit`, `offset`

### 2.3 Vendedores

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/vendedores` | Listar vendedores | — | lista paginada de `ListagemVendedoresModelResponse` |

**Filtros de `GET /vendedores`:** `nome`, `codigo`, `limit`, `offset`

### 2.4 Usuarios

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/usuarios` | Listar usuários | — | lista paginada de `UsuarioModelResponse` |

**Filtros de `GET /usuarios`:** `id`, `nome`, `tipo` (vendedor//contador), `limit`, `offset`

### 2.5 Produtos

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/produtos` | Listar produtos | — | lista paginada de `ListagemProdutosResponseModel` |
| POST | `/produtos` | Criar produto | `CriarProdutoRequestModel` | `CriarProdutoComVariacoesResponseModel` |
| GET | `/produtos/{idProduto}` | Obter produto | — | `ObterProdutoModelResponse` |
| PUT | `/produtos/{idProduto}` | Atualizar produto | `AtualizarProdutoRequestModel` | — |
| GET | `/produtos/{idProduto}/custos` | Listar custos do produto | — | lista paginada de `ListagemProdutoCustosResponseModel` |
| GET | `/produtos/{idProduto}/fabricado` | Obter produto fabricado | — | `ProducaoProdutoResponseModel` |
| PUT | `/produtos/{idProduto}/fabricado` | Atualizar produto fabricado | `ProducaoProdutoRequestModel` | — |
| GET | `/produtos/{idProduto}/kit` | Obter produto kit | — | lista paginada de `ProdutoKitResponseModel` |
| PUT | `/produtos/{idProduto}/kit` | Atualizar kit do produto | — | — |
| PUT | `/produtos/{idProduto}/preco` | Atualizar preço do produto | `AtualizarPrecoProdutoRequestModel` | `AtualizarPrecoProdutoResponseModel` |
| DELETE | `/produtos/{idProduto}/tags` | Excluir tags do produto | — | — |
| GET | `/produtos/{idProduto}/tags` | Obter tags do produto | — | `ObterTagsProdutoModelResponse` |
| POST | `/produtos/{idProduto}/tags` | Criar tags do produto | — | — |
| PUT | `/produtos/{idProduto}/tags` | Atualizar tags do produto | — | — |
| POST | `/produtos/{idProduto}/variacoes` | Criar variação do produto | `VariacaoProdutoRequestModel` | `CriarProdutoResponseModel` |
| DELETE | `/produtos/{idProduto}/variacoes/{idVariacao}` | Deletar variação do produto | — | — |
| PUT | `/produtos/{idProduto}/variacoes/{idVariacao}` | Atualizar variação do produto | `AtualizarProdutoVariacaoRequestModel` | — |

**Filtros de `GET /produtos`:** `nome`, `codigo`, `gtin`, `situacao` (A/I/E), `dataCriacao`, `dataAlteracao`, `idListaPreco`, `limit`, `offset`

**Filtros de `GET /produtos/{idProduto}/custos`:** `dataInicial`, `dataFinal`, `limit`, `offset`

### 2.6 Categorias

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/categorias/todas` | Listar árvore de categorias | — | `ListarArvoreCategoriasModelResponse` |

### 2.7 Marcas

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/marcas` | Listar marcas | — | lista paginada de `ListagemMarcasResponseModel` |
| POST | `/marcas` | Criar marca | `BaseMarcaModel` | `CriarMarcaModelResponse` |
| PUT | `/marcas/{idMarca}` | Atualizar marca | `BaseMarcaModel` | — |

**Filtros de `GET /marcas`:** `descricao`, `limit`, `offset`

### 2.8 Tags de Produtos

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/tags` | Listar tags de produtos | — | lista paginada de `ListagemTagsResponseModel` |
| POST | `/tags` | Criar tags de produtos | — | `CriarTagsResponseModel` |

**Filtros de `GET /tags`:** `pesquisa`, `idGrupo`, `limit`, `offset`

### 2.9 Grupos de Tags

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/grupos-tags` | Listar grupos de tags | — | lista paginada de `ListagemGruposTagsResponseModel` |

**Filtros de `GET /grupos-tags`:** `pesquisa`, `limit`, `offset`

### 2.10 Estoque

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/estoque/{idProduto}` | Obter o estoque de um produto | — | `ObterEstoqueProdutoModelResponse` |
| POST | `/estoque/{idProduto}` | Atualizar o estoque de um produto | `AtualizarProdutoEstoqueModelRequest` | `AtualizarProdutoEstoqueModelResponse` |

### 2.11 Lista de Preços

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/listas-precos` | Listar listas de preços | — | lista paginada de `ListagemListaDePrecosModelResponse` |
| POST | `/listas-precos` | Criar lista de preços | `CriarListaPrecoRequestModel` | `CriarListaPrecoResponseModel` |
| GET | `/listas-precos/{idListaDePreco}` | Obter lista de preços | — | `ObterListaDePrecosModelResponse` |
| PUT | `/listas-precos/{idListaDePreco}` | Atualizar lista de preços | `AtualizarListaPrecoRequestModel` | — |
| DELETE | `/listas-precos/{idListaDePreco}/produtos/{idProduto}` | Excluir produto de lista de preços | — | — |

**Filtros de `GET /listas-precos`:** `nome`, `limit`, `offset`

**Filtros de `GET /listas-precos/{idListaDePreco}`:** `idProduto`

### 2.12 Serviços

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/servicos` | Listar serviços | — | lista paginada de `ServicosModelResponse` |
| POST | `/servicos` | Criar serviço | `CriarServicoRequestModel` | `ServicoResponseModel` |
| GET | `/servicos/{idServico}` | Obter serviço | — | `ServicosModelResponse` |
| PUT | `/servicos/{idServico}` | Atualizar serviço | `AtualizarServicoRequestModel` | — |
| POST | `/servicos/{idServico}/transformar-produto` | Transformar serviço em produto | — | — |

**Filtros de `GET /servicos`:** `nome`, `codigo`, `situacao` (A/I/E), `orderBy` (asc/desc), `limit`, `offset`

### 2.13 Pedidos

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/pedidos` | Listar pedidos | — | lista paginada de `ListagemPedidoModelResponse` |
| POST | `/pedidos` | Criar pedido | `CriarPedidoModelRequest` | `CriarPedidoModelResponse` |
| GET | `/pedidos/{idPedido}` | Obter pedido | — | `ObterPedidoModelResponse` |
| PUT | `/pedidos/{idPedido}` | Atualizar pedido | `AtualizarPedidoModelRequest` | — |
| PUT | `/pedidos/{idPedido}/despacho` | Atualizar informações de rastreamento do pedido | `AtualizarInfoRastreamentoPedidoModelRequest` | — |
| POST | `/pedidos/{idPedido}/estornar-contas` | Estornar contas do pedido | — | — |
| POST | `/pedidos/{idPedido}/estornar-estoque` | Estornar estoque do pedido | — | — |
| POST | `/pedidos/{idPedido}/gerar-nota-fiscal` | Gerar nota fiscal do pedido | `GerarNotaFiscalPedidoRequestModel` | `GerarNotaFiscalPedidoModelResponse` |
| POST | `/pedidos/{idPedido}/gerar-ordem-producao` | Gerar ordem de produção do pedido | `GerarOrdemProducaoPedidoModelRequest` | `GerarOrdemProducaoPedidoModelResponse` |
| POST | `/pedidos/{idPedido}/lancar-contas` | Lançar contas do pedido | — | — |
| POST | `/pedidos/{idPedido}/lancar-estoque` | Lançar estoque do pedido | — | — |
| DELETE | `/pedidos/{idPedido}/marcadores` | Excluir marcadores do pedido | — | — |
| GET | `/pedidos/{idPedido}/marcadores` | Obter marcadores do pedido | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/pedidos/{idPedido}/marcadores` | Criar marcadores do pedido | — | — |
| PUT | `/pedidos/{idPedido}/marcadores` | Atualizar marcadores do pedido | — | — |
| PUT | `/pedidos/{idPedido}/situacao` | Atualizar situação do pedido | `AtualizarSituacaoPedidoModelRequest` | — |

**Filtros de `GET /pedidos`:** `numero`, `nomeCliente`, `codigoCliente`, `cpfCnpj`, `dataInicial`, `dataFinal`, `dataAtualizacao`, `situacao` (8/0/3/4/1/7/5/6/2/9), `numeroPedidoEcommerce`, `idVendedor`, `marcadores`, `origemPedido` (0/1), `orderBy` (asc/desc), `limit`, `offset`

### 2.14 Notas

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/notas` | Listar notas fiscais | — | lista paginada de `ListagemNotaFiscalModelResponse` |
| POST | `/notas/nota-fiscal-consumidor/xml` | Incluir nota fiscal de consumidor por XML | — | `IncluirXmlNotaFiscalResponseModel` |
| POST | `/notas/xml` | Incluir nota fiscal por XML | — | `IncluirXmlNotaFiscalResponseModel` |
| POST | `/notas/xml/cancelar` | Cancelar nota fiscal | — | `CancelarXmlNotaFiscalRequestModel` |
| GET | `/notas/{idNota}` | Obter nota fiscal | — | `ObterNotaFiscalModelResponse` |
| PUT | `/notas/{idNota}/despacho` | Atualizar informações de rastreamento da nota fiscal | `AtualizarInfoRastreamentoNotaFiscalModelRequest` | — |
| POST | `/notas/{idNota}/emitir` | Autorizar nota fiscal | `AutorizarNotaFiscalModelRequest` | `AutorizarNotaFiscalModelResponse` |
| GET | `/notas/{idNota}/itens/{idItem}` | Obter item da nota fiscal | — | `ObterItemNotaFiscalModelResponse` |
| POST | `/notas/{idNota}/lancar-contas` | Lançar contas da nota fiscal | — | — |
| POST | `/notas/{idNota}/lancar-estoque` | Lançar estoque da nota fiscal | — | — |
| GET | `/notas/{idNota}/link` | Obter link da nota fiscal | — | `ObterLinkNotaFiscalModelResponse` |
| DELETE | `/notas/{idNota}/marcadores` | Excluir marcadores da nota fiscal | — | — |
| GET | `/notas/{idNota}/marcadores` | Obter marcadores da nota fiscal | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/notas/{idNota}/marcadores` | Criar marcadores da nota fiscal | — | — |
| PUT | `/notas/{idNota}/marcadores` | Atualizar marcadores da nota fiscal | — | — |
| GET | `/notas/{idNota}/xml` | Obter XML da nota fiscal | — | `ObterXmlNotaFiscalModelResponse` |

**Filtros de `GET /notas`:** `tipo` (E/S), `numero`, `cpfCnpj`, `dataInicial`, `dataFinal`, `situacao` (1/2/3/4/5/6/7/8/9/10), `numeroPedidoEcommerce`, `idVendedor`, `idFormaEnvio`, `idVenda`, `marcadores`, `orderBy` (asc/desc), `limit`, `offset`

### 2.15 Ordem de Compra

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/ordem-compra` | Listar ordens de compra | — | lista paginada de `ListarOrdemCompraModelResponse` |
| POST | `/ordem-compra` | Criar ordem de compra | `CriarOrdemCompraModelRequest` | `CriarOrdemCompraModelResponse` |
| GET | `/ordem-compra/{idOrdemCompra}` | Obter ordem de compra | — | `ObterOrdemCompraModelResponse` |
| PUT | `/ordem-compra/{idOrdemCompra}` | Atualizar ordem de compra | `AtualizarOrdemCompraModelRequest` | — |
| POST | `/ordem-compra/{idOrdemCompra}/lancar-contas` | Lançar contas da ordem de compra | — | — |
| POST | `/ordem-compra/{idOrdemCompra}/lancar-estoque` | Lançar estoque da ordem de compra | `LancarEstoqueOrdemCompraRequestModel` | — |
| DELETE | `/ordem-compra/{idOrdemCompra}/marcadores` | Excluir marcadores da ordem de compra | — | — |
| GET | `/ordem-compra/{idOrdemCompra}/marcadores` | Obter marcadores da ordem de compra | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/ordem-compra/{idOrdemCompra}/marcadores` | Criar marcadores da ordem de compra | — | — |
| PUT | `/ordem-compra/{idOrdemCompra}/marcadores` | Atualizar marcadores da ordem de compra | — | — |
| PUT | `/ordem-compra/{idOrdemCompra}/situacao` | Atualizar situação da ordem de compra | `AtualizarSituacaoOrdemCompraRequestModel` | — |

**Filtros de `GET /ordem-compra`:** `numero`, `dataInicial`, `dataFinal`, `marcadores`, `nomeFornecedor`, `codigoFornecedor`, `situacao` (0/1/2/3), `orderBy` (asc/desc), `limit`, `offset`

### 2.16 Ordem de Serviço

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/ordem-servico` | Listar ordem de serviço | — | `ListagemOrdemServicoResponseModel` |
| POST | `/ordem-servico` | Criar ordem de serviço | `CriarOrdemServicoRequestModel` | `CriarOrdemServicoResponseModel` |
| GET | `/ordem-servico/{idOrdemServico}` | Obter ordem de serviço | — | `ObterOrdemServicoModelResponse` |
| PUT | `/ordem-servico/{idOrdemServico}` | Atualizar ordem de serviço | `AtualizarOrdemServicoRequestModel` | — |
| POST | `/ordem-servico/{idOrdemServico}/gerar-nota-fiscal` | Gerar nota fiscal para a ordem de serviço | — | `GerarNotaFiscalOrdemServicoModelResponse` |
| POST | `/ordem-servico/{idOrdemServico}/lancar-contas` | Lançar contas da ordem de serviço | — | — |
| POST | `/ordem-servico/{idOrdemServico}/lancar-estoque` | Lançar estoque da ordem de serviço | `LancarEstoqueOrdemServicoRequestModel` | — |
| DELETE | `/ordem-servico/{idOrdemServico}/marcadores` | Excluir marcadores da ordem de serviço | — | — |
| GET | `/ordem-servico/{idOrdemServico}/marcadores` | Obter marcadores da ordem de serviço | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/ordem-servico/{idOrdemServico}/marcadores` | Criar marcadores da ordem de serviço | — | — |
| PUT | `/ordem-servico/{idOrdemServico}/marcadores` | Atualizar marcadores da ordem de serviço | — | — |
| PUT | `/ordem-servico/{idOrdemServico}/situacao` | Atualizar situação da ordem de serviço | `AtualizarSituacaoOrdemServicoRequestModel` | — |

**Filtros de `GET /ordem-servico`:** `nomeCliente`, `situacao` (4/3/0/2/1/5/6/7), `dataInicialEmissao`, `dataFinalEmissao`, `numeroOrdemServico`, `marcadores`, `idContato`, `orderBy` (asc/desc), `limit`, `offset`

### 2.17 Separação

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/separacao` | Listar separações | — | lista paginada de `ListagemSeparacaoResponseModel` |
| GET | `/separacao/{idSeparacao}` | Obter separação | — | `ObterSeparacaoResponseModel` |
| PUT | `/separacao/{idSeparacao}/situacao` | Alterar situação da separação | `AlterarSituacaoSeparacaoModelRequest` | — |

**Filtros de `GET /separacao`:** `situacao` (1/2/3/4), `idFormaEnvio`, `dataInicial`, `dataFinal`, `orderBy` (asc/desc), `limit`, `offset`

### 2.18 Expedição

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/expedicao` | Listar agrupamentos de expedição | — | lista paginada de `ListagemAgrupamentosModel` |
| POST | `/expedicao` | Criar agrupamento de expedição | `CriarAgrupamentoRequestModel` | `CriarAgrupamentoResponseModel` |
| GET | `/expedicao/{idAgrupamento}` | Obter agrupamento de expedição | — | `ObterAgrupamentoResponseModel` |
| POST | `/expedicao/{idAgrupamento}/concluir` | Concluir um agrupamento de expedição | — | — |
| GET | `/expedicao/{idAgrupamento}/etiquetas` | Obter etiquetas de um agrupamento de expedição | — | `ObterEtiquetasResponseModel` |
| PUT | `/expedicao/{idAgrupamento}/expedicao/{idExpedicao}` | Alterar uma expedição dentro de um agrupamento | `ExpedicaoRequestModel` | — |
| GET | `/expedicao/{idAgrupamento}/expedicao/{idExpedicao}/etiquetas` | Obter etiquetas de uma expedição dentro de um agrupamento | — | `ObterEtiquetasResponseModel` |
| POST | `/expedicao/{idAgrupamento}/origens` | Adicionar origens a um agrupamento de expedição | `CriarAgrupamentoRequestModel` | — |

**Filtros de `GET /expedicao`:** `idFormaEnvio`, `dataInicial`, `dataFinal`, `orderBy` (asc/desc), `limit`, `offset`

### 2.19 Logistica

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/formas-envio` | Listar formas de envio | — | lista paginada de `ListagemFormasEnvioResponseModel` |
| GET | `/formas-envio/{idFormaEnvio}` | Obter forma de envio | — | `ObterFormaEnvioResponseModel` |

**Filtros de `GET /formas-envio`:** `nome`, `tipo` (0/1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/20/21/22/23/24/25/26/27/28/29/30/31), `situacao` (0/1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/20/21/22/23/24/25/26/27/28/29/30/31), `limit`, `offset`

### 2.20 Formas de pagamento

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/formas-pagamento` | Listar formas de pagamento | — | lista paginada de `ListagemFormasPagamentoResponseModel` |
| GET | `/formas-pagamento/{idFormaPagamento}` | Obter forma de pagamento | — | `ObterFormaPagamentoResponseModel` |

**Filtros de `GET /formas-pagamento`:** `nome`, `situacao` (1/2), `limit`, `offset`

### 2.21 Formas de recebimento

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/formas-recebimento` | Listar formas de recebimento | — | lista paginada de `ListagemFormasRecebimentoResponseModel` |
| GET | `/formas-recebimento/{idFormaRecebimento}` | Obter forma de recebimento | — | `ObterFormaRecebimentoResponseModel` |

**Filtros de `GET /formas-recebimento`:** `nome`, `situacao` (1/2), `limit`, `offset`

### 2.22 Intermediadores

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/intermediadores` | Listar intermediadores | — | lista paginada de `ListagemIntermediadoresResponseModel` |
| GET | `/intermediadores/{idIntermediador}` | Obter intermediador | — | `ObterIntermediadorResponseModel` |

**Filtros de `GET /intermediadores`:** `nome`, `cnpj`, `limit`, `offset`

### 2.23 Contas a receber

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/contas-receber` | Listar contas a receber | — | lista paginada de `ListagemContasReceberResponseModel` |
| POST | `/contas-receber` | Criar conta a receber | `CriarContaReceberRequestModel` | `CriarContaReceberResponseModel` |
| GET | `/contas-receber/{idContaReceber}` | Obter conta a receber | — | `ObterContaReceberResponseModel` |
| PUT | `/contas-receber/{idContaReceber}` | Atualizar conta a receber | `AtualizarContaReceberRequestModel` | — |
| POST | `/contas-receber/{idContaReceber}/baixar` | Baixar uma conta a receber | `BaixarContaReceberModelRequest` | — |
| DELETE | `/contas-receber/{idContaReceber}/marcadores` | Excluir marcadores da conta a receber | — | — |
| GET | `/contas-receber/{idContaReceber}/marcadores` | Obter marcadores da conta a receber | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/contas-receber/{idContaReceber}/marcadores` | Criar marcadores da conta a receber | — | — |
| PUT | `/contas-receber/{idContaReceber}/marcadores` | Atualizar marcadores da conta a receber | — | — |
| GET | `/contas-receber/{idContaReceber}/recebimentos` | Obter recebimentos da conta a receber | — | lista paginada de `ObterRecebimentosModel` |

**Filtros de `GET /contas-receber`:** `nomeCliente`, `situacao` (aberto/cancelada/pago/parcial/prevista/atrasadas/emissao), `dataInicialEmissao`, `dataFinalEmissao`, `dataInicialVencimento`, `dataFinalVencimento`, `numeroDocumento`, `numeroBanco`, `idNota`, `idVenda`, `marcadores`, `orderBy` (asc/desc), `limit`, `offset`

### 2.24 Contas a pagar

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/contas-pagar` | Listar contas a pagar | — | `ListagemContasPagarResponseModel` |
| POST | `/contas-pagar` | Criar conta a pagar | `CriarContaPagarRequestModel` | `CriarContaPagarResponseModel` |
| GET | `/contas-pagar/{idContaPagar}` | Obter conta a pagar | — | `ObterContaPagarModelResponse` |
| DELETE | `/contas-pagar/{idContaPagar}/marcadores` | Excluir marcadores da conta a pagar | — | — |
| GET | `/contas-pagar/{idContaPagar}/marcadores` | Obter marcadores da conta a pagar | — | lista paginada de `ObterMarcadorResponseModel` |
| POST | `/contas-pagar/{idContaPagar}/marcadores` | Criar marcadores da conta a pagar | — | — |
| PUT | `/contas-pagar/{idContaPagar}/marcadores` | Atualizar marcadores da conta a pagar | — | — |
| GET | `/contas-pagar/{idContaPagar}/recebimentos` | Obter recebimentos da conta a pagar | — | lista paginada de `ObterRecebimentosModel` |

**Filtros de `GET /contas-pagar`:** `nomeCliente`, `situacao` (aberto/cancelada/pago/parcial/prevista/atrasadas/emissao), `dataInicialEmissao`, `dataFinalEmissao`, `dataInicialVencimento`, `dataFinalVencimento`, `numeroDocumento`, `marcadores`, `idContato`, `orderBy` (asc/desc), `limit`, `offset`

### 2.25 Categorias de receita e despesa

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/categorias-receita-despesa` | Listar categorias de receita e despesa | — | lista paginada de `ListagemCategoriasReceitaDespesaResponseModel` |

**Filtros de `GET /categorias-receita-despesa`:** `descricao`, `grupo`, `orderBy` (asc/desc), `limit`, `offset`

### 2.26 CRM

| Método | Rota | Descrição | Body (request) | Retorno (schema) |
|---|---|---|---|---|
| GET | `/crm/assuntos` | Listar assuntos | — | lista paginada de `CrmAssuntoResponseModel` |
| POST | `/crm/assuntos` | Criar assunto | `CriarCrmAssuntoRequestModel` | `CriarCrmAssuntoResponseModel` |
| DELETE | `/crm/assuntos/{idAssunto}` | Deletar assunto | — | — |
| GET | `/crm/assuntos/{idAssunto}` | Obter assunto | — | `CrmAssuntoDetalheResponseModel` |
| PUT | `/crm/assuntos/{idAssunto}` | Atualizar assunto | `AtualizarCrmAssuntoRequestModel` | — |
| GET | `/crm/assuntos/{idAssunto}/acoes` | Listar ações de um assunto | — | lista paginada de `ListagemCrmAssuntoAcoesResponseModel` |
| POST | `/crm/assuntos/{idAssunto}/acoes` | Criar ação de assunto | `CriarCrmAssuntoAcaoRequestModel` | `CriarCrmAssuntoAcaoResponseModel` |
| DELETE | `/crm/assuntos/{idAssunto}/acoes/{idAcao}` | Deletar ação de um assunto | — | — |
| GET | `/crm/assuntos/{idAssunto}/acoes/{idAcao}` | Obter ação de um assunto | — | `ObterActionModelResponse` |
| PUT | `/crm/assuntos/{idAssunto}/acoes/{idAcao}` | Atualizar ação de assunto | `AtualizarCrmAssuntoAcaoRequestModel` | — |
| GET | `/crm/assuntos/{idAssunto}/anotacoes` | Listar anotações de um assunto | — | lista paginada de `CrmAnotacaoResponseModel` |
| POST | `/crm/assuntos/{idAssunto}/anotacoes` | Criar anotação de assunto | `CriarCrmAssuntoAnotacaoRequestModel` | `CriarCrmAssuntoAnotacaoResponseModel` |
| DELETE | `/crm/assuntos/{idAssunto}/anotacoes/{idAnotacao}` | Deletar anotação de assunto | — | — |
| PUT | `/crm/assuntos/{idAssunto}/anotacoes/{idAnotacao}` | Atualizar anotação de assunto | `AtualizarCrmAssuntoAnotacaoRequestModel` | — |
| PUT | `/crm/assuntos/{idAssunto}/arquivar` | Arquivar ou desarquivar assunto | `ArquivarCrmAssuntoRequestModel` | — |
| PUT | `/crm/assuntos/{idAssunto}/estrela` | Atualizar estrela do assunto | `AtualizarCrmAssuntoEstrelaRequestModel` | — |
| DELETE | `/crm/assuntos/{idAssunto}/marcadores` | Remover marcadores de um assunto | — | — |
| GET | `/crm/assuntos/{idAssunto}/marcadores` | Listar marcadores de um assunto | — | lista paginada de `MarcadorAssuntoResponseModel` |
| POST | `/crm/assuntos/{idAssunto}/marcadores` | Criar marcadores do assunto | — | — |
| PUT | `/crm/assuntos/{idAssunto}/marcadores` | Atualizar marcadores do assunto | — | — |
| GET | `/crm/estagios` | Listar estágios | — | lista paginada de `CrmEstagioResponseModel` |
| POST | `/crm/estagios` | Criar estágio | `CriarCrmEstagioRequestModel` | `CriarCrmEstagioResponseModel` |
| DELETE | `/crm/estagios/{idEstagio}` | Deletar estágio | — | — |
| GET | `/crm/estagios/{idEstagio}` | Obter estágio | — | `CrmEstagioResponseModel` |
| PUT | `/crm/estagios/{idEstagio}` | Atualizar estágio | `AtualizarCrmEstagioRequestModel` | — |

**Filtros de `GET /crm/assuntos`:** `situacao` (pendente/encerrado), `estrela`, `arquivado`, `idContato`, `idPessoaContato`, `nomeCliente`, `statusCrm` (L/P/C/I), `idEstagio`, `assunto`, `filtrarPor` (data-criacao/data-prevista/quanto-antes/esperar), `dataInicial`, `dataFinal`, `marcadores`, `descricaoAcao`, `idUsuario`, `idUsuarioResponsavel`, `limit`, `offset`

**Filtros de `GET /crm/assuntos/{idAssunto}/acoes`:** `idUsuario`, `idUsuarioResponsavel`, `dataInicial`, `dataFinal`, `acaoConcluida`, `dataConcluidaInicial`, `dataConcluidaFinal`, `tipoData` (D/Q/E/N), `limit`, `offset`

**Filtros de `GET /crm/assuntos/{idAssunto}/anotacoes`:** `dataInicial`, `dataFinal`, `idUsuario`, `orderBy` (asc/desc), `limit`, `offset`

**Filtros de `GET /crm/estagios`:** `descricao`, `limit`, `offset`
## 3. Dicionário de campos — schemas de detalhe (respostas GET por id)


### `ObterInfoContaModelResponse`

- `razaoSocial`: string
- `cpfCnpj`: string
- `fantasia`: string
- `enderecoEmpresa`: EnderecoModel
  - `endereco`: string
  - `numero`: string
  - `complemento`: string
  - `bairro`: string
  - `municipio`: string
  - `cep`: string
  - `uf`: string
  - `pais`: string
- `fone`: string
- `email`: string
- `inscricaoEstadual`: string
- `regimeTributario`: integer — - 1 - Simples Nacional · - 2 - Simples Nacional Excesso Receita · - 3 - Regime Normal · - 4 - Mei

### `ObterContatoModelResponse`

- `nome`: string
- `codigo`: string
- `fantasia`: string
- `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
- `cpfCnpj`: string
- `inscricaoEstadual`: string
- `rg`: string
- `telefone`: string
- `celular`: string
- `email`: string
- `endereco`: EnderecoModel
  - `endereco`: string
  - `numero`: string
  - `complemento`: string
  - `bairro`: string
  - `municipio`: string
  - `cep`: string
  - `uf`: string
  - `pais`: string
- `enderecoCobranca`: EnderecoModel
  - `endereco`: string
  - `numero`: string
  - `complemento`: string
  - `bairro`: string
  - `municipio`: string
  - `cep`: string
  - `uf`: string
  - `pais`: string
- `inscricaoMunicipal`: string
- `telefoneAdicional`: string
- `emailNfe`: string
- `site`: string
- `regimeTributario`: integer — - 1 - Simples Nacional · - 2 - Simples Nacional Excesso Receita · - 3 - Regime Normal · - 4 - Mei
- `estadoCivil`: integer — - 1 - Casado · - 2 - Solteiro · - 3 - Viuvo · - 4 - Separado · - 5 - Desquitado
- `profissao`: string
- `sexo`: string — - masculino - Masculino · - feminino - Feminino
- `dataNascimento`: string
- `naturalidade`: string
- `nomePai`: string
- `nomeMae`: string
- `cpfPai`: string
- `cpfMae`: string
- `limiteCredito`: number
- `situacao`: string — - B - Ativo · - A - Ativo Com Acesso Sistema · - I - Inativo · - E - Excluido
- `observacoes`: string
- `id`: integer
- `dataCriacao`: string
- `dataAtualizacao`: string
- `statusCrm`: string — - L - Lead · - P - Prospect · - C - Cliente · - I - Inativo
- `vendedor`: VendedorResponseModel
  - `id`: integer
  - `nome`: string
- `tipos`: array<TipoContatoModel>
  - `id`: integer
  - `descricao`: string
- `contatos`: array<PessoaContatoModel>
  - `nome`: string
  - `telefone`: string
  - `ramal`: string
  - `email`: string
  - `setor`: string
  - `id`: integer

### `ObterContatoContatoModelResponse`

- `nome`: string
- `telefone`: string
- `ramal`: string
- `email`: string
- `setor`: string
- `id`: integer
- `id`: integer

### `UsuarioModelResponse`

- `id`: integer
- `nome`: string
- `email`: string
- `emailComunicacao`: string
- `tipo`: string — Tipo/papel do usuário · - "vendedor" - Vendedor · - "" (vazio) - Usuário padrão · - "contador" - Contador

### `VendedorResponseModel`

- `id`: integer
- `nome`: string

### `ObterProdutoModelResponse`

- `id`: integer
- `sku`: string
- `descricao`: string
- `tipo`: string — - P - Produto · - S - Servico
- `descricaoComplementar`: string
- `tipo`: string — - K - Kit · - S - Simples · - V - Com Variacoes · - F - Fabricado · - M - Materia Prima
- `situacao`: string — - A - Ativo · - I - Inativo · - E - Excluido
- `produtoPai`: ProdutoResponseModel
  - `id`: integer
  - `sku`: string
  - `descricao`: string
  - `tipo`: string — - P - Produto · - S - Servico
- `unidade`: string
- `unidadePorCaixa`: string
- `ncm`: string
- `gtin`: string
- `origem`: string — - 0 - Nacional Exceto Codigo 3 A 5 · - 4 - Nacional Producao Conforme Ajustes · - 5 - Nacional Conteudo Importacao Inferior 40 · - 3 - Nacional Conteudo Importacao Superior 40 · - 8 - Nacional Conteudo Importacao Superior 70 · - 1 - Estrangeira Importacao Direta Exceto Codigo 6 · - 6 - Estrangeira Importacao Direta Sem Similar · - 2 - Estrangeira Adquirida Mercado Interno · - 7 - Estrangeira Adquirida Mercado Interno Sem Similar
- `garantia`: string
- `observacoes`: string
- `categoria`: CategoriaResponseModel
  - `id`: integer
  - `nome`: string
  - `caminhoCompleto`: string
- `marca`: MarcaResponseModel
  - `id`: integer
  - `nome`: string
- `dimensoes`: DimensoesProdutoResponseModel
  - `embalagem`: EmbalagemResponseModel
    - `id`: integer
    - `tipo`: integer — - 0 - Nao Definido · - 1 - Envelope · - 2 - Caixa · - 3 - Cilindro
    - `descricao`: string
  - `largura`: number
  - `altura`: number
  - `comprimento`: number
  - `diametro`: number
  - `pesoLiquido`: number
  - `pesoBruto`: number
  - `quantidadeVolumes`: integer
- `precos`: PrecoProdutoResponseModel
  - `preco`: number
  - `precoPromocional`: number
  - `precoCusto`: number
  - `precoCustoMedio`: number
- `estoque`: EstoqueProdutoResponseModel
  - `controlar`: boolean
  - `sobEncomenda`: boolean
  - `diasPreparacao`: integer
  - `localizacao`: string
  - `minimo`: number
  - `maximo`: number
  - `quantidade`: number
- `fornecedores`: array<FornecedorProdutoResponseModel>
  - `id`: integer
  - `nome`: string
  - `codigoProdutoNoFornecedor`: string
- `seo`: SeoProdutoModelResponse
  - `titulo`: string
  - `descricao`: string
  - `keywords`: array<string>
  - `linkVideo`: string
  - `slug`: string
- `tributacao`: TributacaoProdutoResponseModel
  - `gtinEmbalagem`: string
  - `valorIPIFixo`: number
  - `classeIPI`: string
- `anexos`: array<AnexoResponseModel>
  - `url`: string
  - `externo`: boolean
- `variacoes`: array<VariacaoProdutoResponseModel>
  - `id`: integer
  - `descricao`: string
  - `sku`: string
  - `gtin`: string
  - `precos`: PrecoProdutoResponseModel
    - `preco`: number
    - `precoPromocional`: number
    - `precoCusto`: number
    - `precoCustoMedio`: number
  - `estoque`: EstoqueProdutoResponseModel
    - `controlar`: boolean
    - `sobEncomenda`: boolean
    - `diasPreparacao`: integer
    - `localizacao`: string
    - `minimo`: number
    - `maximo`: number
    - `quantidade`: number
  - `grade`: array<GradeVariacaoRequestModel>
    - `chave`: string
    - `valor`: string
- `kit`: array<ProdutoKitResponseModel>
  - `produto`: ProdutoResponseModel
    - `id`: integer
    - `sku`: string
    - `descricao`: string
    - `tipo`: string — - P - Produto · - S - Servico
  - `quantidade`: number
- `producao`: ProducaoProdutoResponseModel
  - `produtos`: array<ProdutoFabricadoResponseModel>
    - `produto`: ProdutoResponseModel
      - `id`: integer
      - `sku`: string
      - `descricao`: string
      - `tipo`: string — - P - Produto · - S - Servico
    - `quantidade`: number
  - `etapas`: array<string>
- `codigoListaServicos`: string
- `tipoVariacao`: string — - N - Normal · - P - Pai · - V - Variacao

### `ProdutoFabricadoResponseModel`

- `produto`: ProdutoResponseModel
  - `id`: integer
  - `sku`: string
  - `descricao`: string
  - `tipo`: string — - P - Produto · - S - Servico
- `quantidade`: number

### `ProdutoKitResponseModel`

- `produto`: ProdutoResponseModel
  - `id`: integer
  - `sku`: string
  - `descricao`: string
  - `tipo`: string — - P - Produto · - S - Servico
- `quantidade`: number

### `ListarArvoreCategoriasModelResponse`

- `id`: integer  — Identificador da categoria
- `descricao`: string  — Nome da categoria
- `filhas`: array<ListarArvoreCategoriasModelResponse>  — Categorias filhas desta categoria
  - `id`: integer  — Identificador da categoria
  - `descricao`: string  — Nome da categoria
  - `filhas`: array<ListarArvoreCategoriasModelResponse>  — Categorias filhas desta categoria

### `CategoriaResponseModel`

- `id`: integer
- `nome`: string
- `caminhoCompleto`: string

### `MarcaResponseModel`

- `id`: integer
- `nome`: string

### `TagProdutoModelResponse`

- `id`: integer
- `nome`: string
- `idGrupoTag`: integer  — ID do grupo de tags
- `nomeGrupoTag`: string  — Nome do grupo de tags

### `BaseGrupoTagModel`

- `nome`: string

### `ObterEstoqueProdutoModelResponse`

- `id`: integer
- `nome`: string
- `codigo`: string
- `unidade`: string
- `saldo`: number
- `reservado`: number
- `disponivel`: number
- `localizacao`: string
- `depositos`: array<DepositoModel>
  - `id`: integer
  - `nome`: string
  - `desconsiderar`: boolean
  - `saldo`: number
  - `reservado`: number
  - `disponivel`: number
  - `empresa`: string

### `AtualizarProdutoEstoqueModelRequest`

- `deposito`: DepositoRequestModel
  - `id`: integer
- `tipo`: string — - B - Balanco · - E - Entrada · - S - Saida
- `data`: string
- `quantidade`: number
- `precoUnitario`: number
- `observacoes`: string

### `ObterListaDePrecosModelResponse`

- `id`: integer
- `descricao`: string
- `acrescimoDesconto`: number
- `excecoes`: ExcecaoListaPrecoModel
  - `idProduto`: integer
  - `codigo`: string
  - `preco`: number
  - `precoPromocional`: number

### `ServicoResponseModel`

- `id`: integer
- `codigo`: string
- `descricao`: string

### `ObterPedidoModelResponse`

- `id`: integer
- `numeroPedido`: integer
- `idNotaFiscal`: integer
- `dataFaturamento`: string
- `valorTotalProdutos`: number
- `valorTotalPedido`: number
- `listaPreco`: ListaPrecoResponseModel
  - `id`: integer
  - `nome`: string
  - `acrescimoDesconto`: number
- `cliente`: PedidoClienteModel
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `enderecoEntrega`: EnderecoEntregaModelResponse
  - `endereco`: string
  - `numero`: string
  - `complemento`: string
  - `bairro`: string
  - `municipio`: string
  - `cep`: string
  - `uf`: string
  - `pais`: string
  - `nomeDestinatario`: string
  - `cpfCnpj`: string
  - `tipoPessoa`: string
  - `telefone`: string
  - `inscricaoEstadual`: string
- `ecommerce`: EcommerceResponseModel
  - `id`: integer
  - `nome`: string
  - `numeroPedidoEcommerce`: string
  - `numeroPedidoCanalVenda`: string
  - `canalVenda`: string
- `transportador`: TransportadorResponseModel
  - `id`: integer
  - `nome`: string
  - `fretePorConta`: string — - R - Remetente · - D - Destinatario · - T - Terceiros · - 3 - Proprio Remetente · - 4 - Proprio Destinatario · - S - Sem Transporte
  - `formaEnvio`: FormaEnvioResponseModel
    - `id`: integer
    - `nome`: string
  - `formaFrete`: FormaFreteResponseModel
    - `id`: integer
    - `nome`: string
  - `codigoRastreamento`: string
  - `urlRastreamento`: string
- `deposito`: DepositoResponseModel
  - `id`: integer
  - `nome`: string
- `vendedor`: VendedorResponseModel
  - `id`: integer
  - `nome`: string
- `naturezaOperacao`: NaturezaOperacaoResponseModel
  - `id`: integer
  - `nome`: string
- `intermediador`: IntermediadorResponseModel
  - `id`: integer
  - `nome`: string
  - `cnpj`: string
  - `cnpjPagamentoInstituicao`: string
- `pagamento`: PagamentoResponseModel
  - `formaRecebimento`: FormaRecebimentoResponseModel
    - `id`: integer
    - `nome`: string
  - `meioPagamento`: MeioPagamentoResponseModel
    - `id`: integer
    - `nome`: string
  - `condicaoPagamento`: string
  - `parcelas`: array<ParcelaModelResponse>
    - `dias`: integer
    - `data`: string
    - `valor`: number
    - `observacoes`: string
    - `formaRecebimento`: FormaRecebimentoResponseModel
      - `id`: integer
      - `nome`: string
    - `meioPagamento`: MeioPagamentoResponseModel
      - `id`: integer
      - `nome`: string
- `itens`: array<ItemPedidoResponseModel>
  - `produto`: ProdutoResponseModel
    - `id`: integer
    - `sku`: string
    - `descricao`: string
    - `tipo`: string — - P - Produto · - S - Servico
  - `quantidade`: number
  - `valorUnitario`: number
  - `infoAdicional`: string
- `pagamentosIntegrados`: array<PagamentoIntegradoModelResponse>
  - `valor`: number  — Valor do pagamento
  - `tipoPagamento`: integer  — Tipo de pagamento
  - `cnpjIntermediador`: string  — CNPJ do intermediador
  - `codigoAutorizacao`: string  — Código de autorização
  - `codigoBandeira`: integer  — Código da bandeira
- `situacao`: integer — - 8 - Dados Incompletos · - 0 - Aberta · - 3 - Aprovada · - 4 - Preparando Envio · - 1 - Faturada · - 7 - Pronto Envio · - 5 - Enviada · - 6 - Entregue · - 2 - Cancelada · - 9 - Nao Entregue
- `data`: string
- `dataEntrega`: string
- `numeroOrdemCompra`: string
- `valorDesconto`: number
- `valorFrete`: number
- `valorOutrasDespesas`: number
- `dataPrevista`: string
- `dataEnvio`: string
- `observacoes`: string
- `observacoesInternas`: string
- `origemPedido`: integer  — Origem do pedido (0 = Pedido de Venda, 1 = PDV)

### `ListagemPedidoModelResponse`

- `id`: integer
- `situacao`: integer
- `numeroPedido`: integer
- `ecommerce`: EcommerceResponseModel
  - `id`: integer
  - `nome`: string
  - `numeroPedidoEcommerce`: string
  - `numeroPedidoCanalVenda`: string
  - `canalVenda`: string
- `dataCriacao`: string
- `dataPrevista`: string
- `cliente`: PedidoClienteModel
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `valor`: string
- `vendedor`: VendedorResponseModel
  - `id`: integer
  - `nome`: string
- `transportador`: TransportadorResponseModel
  - `id`: integer
  - `nome`: string
  - `fretePorConta`: string — - R - Remetente · - D - Destinatario · - T - Terceiros · - 3 - Proprio Remetente · - 4 - Proprio Destinatario · - S - Sem Transporte
  - `formaEnvio`: FormaEnvioResponseModel
    - `id`: integer
    - `nome`: string
  - `formaFrete`: FormaFreteResponseModel
    - `id`: integer
    - `nome`: string
  - `codigoRastreamento`: string
  - `urlRastreamento`: string
- `origemPedido`: integer — - 0 - Pedido Venda · - 1 - Pdv

### `ObterNotaFiscalModelResponse`

- `situacao`: string — - 1 - Pendente · - 2 - Emitida · - 3 - Cancelada · - 4 - Enviada Aguardando Recibo · - 5 - Rejeitada · - 6 - Autorizada · - 7 - Emitida Danfe · - 8 - Registrada · - 9 - Enviada Aguardando Protocolo · - 10 - Denegada
- `tipo`: string — - E - Entrada · - S - Saida
- `numero`: string
- `serie`: string
- `chaveAcesso`: string
- `dataEmissao`: string
- `cliente`: NotaFiscalClienteModel
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `enderecoEntrega`: EnderecoEntregaModelResponse
  - `endereco`: string
  - `numero`: string
  - `complemento`: string
  - `bairro`: string
  - `municipio`: string
  - `cep`: string
  - `uf`: string
  - `pais`: string
  - `nomeDestinatario`: string
  - `cpfCnpj`: string
  - `tipoPessoa`: string
  - `telefone`: string
  - `inscricaoEstadual`: string
- `valor`: number
- `valorProdutos`: number
- `valorFrete`: number
- `vendedor`: VendedorResponseModel
  - `id`: integer
  - `nome`: string
- `idFormaEnvio`: integer
- `idFormaFrete`: integer
- `codigoRastreamento`: string
- `urlRastreamento`: string
- `fretePorConta`: string
- `qtdVolumes`: integer
- `pesoBruto`: number
- `pesoLiquido`: number
- `id`: integer
- `finalidade`: string — - 1 - Nfe Normal · - 2 - Nfe Complementar · - 3 - Nfe Ajuste · - 4 - Devolucao Retorno · - 5 - Credito · - 6 - Debito · - 7 - Nfe Cupom Referenciado · - 8 - Devolucao Retorno Sem Nfe · - 9 - Nfe Chave Acesso Referenciada
- `regimeTributario`: integer — - 1 - Simples Nacional · - 2 - Simples Nacional Excesso Receita · - 3 - Regime Normal · - 4 - Mei
- `dataInclusao`: string
- `baseIcms`: number
- `valorIcms`: number
- `baseIcmsSt`: number
- `valorIcmsSt`: number
- `valorServicos`: number
- `valorFrete`: number
- `valorSeguro`: number
- `valorOutras`: number
- `valorIpi`: number
- `valorIssqn`: number
- `valorDesconto`: number
- `valorFaturado`: number
- `idIntermediador`: integer
- `idNaturezaOperacao`: integer
- `idFormaPagamento`: integer
- `idMeioPagamento`: integer
- `observacoes`: string
- `condicaoPagamento`: string
- `valorNotaComImpostos`: number
- `valorBaseDiferimento`: number
- `percentualICMSPartilhaDestino`: number
- `valorTotalICMSFCPDestino`: number
- `valorIPIDevolvido`: number
- `tipoNotaCredito`: string
- `tipoNotaDebito`: string
- `valorTotalBCIBSCBS`: number
- `valorTotalIBSUF`: number
- `valorTotalCBS`: number
- `itens`: array<NotaFiscalItemModelResponse>
  - `idItem`: integer
  - `idProduto`: integer
  - `codigo`: string
  - `ncm`: string
  - `descricao`: string
  - `unidade`: string
  - `quantidade`: number
  - `valorUnitario`: number
  - `valorTotal`: number
  - `cfop`: string
  - `naturezaOperacao`: string
- `parcelas`: array<NotaFiscalParcelaModelResponse>
  - `dias`: integer
  - `data`: string
  - `valor`: number
  - `observacoes`: string
  - `idFormaPagamento`: string
  - `idMeioPagamento`: string
- `pagamentosIntegrados`: array<NotaFiscalPagamentoIntegradoModelResponse>
  - `valor`: number  — Valor do pagamento
  - `tipoPagamento`: integer  — Tipo de pagamento
  - `cnpjIntermediador`: string  — CNPJ do intermediador
  - `codigoAutorizacao`: string  — Código de autorização
  - `codigoBandeira`: integer  — Código da bandeira
- `ecommerce`: EcommerceResponseModel
  - `id`: integer
  - `nome`: string
  - `numeroPedidoEcommerce`: string
  - `numeroPedidoCanalVenda`: string
  - `canalVenda`: string
- `marcadores`: array<NotaFiscalMarcadorModelResponse>
  - `descricao`: string
  - `cor`: string
- `transportador`: NotaFiscalTransportadorModelResponse
  - `nome`: string
  - `cpfCnpj`: string
  - `ie`: string
  - `endereco`: string
  - `municipio`: string
  - `uf`: string
- `origem`: NotaFiscalOrigemModelResponse
  - `id`: string
  - `tipo`: string — - pedido_compra - Pedido Compra · - venda - Venda · - notafiscal - Nota Fiscal · - ordemservico - Ordem Servico · - cobranca - Cobranca · - devolucao - Devolucao

### `ObterItemNotaFiscalModelResponse`

- `id`: integer
- `idProduto`: integer
- `codigo`: string
- `ncm`: string
- `descricao`: string
- `unidade`: string
- `quantidade`: number
- `valorUnitario`: number
- `valorTotal`: number
- `valorFrete`: number
- `valorTotalComImpostos`: number
- `cfop`: string
- `naturezaOperacao`: string
- `origem`: string
- `gtin`: string
- `gtinEmbalagem`: string
- `tipo`: string — - P - Produto · - S - Servico
- `numeroPedidoCompra`: string
- `numeroItemPedidoCompra`: integer
- `pesoLiq`: number
- `pesoBruto`: number
- `infoAdicional`: string
- `obs`: string
- `pis`: NotaFiscalItemPisModelResponse
  - `valorImposto`: number
- `icms`: NotaFiscalItemIcmsModelResponse
  - `valorImposto`: number
- `cofins`: NotaFiscalItemCofinsModelResponse
  - `valorImposto`: number
- `simples`: NotaFiscalItemSimplesModelResponse
  - `valorImposto`: number
- `ipi`: NotaFiscalItemIpiModelResponse
  - `valorImposto`: number
- `ibsCbsIs`: NotaFiscalItemIbsCbsIsModelResponse
  - `cstIbsCbs`: string
  - `cClassTribIbsCbs`: string
  - `valorImpostoCbs`: number
  - `valorImpostoIbsUf`: number

### `ObterOrdemCompraModelResponse`

- `id`: integer
- `numeroPedido`: string
- `data`: string
- `situacao`: string — - 0 - Em Aberto · - 1 - Atendido · - 2 - Cancelado · - 3 - Em Andamento
- `desconto`: string
- `frete`: number
- `totalProdutos`: number
- `totalPedidoCompra`: number
- `dataPrevista`: string
- `itens`: array<OrdemCompraItemModelResponse>
  - `produto`: ProdutoResponseModel
    - `id`: integer
    - `sku`: string
    - `descricao`: string
    - `tipo`: string — - P - Produto · - S - Servico
  - `gtin`: string
  - `quantidade`: number
  - `preco`: number
  - `ipi`: number
- `contato`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `categoria`: CategoriaResponseModel
  - `id`: integer
  - `nome`: string
  - `caminhoCompleto`: string
- `notaFiscal`: OrdemCompraNotaFiscalModelResponse
  - `id`: integer
  - `numero`: string
  - `dataEmissao`: string
  - `valor`: string
  - `natureza`: string
- `parcelas`: array<OrdemCompraParcelaModelResponse>
  - `id`: integer
  - `numero`: integer
  - `dias`: integer
  - `dataVencimento`: string
  - `valor`: number
  - `contaContabil`: ContaContabilModel
    - `id`: integer
  - `meioPagamento`: string — - 1 - Dinheiro · - 2 - Cheque · - 3 - Cartao Credito · - 4 - Cartao Debito · - 5 - Credito Loja · - 10 - Vale Alimentacao · - 11 - Vale Refeicao · - 12 - Vale Presente · - 13 - Vale Combustivel · - 14 - Duplicata Mercantil · - 15 - Boleto · - 16 - Deposito Bancario · - 17 - Pix · - 18 - Transferencia Bancaria Carteira Digital · - 19 - Fidelidade Cashback Credito Virtual · - 20 - Pix Estatico · - 90 - Sem Pagamento · - 99 - Outros
  - `observacoes`: string
- `fretePorConta`: string — - R - Remetente · - D - Destinatario · - T - Terceiros · - 3 - Proprio Remetente · - 4 - Proprio Destinatario · - S - Sem Transporte
- `observacoes`: string
- `observacoesInternas`: string
- `pvFrete`: number

### `ObterOrdemServicoModelResponse`

- `id`: integer
- `situacao`: string — - 4 - Nao Aprovada · - 3 - Finalizada · - 0 - Em Aberto · - 2 - Serv Concluido · - 1 - Orcada · - 5 - Aprovada · - 6 - Em Andamento · - 7 - Cancelada
- `data`: string
- `dataPrevista`: string
- `totalServicos`: string
- `totalOrdemServico`: string
- `totalPecas`: string
- `numeroOrdemServico`: string
- `equipamento`: string
- `equipamentoSerie`: string
- `descricaoProblema`: string
- `observacoes`: string
- `orcar`: boolean
- `orcado`: boolean
- `observacoesServico`: string
- `observacoesInternas`: string
- `alqComissao`: number
- `vlrComissao`: integer
- `idForma`: integer
- `idContaContabil`: integer
- `desconto`: string
- `idListaPreco`: integer
- `idLocalPrestacao`: string
- `idDeposito`: integer
- `dataConclusao`: string
- `vendedor`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `contato`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `tecnico`: string
- `categoria`: CategoriaReceitaDespesaResponseModel
  - `id`: integer
  - `descricao`: string
- `formaRecebimento`: FormaRecebimentoResponseModel
  - `id`: integer
  - `nome`: string

### `ObterSeparacaoResponseModel`

- `id`: integer
- `situacao`: integer — - 1 - Sit Aguardando Separacao · - 2 - Sit Separada · - 3 - Sit Embalada · - 4 - Sit Em Separacao
- `situacaoCheckout`: integer — - 1 - Sit Checkout Disponivel · - 2 - Sit Checkout Bloqueado
- `idUsuarioEmbalador`: integer
- `formaFrete`: string
- `objOrigem`: string
- `situacaoOrigem`: integer
- `dataCriacao`: string
- `dataSeparacao`: string
- `dataCheckout`: string
- `cliente`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `venda`: SeparacaoVendaResponseModel
  - `id`: integer
  - `numero`: integer
  - `data`: string
  - `situacao`: integer — - 8 - Dados Incompletos · - 0 - Aberta · - 3 - Aprovada · - 4 - Preparando Envio · - 1 - Faturada · - 7 - Pronto Envio · - 5 - Enviada · - 6 - Entregue · - 2 - Cancelada · - 9 - Nao Entregue
- `notaFiscal`: SeparacaoNotaResponseModel
  - `id`: integer
  - `numero`: integer
  - `dataEmissao`: string
  - `situacao`: integer — - 1 - Pendente · - 2 - Emitida · - 3 - Cancelada · - 4 - Enviada Aguardando Recibo · - 5 - Rejeitada · - 6 - Autorizada · - 7 - Emitida Danfe · - 8 - Registrada · - 9 - Enviada Aguardando Protocolo · - 10 - Denegada
- `itens`: array<ItemSeparacaoResponseModel>
  - `produto`: ProdutoResponseModel
    - `id`: integer
    - `sku`: string
    - `descricao`: string
    - `tipo`: string — - P - Produto · - S - Servico
  - `quantidade`: number
  - `unidade`: string
  - `localizacao`: string
  - `infoAdicional`: string
- `ecommerce`: EcommerceResponseModel
  - `id`: integer
  - `nome`: string
  - `numeroPedidoEcommerce`: string
  - `numeroPedidoCanalVenda`: string
  - `canalVenda`: string
- `formaEnvio`: FormaEnvioResponseModel
  - `id`: integer
  - `nome`: string
- `volumes`: string

### `ObterAgrupamentoResponseModel`

- `id`: integer
- `identificacao`: string
- `data`: string
- `formaEnvio`: FormaEnvioResponseModel
  - `id`: integer
  - `nome`: string
- `expedicoes`: array<ExpedicaoResponseModel>
  - `id`: integer
  - `data`: string
  - `situacao`: string
  - `tipoObjeto`: string
  - `idObjeto`: integer
  - `dataEmissao`: string
  - `venda`: ExpedicaoVendaResponseModel
    - `id`: integer
    - `numero`: integer
    - `data`: string
    - `situacao`: integer — - 8 - Dados Incompletos · - 0 - Aberta · - 3 - Aprovada · - 4 - Preparando Envio · - 1 - Faturada · - 7 - Pronto Envio · - 5 - Enviada · - 6 - Entregue · - 2 - Cancelada · - 9 - Nao Entregue
  - `notaFiscal`: ExpedicaoNotaResponseModel
    - `id`: integer
    - `numero`: integer
    - `data`: string
    - `situacao`: integer — - 1 - Pendente · - 2 - Emitida · - 3 - Cancelada · - 4 - Enviada Aguardando Recibo · - 5 - Rejeitada · - 6 - Autorizada · - 7 - Emitida Danfe · - 8 - Registrada · - 9 - Enviada Aguardando Protocolo · - 10 - Denegada
  - `destinatario`: ContatoModelResponse
    - `nome`: string
    - `codigo`: string
    - `fantasia`: string
    - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
    - `cpfCnpj`: string
    - `inscricaoEstadual`: string
    - `rg`: string
    - `telefone`: string
    - `celular`: string
    - `email`: string
    - `endereco`: EnderecoModel
      - `endereco`: string
      - `numero`: string
      - `complemento`: string
      - `bairro`: string
      - `municipio`: string
      - `cep`: string
      - `uf`: string
      - `pais`: string
    - `id`: integer
  - `volume`: VolumeExpedicaoResponseModel
    - `embalagem`: EmbalagemResponseModel
      - `id`: integer
      - `tipo`: integer — - 0 - Nao Definido · - 1 - Envelope · - 2 - Caixa · - 3 - Cilindro
      - `descricao`: string
    - `largura`: number
    - `altura`: number
    - `comprimento`: number
    - `diametro`: number
    - `pesoBruto`: number
    - `quantidadeVolumes`: integer
  - `logistica`: LogisticaExpedicaoResponseModel
    - `codigoRastreio`: string
    - `urlRastreio`: string
    - `possuiValorDeclarado`: boolean
    - `valorDeclarado`: number
    - `possuiAvisoRecebimento`: boolean
    - `formaFrete`: FormaFreteResponseModel
      - `id`: integer
      - `nome`: string
    - `transportador`: TransportadorExpedicaoResponseModel
      - `id`: integer
      - `nome`: string

### `ObterFormaPagamentoResponseModel`

- `id`: integer
- `nome`: string
- `situacao`: string — - 1 - Habilitada · - 2 - Desabilitada

### `ObterFormaRecebimentoResponseModel`

- `id`: integer
- `nome`: string
- `situacao`: string — - 1 - Habilitada · - 2 - Desabilitada

### `ObterFormaEnvioResponseModel`

- `nome`: string
- `tipo`: string — - 0 - Sem Frete · - 1 - Correios · - 2 - Transportadora · - 3 - Mercado Envios · - 4 - B2w Entrega · - 5 - Correios Ff · - 6 - Customizado · - 7 - Jadlog · - 8 - Totalexpress · - 9 - Olist · - 10 - Gateway · - 11 - Magalu Entregas · - 12 - Shopee Envios · - 13 - Ns Entregas · - 14 - Viavarejo Envvias · - 15 - Madeira Envios · - 16 - Ali Envios · - 17 - Loggi · - 18 - Conecta La Etiquetas · - 19 - Amazon Dba · - 20 - Magalu Fulfillment · - 21 - Ns Magalu Entregas · - 22 - Shein Envios · - 23 - Mandae · - 24 - Olist Envios · - 25 - Kwai Envios · - 26 - Beleza Envios · - 27 - Tiktok Envios · - 28 - Hub Envios · - 29 - Forma Teste · - 30 - Posta Ja · - 31 - Temu Envios
- `situacao`: string — - 1 - Habilitada · - 2 - Desabilitada
- `id`: integer
- `gatewayLogistico`: GatewayLogisticoResponseModel
  - `id`: integer
  - `nome`: string
- `formasFrete`: array<FormaFreteModel>
  - `id`: integer
  - `nome`: string
  - `codigo`: string
  - `codigoExterno`: string
  - `tipoEntrega`: string — - 0 - Nao Definida · - 1 - Normal · - 2 - Expressa · - 3 - Agendada · - 4 - Economica · - 5 - Super Expressa · - 6 - Retirada

### `ObterIntermediadorResponseModel`

- `id`: integer
- `nome`: string
- `cnpj`: string
- `canalVenda`: string

### `ObterContaReceberResponseModel`

- `id`: integer
- `situacao`: string — - aberto - Aberto · - cancelada - Cancelada · - pago - Pago · - parcial - Parcial · - prevista - Prevista · - atrasadas - Atrasadas · - emissao - Emissao
- `data`: string
- `dataVencimento`: string
- `dataCompetencia`: string
- `dataLiquidacao`: string
- `diaVencimento`: integer
- `diaSemanaVencimento`: integer — - 0 - Domingo · - 1 - Segunda · - 2 - Terca · - 3 - Quarta · - 4 - Quinta · - 5 - Sexta · - 6 - Sabado
- `numeroDocumento`: string
- `serieDocumento`: string
- `numeroBanco`: string
- `ocorrencia`: string — - U - Unica · - W - Semanal · - Q - Quinzenal · - M - Mensal · - T - Trimestral · - S - Semestral · - A - Anual · - P - Parcelada
- `quantidadeParcelas`: integer
- `valor`: number
- `saldo`: number
- `taxa`: number
- `juros`: number
- `multa`: number
- `valorPago`: number
- `cliente`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `categoria`: CategoriaReceitaDespesaResponseModel
  - `id`: integer
  - `descricao`: string
- `formaRecebimento`: FormaRecebimentoResponseModel
  - `id`: integer
  - `nome`: string
- `historico`: string
- `linkBoleto`: string
- `quantidadeParcelasAntecipadas`: integer

### `ObterContaPagarModelResponse`

- `id`: integer
- `situacao`: string — - aberto - Aberto · - cancelada - Cancelada · - pago - Pago · - parcial - Parcial · - prevista - Prevista · - atrasadas - Atrasadas · - emissao - Emissao
- `data`: string
- `dataVencimento`: string
- `dataCompetencia`: string
- `dataLiquidacao`: string
- `diaVencimento`: integer
- `diaSemanaVencimento`: integer — - 0 - Domingo · - 1 - Segunda · - 2 - Terca · - 3 - Quarta · - 4 - Quinta · - 5 - Sexta · - 6 - Sabado
- `numeroDocumento`: string
- `serieDocumento`: string
- `ocorrencia`: string — - U - Unica · - W - Semanal · - Q - Quinzenal · - M - Mensal · - T - Trimestral · - S - Semestral · - A - Anual · - P - Parcelada
- `quantidadeParcelas`: integer
- `valor`: number
- `saldo`: number
- `valorPago`: number
- `multa`: number
- `juros`: number
- `contato`: ContatoModelResponse
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `id`: integer
- `categoria`: CategoriaReceitaDespesaResponseModel
  - `id`: integer
  - `descricao`: string
- `formaPagamento`: FormaPagamentoResponseModel
  - `id`: integer
  - `nome`: string
- `historico`: string
- `marcadores`: object

### `ObterRecebimentosModel`

- `id`: integer
- `data`: string
- `idConta`: string
- `valorPago`: number
- `valorTaxa`: number
- `valorJuro`: number
- `valorDesconto`: number
- `valorAcrescimo`: number
- `tipo`: integer

### `CategoriaReceitaDespesaResponseModel`

- `id`: integer
- `descricao`: string

### `CrmAssuntoDetalheResponseModel`

- `id`: integer
- `assunto`: string
- `cliente`: CrmClienteResumoModel
  - `id`: integer
  - `nome`: string
  - `codigo`: string
  - `fantasia`: string
  - `tipoPessoa`: string — - J - Juridica · - F - Fisica · - E - Estrangeiro · - X - Estrangeiro No Brasil
  - `cpfCnpj`: string
  - `inscricaoEstadual`: string
  - `rg`: string
  - `telefone`: string
  - `celular`: string
  - `email`: string
  - `pessoaContato`: CrmPessoaContatoModel
    - `nome`: string
    - `telefone`: string
    - `email`: string
    - `ramal`: string
    - `departamento`: string
  - `endereco`: EnderecoModel
    - `endereco`: string
    - `numero`: string
    - `complemento`: string
    - `bairro`: string
    - `municipio`: string
    - `cep`: string
    - `uf`: string
    - `pais`: string
  - `statusCrm`: string — - L - Lead · - P - Prospect · - C - Cliente · - I - Inativo
- `estagio`: CrmAssuntoEstagioResponseModel
  - `id`: integer
  - `descricao`: string
- `estrela`: boolean
- `arquivado`: boolean
- `data`: string
- `dataAtualizacao`: string
- `acoesRecentes`: CrmAcoesListResponseModel
  - `limit`: integer
  - `total`: integer
  - `itens`: array<ListagemCrmAssuntoAcoesResponseModel>
    - `id`: integer
    - `descricao`: string
    - `dataCriacao`: string
    - `tipoData`: string — - D - Data · - Q - Quanto Antes · - E - Esperar · - N - Sem Data
    - `data`: string
    - `idUsuario`: CrmUsuarioResumoModel
      - `id`: integer
      - `nome`: string
    - `idUsuarioResponsavel`: CrmUsuarioResumoModel
      - `id`: integer
      - `nome`: string
    - `acaoConcluida`: boolean  — Indica se a ação foi concluída
    - `dataConcluida`: string
- `anotacoesRecentes`: CrmAnotacoesListResponseModel
  - `limit`: integer
  - `total`: integer
  - `itens`: array<CrmAnotacaoResponseModel>
    - `id`: integer
    - `data`: string
    - `anotacao`: string
    - `usuario`: CrmUsuarioResumoModel
      - `id`: integer
      - `nome`: string

### `CrmEstagioResponseModel`

- `id`: integer
- `descricao`: string
- `ordem`: integer

### `ObterMarcadorResponseModel`

- `descricao`: string

---

## 4. A teia de relacionamentos entre os endpoints

A API não devolve "foreign keys" formais, mas **todo objeto aninhado com `id` é um vínculo** para outro recurso que possui endpoint próprio. Abaixo, o mapa completo de quem aponta para quem.

### 4.1 Núcleo: Contato é o hub de pessoas

`GET /contatos/{id}` é a entidade central de pessoas. Todos estes recursos apontam para ela:

| Recurso | Campo que vincula | Observação |
|---|---|---|
| Pedido | `cliente.id` | cliente do pedido |
| Nota Fiscal | `cliente.id` | destinatário/emitente |
| Conta a Receber | `cliente.id` | sacado |
| Conta a Pagar | `contato.id` | fornecedor/credor |
| Ordem de Compra | `contato.id` | fornecedor |
| Ordem de Serviço | `contato.id` e `vendedor.id` | ambos são contatos |
| Separação | `cliente.id` | |
| Expedição | `expedicoes[].destinatario.id` | |
| Produto | `fornecedores[].id` | fornecedor também é contato |
| Contato | `vendedor.id` | vendedor padrão do contato |
| CRM Assunto | `cliente.id` (`CrmClienteResumoModel`) | |

Sub-recursos do contato: `GET /contatos/{id}/pessoas` (pessoas de contato — o mesmo objeto aparece embutido no detalhe como `contatos[]`) e `GET /contatos/tipos` (tipos: cliente, fornecedor, transportador, etc. → aparecem no detalhe em `tipos[]`).

**Vendedor** (`GET /vendedores`) é na prática um contato/usuário com papel de vendedor; o mesmo `id` aparece em `pedido.vendedor.id`, `nota.vendedor.id`, `contato.vendedor.id` e nos filtros `idVendedor` de /pedidos, /notas e /contatos. `GET /usuarios` lista usuários do sistema (`tipo` = "vendedor" | "" | "contador") — o `idUsuarioEmbalador` da Separação referencia usuário.

### 4.2 Núcleo: Produto e seu ecossistema de catálogo

`GET /produtos/{id}` referencia:

- `categoria.id` → árvore em `GET /categorias/todas` (recursiva: `id`, `descricao`, `filhas[]`; o produto traz também `caminhoCompleto`, ex. "Roupas >> Camisetas").
- `marca.id` → `GET /marcas`.
- `fornecedores[].id` → `GET /contatos` (+ `codigoProdutoNoFornecedor`).
- `produtoPai.id` → o próprio /produtos (variação → pai; `tipoVariacao`: N normal, P pai, V variação).
- `variacoes[].id` → cada variação tem id próprio, sku, gtin, preços, estoque e `grade[]` (chave/valor, ex. Cor=Azul).
- `kit[].produto.id` → composição de kit (tipo `K`) apontando para outros produtos + `quantidade`.
- `producao.produtos[].produto.id` → ficha técnica do fabricado (tipo `F`) apontando para matérias-primas (tipo `M`); detalhes também em `GET/PUT /produtos/{id}/fabricado` e `/kit`.
- `tags` → `GET /produtos/{id}/tags`, catálogo global em `GET /tags` e agrupadores em `GET /grupos-tags` (tag pertence a um grupo).
- Preços: bloco `precos` no detalhe; histórico de custos em `GET /produtos/{id}/custos`; atualização em massa via `PUT /produtos/{id}/preco`.

**Estoque** (`GET /estoque/{idProduto}`): usa o **mesmo id do produto/variação** como chave. Retorna `saldo`, `reservado`, `disponivel` e a quebra **por depósito** (`depositos[].id/nome/saldo/reservado/disponivel`). O depósito não tem endpoint próprio — seu cadastro é descoberto aqui e referenciado por `pedido.deposito.id` e `ordemServico.idDeposito`. Lançamentos de ajuste: `POST /estoque/{idProduto}` (tipo E/S, depósito, quantidade, preço unitário).

**Lista de preços** (`GET /listas-precos/{id}`): `acrescimoDesconto` global + `excecoes` por produto. Liga-se a produto de duas formas: `DELETE /listas-precos/{id}/produtos/{idProduto}` e o filtro `GET /produtos?idListaPreco=` (que retorna os produtos já com o preço da lista). Pedido referencia em `listaPreco.id`; ordem de serviço em `idListaPreco`.

**Serviços** (`GET /servicos`): itens tipo `S`; podem virar produto (`POST /servicos/{id}/transformar-produto`) e aparecem como item de pedido/OS com `produto.tipo = "S"`.

### 4.3 Núcleo: Pedido de venda — o centro da teia transacional

O detalhe do pedido (`GET /pedidos/{id}`) referencia praticamente tudo:

```
PEDIDO
 ├─ cliente.id ──────────────► /contatos/{id}
 ├─ itens[].produto.id ──────► /produtos/{id} (ou variação)
 ├─ listaPreco.id ───────────► /listas-precos/{id}
 ├─ deposito.id ─────────────► (depósitos via /estoque)
 ├─ vendedor.id ─────────────► /vendedores
 ├─ naturezaOperacao.id ─────► (cadastro interno, sem endpoint de listagem)
 ├─ intermediador.id ────────► /intermediadores/{id}
 ├─ transportador.id ────────► contato tipo transportador
 │    ├─ formaEnvio.id ──────► /formas-envio/{id}
 │    └─ formaFrete.id ──────► (formasFrete[] dentro de /formas-envio/{id})
 ├─ pagamento.formaRecebimento.id ─► /formas-recebimento/{id}
 ├─ pagamento.meioPagamento.id ────► (enum/cadastro de meios)
 ├─ pagamento.parcelas[] (dias, data, valor, forma/meio por parcela)
 ├─ ecommerce.id + numeroPedidoEcommerce + canalVenda (canal de venda/hub)
 ├─ idNotaFiscal ────────────► /notas/{id}   ← preenchido após faturar
 └─ marcadores ──────────────► /pedidos/{id}/marcadores
```

Ações que **criam** outros registros (é assim que a teia se materializa):
- `POST /pedidos/{id}/gerar-nota-fiscal` → cria a NF e devolve o vínculo (depois visível em `pedido.idNotaFiscal` e em `nota.origem = {tipo:"venda", id:pedido}`).
- `POST /pedidos/{id}/lancar-contas` / `estornar-contas` → cria/estorna **contas a receber** (a conta gerada é filtrável por `GET /contas-receber?idVenda={idPedido}`).
- `POST /pedidos/{id}/lancar-estoque` / `estornar-estoque` → baixa/devolve estoque dos itens.
- `POST /pedidos/{id}/gerar-ordem-producao` → gera OP para itens fabricados.
- `PUT /pedidos/{id}/situacao` (fluxo: 8 dados incompletos, 0 aberta, 3 aprovada, 4 preparando envio, 1 faturada, 7 pronto p/ envio, 5 enviada, 6 entregue, 2 cancelada, 9 não entregue) e `PUT /pedidos/{id}/despacho` (atualiza rastreio).

### 4.4 Nota Fiscal — espelho fiscal do pedido

`GET /notas/{id}` aponta para:
- `cliente.id` → contato; `vendedor.id` → vendedor.
- `itens[].idProduto` → produto (com `cfop`, `ncm`, `naturezaOperacao` por item). Item individual: `GET /notas/{id}/itens/{idItem}`.
- `idFormaEnvio` / `idFormaFrete` → /formas-envio; `idIntermediador` → /intermediadores; `idNaturezaOperacao`; `idFormaPagamento` → /formas-pagamento; `idMeioPagamento`.
- `parcelas[]` (com `idFormaPagamento`/`idMeioPagamento` por parcela) — espelham as contas a receber geradas.
- `ecommerce` (id, numeroPedidoEcommerce, canalVenda) — mesmo bloco do pedido, permitindo casar NF ↔ pedido ↔ canal.
- **`origem` = `{tipo, id}`** com tipo ∈ `pedido_compra | venda | notafiscal | ordemservico | cobranca | devolucao` — é o **link reverso explícito** para o documento que gerou a nota.
- Conteúdo fiscal: `GET /notas/{id}/xml` (XML autorizado), `GET /notas/{id}/link` (DANFE/PDF), impostos por item (ICMS, IPI, PIS, COFINS, ISSQN e os novos campos IBS/CBS da reforma tributária).
- Ações: `POST /notas/{id}/emitir` (autoriza na SEFAZ), `lancar-estoque`, `lancar-contas`, `PUT /notas/{id}/despacho`; inclusão por XML (`POST /notas/xml`, `POST /notas/nota-fiscal-consumidor/xml`) e cancelamento (`POST /notas/xml/cancelar`).
- Filtros de listagem incluem **`idVenda`** → busca notas de um pedido específico (outro caminho do vínculo pedido↔nota).

### 4.5 Financeiro

- **Contas a Receber** (`/contas-receber`): `cliente.id` → contato; `categoria.id` → `GET /categorias-receita-despesa`; `formaRecebimento.id` → /formas-recebimento; filtros `idVenda` e `idNota` fazem o vínculo com pedido e nota. Baixa: `POST /contas-receber/{id}/baixar`; liquidações em `GET /contas-receber/{id}/recebimentos` (`ObterRecebimentosModel`: valorPago, juros, taxa, desconto, acréscimo, `idConta` = conta bancária/contábil).
- **Contas a Pagar** (`/contas-pagar`): `contato.id` → fornecedor; `categoria.id` → categorias receita/despesa; `formaPagamento.id` → /formas-pagamento; `GET /contas-pagar/{id}/recebimentos` traz os pagamentos efetuados. Nasce manualmente (`POST /contas-pagar`) ou via `POST /ordem-compra/{id}/lancar-contas`.
- **Formas de pagamento** (saída de dinheiro) e **formas de recebimento** (entrada) são cadastros distintos; `meioPagamento` (dinheiro, cheque, cartão crédito/débito, PIX etc.) aparece como enum/objeto dentro de parcelas de pedido, nota e ordem de compra — essencial para conciliação e para o campo fiscal da NF.
- **Intermediadores** (`/intermediadores`): CNPJ do marketplace/gateway; referenciado por `pedido.intermediador.id`, `nota.idIntermediador` e pelo bloco `pagamentosIntegrados[]` (valor, tipoPagamento, `cnpjIntermediador`, codigoAutorizacao, bandeira) presente em pedido e nota.

### 4.6 Compras e produção

- **Ordem de Compra** (`/ordem-compra`): `contato.id` (fornecedor) → contatos; `itens[].produto.id` → produtos; `categoria.id` → categorias de **produto**; `parcelas[]` com `contaContabil.id` e `meioPagamento`; bloco `notaFiscal` (id, numero, dataEmissao) referencia a **NF de entrada** vinculada. Ações: `PUT /situacao` (0 aberto, 3 em andamento, 1 atendido, 2 cancelado), `POST /lancar-estoque` (dá entrada nos itens; aceita filtrar itens no body) e `POST /lancar-contas` (gera contas a pagar).
- **Ordem de Serviço** (`/ordem-servico`): `contato.id` e `vendedor.id` → contatos; `categoria.id` → categorias receita/despesa; `formaRecebimento.id`; `idDeposito`, `idListaPreco`, `idContaContabil`, `idLocalPrestacao`; itens de serviço + `pecas[]` (produtos usados). Ações: `gerar-nota-fiscal` (NFS-e — nota com `origem.tipo = ordemservico`), `lancar-contas`, `lancar-estoque`, `situacao`.
- **Ordem de Produção**: não tem endpoint próprio de listagem — é criada por `POST /pedidos/{id}/gerar-ordem-producao` e consome a ficha técnica (`producao` do produto fabricado).

### 4.7 Logística: Separação → Expedição

Fluxo físico após aprovação do pedido:

1. **Separação/Picking** (`GET /separacao`): cada separação referencia `venda.id` (pedido), `notaFiscal.id`, `cliente.id`, `itens[].produto.id`, `formaEnvio.id`, `ecommerce`, e o genérico `objOrigem` + `situacaoOrigem`. Situações: 1 aguardando, 4 em separação, 2 separada, 3 embalada. `PUT /separacao/{id}/situacao` move o fluxo; `idUsuarioEmbalador` → /usuarios.
2. **Expedição/Romaneio** (`GET /expedicao`): um **agrupamento** (id, identificacao, data, `formaEnvio.id`) contém várias **expedições**; cada expedição tem `tipoObjeto`+`idObjeto` (aponta para venda/nota), blocos `venda{id,...}`, `notaFiscal{id,...}`, `destinatario` (contato), `volume` (dimensões + `embalagem.id`), `logistica` (codigoRastreio, urlRastreio, valorDeclarado, `formaFrete.id`, `transportador.id`). `POST /expedicao/{idAgrupamento}/origens` adiciona vendas/notas/objetos avulsos ao romaneio; `/concluir` fecha; `/etiquetas` retorna etiquetas de envio (geral ou por expedição).
3. **Formas de envio** (`GET /formas-envio/{id}`): traz `gatewayLogistico` e `formasFrete[]` — a formaFrete referenciada por pedido/expedição/separação vive dentro da forma de envio.
4. O rastreio atualizado aqui reflete em `PUT /pedidos/{id}/despacho` e `PUT /notas/{id}/despacho` (e vice-versa nos canais de venda).

### 4.8 CRM

- `GET /crm/assuntos` (oportunidades/negócios): referenciam `cliente` (contato), `vendedor`/`usuario`, **`estagio.id`** → `GET /crm/estagios` (funil), `marcadores` próprios, `proximaAcao`.
- Sub-recursos: `/acoes` (tarefas/interações), `/anotacoes`, `/marcadores`, `/estrela` (favorito), `/arquivar`.
- `PUT /contatos/{id}/status-crm` altera o status L/P/C/I (Lead, Prospect, Cliente, Inativo) que aparece em `contato.statusCrm` — ponte entre cadastro e funil.

### 4.9 Cadastros satélites (dimensões)

| Endpoint | Papel | Referenciado por |
|---|---|---|
| `GET /categorias/todas` | árvore de categorias de produto | produto, ordem de compra |
| `GET /categorias-receita-despesa` | plano de categorias financeiras | contas a pagar/receber, OS |
| `GET /marcas` | marcas | produto |
| `GET /tags` + `GET /grupos-tags` | tags de produto | produto (via /produtos/{id}/tags) |
| `GET /formas-envio` | transportadoras/métodos + formasFrete | pedido, nota, separação, expedição |
| `GET /formas-pagamento` | condições de pagamento (saída) | contas a pagar, nota (parcelas) |
| `GET /formas-recebimento` | condições de recebimento (entrada) | pedido, contas a receber, OS |
| `GET /intermediadores` | marketplaces/gateways | pedido, nota, pagamentosIntegrados |
| `GET /vendedores`, `GET /usuarios` | pessoas internas | pedido, nota, contato, CRM, separação |
| `GET /info` | dados da empresa (matriz) | contexto/backup |

### 4.10 Diagrama-resumo da teia

```
                       ┌────────────┐
        ┌─────────────►│  CONTATOS  │◄──────────────┐
        │              └─────┬──────┘               │
        │ fornecedor         │ cliente/vendedor     │ fornecedor
┌───────┴──────┐       ┌─────▼──────┐        ┌──────┴────────┐
│   PRODUTOS   │◄──────┤  PEDIDOS   ├───────►│ ORDEM COMPRA  │
│ (variações,  │ itens └─┬───┬───┬──┘        └───┬───────┬───┘
│ kit, fabric.)│         │   │   │  gerar-nf     │lançar │lançar
└──┬───┬───┬───┘         │   │   └───────┐       │estoque│contas
   │   │   │      lançar │   │gerar OP   ▼       ▼       ▼
   │   │   │     estoque │   ▼      ┌─────────┐ ESTOQUE  CONTAS
   │   │   │             ▼  ORDEM   │  NOTAS  │          A PAGAR
   │   │   │          ESTOQUE PROD. │ FISCAIS │◄── OS (NFS-e)
   │   │   │  categoria             └──┬───┬──┘
   │   │   └──► CATEGORIAS  lançar-    │   │ origem{tipo,id}
   │   └──────► MARCAS      contas ────┘   │
   └──────────► TAGS/GRUPOS    │           ▼
                               ▼      SEPARAÇÃO ──► EXPEDIÇÃO
                        CONTAS A RECEBER              │
                        (idVenda, idNota)             ▼
                               │              FORMAS DE ENVIO
                               ▼              (formasFrete)
                        RECEBIMENTOS
Dimensões transversais: formas pagto/receb., meios de pagamento,
intermediadores, depósitos, listas de preço, vendedores/usuários,
marcadores (pedido, nota, contas, OC, OS, CRM), ecommerce/canal.
```

---

## 5. Modelo de banco sugerido + estratégia de sincronização

### 5.1 Princípios de modelagem

1. **Schema canônico multi-fonte (preparado para troca de ERP):** em vez de `tiny_id`, toda tabela usa o par **`source` + `source_id`** — `source TEXT` identifica a origem (`'tiny'` hoje; `'bling'`, `'omie'`... amanhã) e `source_id BIGINT` é o id nativo daquele ERP. A chave primária é composta: `PRIMARY KEY (source, source_id)`. Alternativa equivalente: um `id BIGSERIAL` interno como PK e `UNIQUE (source, source_id)`. Com isso o sincronizador do Tiny vira apenas um *conector* que traduz API → schema canônico; ao migrar de ERP você escreve outro conector para as mesmas tabelas e o dashboard/histórico não mudam. As colunas de referência (`cliente_id`, `produto_id`, `vendedor_id`...) guardam o `source_id` da entidade referenciada e se resolvem dentro do mesmo `source` do registro.
2. **Desnormalize o embutido, normalize o referenciado**: quando o objeto aninhado só tem `id`+`nome` (vendedor, depósito, formaEnvio...), grave a FK e mantenha a tabela-dimensão alimentada pelos endpoints de cadastro. Blocos sem endpoint próprio (endereço de entrega, parcelas, pagamentosIntegrados, grade da variação) viram colunas ou tabelas-filhas do documento.
3. **Guarde o JSON bruto** (`payload JSONB`) em cada tabela transacional além das colunas tipadas — é o seu backup fiel e protege contra campos novos (ex.: os campos IBS/CBS da reforma tributária que já apareceram nas notas).
4. **Snapshot vs. histórico:** estoque e preços mudam sem "data de alteração" consultável — trate como snapshot com `captured_at`, mantendo histórico por append se quiser evolução no tempo.

### 5.2 DDL de referência (PostgreSQL, resumido)

```sql
-- Padrão canônico: PK composta (source, source_id). Enquanto houver só o Tiny,
-- source = 'tiny' (default). FKs (cliente_id, produto_id...) guardam o source_id
-- da entidade referenciada, resolvido dentro do mesmo source.

-- DIMENSÕES (carga completa, baixa frequência)
CREATE TABLE contatos        (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, codigo TEXT, fantasia TEXT,
                              tipo_pessoa CHAR(1), cpf_cnpj TEXT, email TEXT, telefone TEXT, celular TEXT,
                              situacao CHAR(1), status_crm CHAR(1), vendedor_id BIGINT,
                              endereco JSONB, endereco_cobranca JSONB,
                              data_criacao TIMESTAMPTZ, data_atualizacao TIMESTAMPTZ, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE contato_tipos   (source TEXT NOT NULL DEFAULT 'tiny', contato_id BIGINT, tipo_id BIGINT, descricao TEXT,
                              PRIMARY KEY (source, contato_id, tipo_id));
CREATE TABLE contato_pessoas (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, contato_id BIGINT,
                              nome TEXT, telefone TEXT, ramal TEXT, email TEXT, setor TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE vendedores      (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE usuarios        (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, email TEXT, tipo TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE categorias      (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, descricao TEXT, pai_id BIGINT, caminho TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE marcas          (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE formas_envio    (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, gateway JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE formas_frete    (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, forma_envio_id BIGINT, nome TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE formas_pagamento   (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE formas_recebimento (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE intermediadores (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, cnpj TEXT, cnpj_pagamento TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE cat_receita_despesa (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, descricao TEXT, PRIMARY KEY (source, source_id));
CREATE TABLE listas_preco    (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, acrescimo_desconto NUMERIC, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE depositos       (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, nome TEXT, desconsiderar BOOL, empresa TEXT, PRIMARY KEY (source, source_id));

-- CATÁLOGO
CREATE TABLE produtos (
  source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, sku TEXT, gtin TEXT, descricao TEXT,
  tipo CHAR(1),               -- K kit, S simples, V variações, F fabricado, M matéria-prima
  tipo_variacao CHAR(1),      -- N / P (pai) / V (variação)
  situacao CHAR(1), unidade TEXT, ncm TEXT, origem TEXT,
  produto_pai_id BIGINT, categoria_id BIGINT, marca_id BIGINT,
  preco NUMERIC, preco_promocional NUMERIC, preco_custo NUMERIC, preco_custo_medio NUMERIC,
  dimensoes JSONB, seo JSONB, tributacao JSONB,
  data_criacao TIMESTAMPTZ, data_alteracao TIMESTAMPTZ, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE produto_fornecedores (produto_id BIGINT, contato_id BIGINT, codigo_no_fornecedor TEXT,
                                   PRIMARY KEY (produto_id, contato_id));
CREATE TABLE produto_grade (produto_id BIGINT, chave TEXT, valor TEXT);          -- variações
CREATE TABLE produto_kit   (kit_id BIGINT, componente_id BIGINT, quantidade NUMERIC,
                            PRIMARY KEY (kit_id, componente_id));
CREATE TABLE produto_producao (produto_id BIGINT, insumo_id BIGINT, quantidade NUMERIC,
                            PRIMARY KEY (produto_id, insumo_id));
CREATE TABLE produto_tags  (produto_id BIGINT, tag TEXT, grupo TEXT);

-- SNAPSHOTS
CREATE TABLE estoque_snapshot (
  produto_id BIGINT, deposito_id BIGINT, saldo NUMERIC, reservado NUMERIC, disponivel NUMERIC,
  captured_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (produto_id, deposito_id, captured_at));

-- TRANSAÇÕES
CREATE TABLE pedidos (
  source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, numero INT, situacao SMALLINT, origem_pedido SMALLINT,
  data DATE, data_prevista DATE, data_envio DATE, data_entrega DATE, data_faturamento DATE,
  cliente_id BIGINT, vendedor_id BIGINT, deposito_id BIGINT, lista_preco_id BIGINT,
  natureza_operacao_id BIGINT, intermediador_id BIGINT,
  transportador_id BIGINT, forma_envio_id BIGINT, forma_frete_id BIGINT,
  forma_recebimento_id BIGINT, meio_pagamento_id BIGINT, condicao_pagamento TEXT,
  ecommerce_id BIGINT, ecommerce_nome TEXT, numero_pedido_ecommerce TEXT, canal_venda TEXT,
  nota_fiscal_id BIGINT,                       -- << vínculo pedido→nota
  valor_produtos NUMERIC, valor_frete NUMERIC, valor_desconto NUMERIC,
  valor_outras NUMERIC, valor_total NUMERIC,
  endereco_entrega JSONB, codigo_rastreamento TEXT, url_rastreamento TEXT,
  observacoes TEXT, payload JSONB, synced_at TIMESTAMPTZ, PRIMARY KEY (source, source_id));
CREATE TABLE pedido_itens    (pedido_id BIGINT, seq SMALLINT, produto_id BIGINT, sku TEXT,
                              descricao TEXT, quantidade NUMERIC, valor_unitario NUMERIC,
                              info_adicional TEXT, PRIMARY KEY (pedido_id, seq));
CREATE TABLE pedido_parcelas (pedido_id BIGINT, seq SMALLINT, dias INT, data DATE, valor NUMERIC,
                              forma_recebimento_id BIGINT, meio_pagamento_id BIGINT,
                              PRIMARY KEY (pedido_id, seq));
CREATE TABLE pedido_pag_integrados (pedido_id BIGINT, seq SMALLINT, valor NUMERIC, tipo_pagamento INT,
                              cnpj_intermediador TEXT, codigo_autorizacao TEXT, codigo_bandeira INT,
                              PRIMARY KEY (pedido_id, seq));
CREATE TABLE marcadores (objeto TEXT, objeto_id BIGINT, marcador TEXT,   -- pedido/nota/cp/cr/oc/os
                         PRIMARY KEY (objeto, objeto_id, marcador));

CREATE TABLE notas_fiscais (
  source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, tipo CHAR(1), situacao SMALLINT, finalidade SMALLINT,
  numero TEXT, serie TEXT, chave_acesso TEXT, data_emissao TIMESTAMPTZ, data_inclusao TIMESTAMPTZ,
  cliente_id BIGINT, vendedor_id BIGINT,
  origem_tipo TEXT, origem_id BIGINT,          -- << venda/ordemservico/pedido_compra/devolucao...
  forma_envio_id BIGINT, forma_frete_id BIGINT, intermediador_id BIGINT,
  natureza_operacao_id BIGINT, forma_pagamento_id BIGINT, meio_pagamento_id BIGINT,
  valor NUMERIC, valor_produtos NUMERIC, valor_frete NUMERIC, valor_desconto NUMERIC,
  base_icms NUMERIC, valor_icms NUMERIC, valor_ipi NUMERIC, valor_issqn NUMERIC,
  valor_ibs_uf NUMERIC, valor_cbs NUMERIC,     -- reforma tributária
  ecommerce JSONB, transportador JSONB, endereco_entrega JSONB,
  codigo_rastreamento TEXT, xml TEXT, payload JSONB, synced_at TIMESTAMPTZ, PRIMARY KEY (source, source_id));
CREATE TABLE nf_itens    (nota_id BIGINT, item_id BIGINT, produto_id BIGINT, codigo TEXT, ncm TEXT,
                          cfop TEXT, descricao TEXT, unidade TEXT, quantidade NUMERIC,
                          valor_unitario NUMERIC, valor_total NUMERIC, impostos JSONB,
                          PRIMARY KEY (nota_id, item_id));
CREATE TABLE nf_parcelas (nota_id BIGINT, seq SMALLINT, dias INT, data DATE, valor NUMERIC,
                          forma_pagamento_id BIGINT, meio_pagamento_id BIGINT,
                          PRIMARY KEY (nota_id, seq));

CREATE TABLE contas_receber (
  source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, situacao TEXT, cliente_id BIGINT, categoria_id BIGINT,
  forma_recebimento_id BIGINT, venda_id BIGINT, nota_id BIGINT,   -- via filtros idVenda/idNota
  data DATE, data_vencimento DATE, data_competencia DATE, data_liquidacao DATE,
  numero_documento TEXT, numero_banco TEXT, ocorrencia CHAR(1),
  valor NUMERIC, saldo NUMERIC, valor_pago NUMERIC, juros NUMERIC, multa NUMERIC, taxa NUMERIC,
  historico TEXT, link_boleto TEXT, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE contas_pagar LIKE contas_receber INCLUDING ALL;      -- contato_id no lugar de cliente_id
CREATE TABLE baixas (source TEXT NOT NULL DEFAULT 'tiny', conta_tipo CHAR(2), conta_id BIGINT,
  source_id BIGINT, data DATE,
  valor_pago NUMERIC, valor_juro NUMERIC, valor_taxa NUMERIC, valor_desconto NUMERIC,
  valor_acrescimo NUMERIC, id_conta_bancaria TEXT,
  PRIMARY KEY (source, conta_tipo, conta_id, source_id));

CREATE TABLE ordens_compra   (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, numero TEXT, situacao SMALLINT, data DATE,
  fornecedor_id BIGINT, categoria_id BIGINT, nota_fiscal_id BIGINT, total NUMERIC, frete NUMERIC,
  data_prevista DATE, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE oc_itens        (oc_id BIGINT, seq SMALLINT, produto_id BIGINT, quantidade NUMERIC,
  preco NUMERIC, ipi NUMERIC, PRIMARY KEY (oc_id, seq));
CREATE TABLE ordens_servico  (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, numero TEXT, situacao SMALLINT, data DATE,
  contato_id BIGINT, vendedor_id BIGINT, categoria_id BIGINT, forma_recebimento_id BIGINT,
  deposito_id BIGINT, lista_preco_id BIGINT, equipamento TEXT, total NUMERIC, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE separacoes      (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, situacao SMALLINT, venda_id BIGINT,
  nota_id BIGINT, cliente_id BIGINT, forma_envio_id BIGINT, usuario_embalador_id BIGINT,
  data_criacao TIMESTAMPTZ, data_separacao TIMESTAMPTZ, data_checkout TIMESTAMPTZ, payload JSONB, PRIMARY KEY (source, source_id));
CREATE TABLE expedicao_agrupamentos (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, identificacao TEXT, data DATE,
  forma_envio_id BIGINT, PRIMARY KEY (source, source_id));
CREATE TABLE expedicoes      (source TEXT NOT NULL DEFAULT 'tiny', source_id BIGINT NOT NULL, agrupamento_id BIGINT, situacao TEXT,
  tipo_objeto TEXT, objeto_id BIGINT, venda_id BIGINT, nota_id BIGINT, destinatario_id BIGINT,
  codigo_rastreio TEXT, url_rastreio TEXT, transportador_id BIGINT, forma_frete_id BIGINT,
  volume JSONB, payload JSONB, PRIMARY KEY (source, source_id));
```

### 5.3 Ordem de carga (respeitando as dependências)

**Fase 1 — dimensões** (1x/dia é suficiente):
`/info` → `/categorias/todas` → `/marcas` → `/grupos-tags` + `/tags` → `/formas-envio` (+ detalhe p/ formasFrete) → `/formas-pagamento` → `/formas-recebimento` → `/intermediadores` → `/categorias-receita-despesa` → `/vendedores` → `/usuarios` → `/listas-precos` (+ detalhe) → `/servicos` → `/crm/estagios`.

**Fase 2 — cadastros grandes:**
`/contatos` (paginado; detalhe traz tipos e pessoas) → `/produtos` (paginado; detalhe traz variações, kit, produção, fornecedores; depósitos surgem no primeiro `/estoque/{id}`).

**Fase 3 — transações** (mais recentes primeiro):
`/pedidos` → `/notas` → `/ordem-compra` → `/ordem-servico` → `/contas-receber` (+ `/recebimentos`) → `/contas-pagar` (+ `/recebimentos`) → `/separacao` → `/expedicao` → `/crm/assuntos`.

**Fase 4 — snapshots:** `/estoque/{idProduto}` para os produtos com `estoque.controlar = true` (ou todos, se couber no rate limit); custos via `/produtos/{id}/custos` se precisar de custo médio histórico.

### 5.4 Sincronização incremental (após a carga full)

| Recurso | Estratégia incremental |
|---|---|
| Pedidos | `GET /pedidos?dataAtualizacao={ultimo_sync}` → re-busca detalhe dos ids retornados |
| Contatos | `GET /contatos?dataAtualizacao=` |
| Produtos | `GET /produtos?dataAlteracao=` |
| Notas | `GET /notas?dataInicial/dataFinal` (janela deslizante, ex. últimos 7 dias) + re-checar notas com situação não-final (pendente/aguardando) |
| Contas a pagar/receber | janela por `dataInicialEmissao/dataFinalEmissao` + re-checar contas com situação `aberto/parcial/prevista/atrasadas` p/ capturar baixas |
| OC / OS / Separação / Expedição / CRM | janela por `dataInicial/dataFinal` |
| Estoque / Preços | snapshot agendado (não há filtro de alteração) |

Regras práticas:
- **Upsert por `(source, source_id)`** (`INSERT ... ON CONFLICT (source, source_id) DO UPDATE`), guardando `synced_at`. O conector do Tiny sempre grava `source = 'tiny'`.
- Percorra páginas até `offset + limit >= paginacao.total`; use `limit=100` (valor alto reduz chamadas).
- Respeite o rate limit do plano: com 60 req/min, uma carga full de ~10 mil produtos + detalhes leva algumas horas — rode a full de madrugada e a incremental a cada 15–60 min.
- Delete lógico: recursos excluídos aparecem com `situacao = 'E'` (produtos, contatos) — não somem da API; marque `situacao` no banco em vez de apagar.
- Vínculo pedido↔conta a receber: como o detalhe da conta não devolve `idVenda`, capture-o na direção inversa — ao sincronizar um pedido faturado, chame `GET /contas-receber?idVenda={id}` e grave `venda_id` nas contas retornadas (idem `idNota`).
- Para backup fiscal completo, baixe e armazene o **XML** (`GET /notas/{id}/xml`) das notas com situação ≥ emitida.

### 5.5 Relatórios que esse modelo habilita

- **Vendas**: faturamento por canal (`canal_venda`), por vendedor, por categoria/marca de produto (join pedido_itens → produtos → categorias/marcas), ticket médio, curva ABC de SKU, margem (preço de venda × `preco_custo_medio`).
- **Fiscal**: notas por CFOP/natureza, carga tributária por item (impostos em `nf_itens.impostos`), conferência pedido × nota via `origem`/`idNotaFiscal`.
- **Financeiro**: aging de contas a receber/pagar (`data_vencimento` × `situacao`), inadimplência por cliente, fluxo de caixa realizado (tabela `baixas`), taxas de intermediadores (`pag_integrados`).
- **Logística**: lead time aprovação→separação→expedição→entrega (datas de pedido, separação e expedição), custo de frete por forma de envio, SLA por transportadora.
- **Estoque**: cobertura por depósito (snapshot × média de venda diária), ruptura de itens com `estoque.minimo`, valorização (saldo × custo médio).
