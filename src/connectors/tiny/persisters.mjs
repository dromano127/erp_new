// Mapeia objetos de detalhe da API Tiny v3 → tabelas do schema canônico e grava.
// Cada persistX recebe o JSON já obtido da API e faz upsert do registro principal
// + replaceChildren das tabelas-filhas. Todos gravam source='tiny' e payload cru.

import { sql } from '../../lib/db.mjs';
import { upsert, upsertMany, replaceChildren, s, num, int, bool, dt } from '../../lib/upsert.mjs';

const SRC = 'tiny';

// ---------------------------------------------------------------------
// DIMENSÕES
// ---------------------------------------------------------------------

export async function persistEmpresa(d) {
  await upsert('empresa', {
    source: SRC,
    source_id: 0,
    razao_social: s(d.razaoSocial),
    fantasia: s(d.fantasia),
    cpf_cnpj: s(d.cpfCnpj),
    inscricao_estadual: s(d.inscricaoEstadual),
    fone: s(d.fone),
    email: s(d.email),
    regime_tributario: int(d.regimeTributario),
    endereco: d.enderecoEmpresa ?? null,
    payload: d,
  });
}

export async function persistCategoriasTree(tree) {
  // /categorias/todas → árvore recursiva (id, descricao, filhas[]).
  const walk = async (nodes, paiId, prefix) => {
    for (const n of nodes ?? []) {
      const caminho = prefix ? `${prefix} >> ${n.descricao}` : n.descricao;
      await upsert('categorias', {
        source: SRC,
        source_id: int(n.id),
        descricao: s(n.descricao),
        pai_id: paiId,
        caminho: s(caminho),
      });
      if (n.filhas?.length) await walk(n.filhas, int(n.id), caminho);
    }
  };
  // A resposta pode ser: array de raízes; um nó raiz ({id, descricao, filhas});
  // ou um wrapper sem id ({filhas: [...]}).
  let roots;
  if (Array.isArray(tree)) roots = tree;
  else if (tree?.id != null) roots = [tree];
  else roots = tree?.filhas ?? [];
  await walk(roots, null, '');
}

export const persistMarca = (d) =>
  upsert('marcas', { source: SRC, source_id: int(d.id), nome: s(d.nome ?? d.descricao) });

export const persistGrupoTag = (d) =>
  upsert('grupos_tags', { source: SRC, source_id: int(d.id), nome: s(d.nome) });

export const persistTagProduto = (d) =>
  upsert('tags_produto', {
    source: SRC,
    source_id: int(d.id),
    nome: s(d.nome),
    grupo_id: int(d.idGrupoTag),
    grupo_nome: s(d.nomeGrupoTag),
  });

export async function persistFormaEnvio(d) {
  await upsert('formas_envio', {
    source: SRC,
    source_id: int(d.id),
    nome: s(d.nome),
    tipo: s(d.tipo),
    situacao: s(d.situacao),
    gateway: d.gatewayLogistico ?? null,
    payload: d,
  });
  for (const f of d.formasFrete ?? []) {
    await upsert('formas_frete', {
      source: SRC,
      source_id: int(f.id),
      forma_envio_id: int(d.id),
      nome: s(f.nome),
      codigo: s(f.codigo),
      codigo_externo: s(f.codigoExterno),
      tipo_entrega: s(f.tipoEntrega),
    });
  }
}

export const persistFormaPagamento = (d) =>
  upsert('formas_pagamento', {
    source: SRC, source_id: int(d.id), nome: s(d.nome), situacao: s(d.situacao),
  });

export const persistFormaRecebimento = (d) =>
  upsert('formas_recebimento', {
    source: SRC, source_id: int(d.id), nome: s(d.nome), situacao: s(d.situacao),
  });

export const persistIntermediador = (d) =>
  upsert('intermediadores', {
    source: SRC, source_id: int(d.id), nome: s(d.nome), cnpj: s(d.cnpj),
    canal_venda: s(d.canalVenda),
  });

export const persistCatReceitaDespesa = (d) =>
  upsert('cat_receita_despesa', {
    source: SRC, source_id: int(d.id), descricao: s(d.descricao), grupo: s(d.grupo),
  });

export const persistVendedor = (d) =>
  upsert('vendedores', { source: SRC, source_id: int(d.id), nome: s(d.nome), codigo: s(d.codigo) });

export const persistUsuario = (d) =>
  upsert('usuarios', {
    source: SRC, source_id: int(d.id), nome: s(d.nome), email: s(d.email), tipo: s(d.tipo),
  });

export const persistListaPreco = (d) =>
  upsert('listas_preco', {
    source: SRC, source_id: int(d.id), nome: s(d.descricao ?? d.nome),
    acrescimo_desconto: num(d.acrescimoDesconto), payload: d,
  });

export const persistServico = (d) =>
  upsert('servicos', {
    source: SRC, source_id: int(d.id), codigo: s(d.codigo),
    descricao: s(d.descricao), situacao: s(d.situacao), payload: d,
  });

export const persistCrmEstagio = (d) =>
  upsert('crm_estagios', {
    source: SRC, source_id: int(d.id), descricao: s(d.descricao), ordem: int(d.ordem),
  });

export const persistDeposito = (d) =>
  upsert('depositos', {
    source: SRC, source_id: int(d.id), nome: s(d.nome),
    desconsiderar: bool(d.desconsiderar), empresa: s(d.empresa),
  });

// ---------------------------------------------------------------------
// CONTATO
// ---------------------------------------------------------------------

export async function persistContato(d) {
  await upsert('contatos', {
    source: SRC,
    source_id: int(d.id),
    nome: s(d.nome),
    codigo: s(d.codigo),
    fantasia: s(d.fantasia),
    tipo_pessoa: s(d.tipoPessoa),
    cpf_cnpj: s(d.cpfCnpj),
    inscricao_estadual: s(d.inscricaoEstadual),
    rg: s(d.rg),
    email: s(d.email),
    telefone: s(d.telefone),
    celular: s(d.celular),
    situacao: s(d.situacao),
    status_crm: s(d.statusCrm),
    vendedor_id: int(d.vendedor?.id),
    limite_credito: num(d.limiteCredito),
    endereco: d.endereco ?? null,
    endereco_cobranca: d.enderecoCobranca ?? null,
    data_criacao: dt(d.dataCriacao),
    data_atualizacao: dt(d.dataAtualizacao),
    payload: d,
  });

  const tipos = (d.tipos ?? []).map((t) => ({
    source: SRC, contato_id: int(d.id), tipo_id: int(t.id), descricao: s(t.descricao),
  }));
  await replaceChildren('contato_tipos', 'contato_id', int(d.id), tipos);

  for (const p of d.contatos ?? []) {
    await upsert('contato_pessoas', {
      source: SRC, source_id: int(p.id), contato_id: int(d.id),
      nome: s(p.nome), telefone: s(p.telefone), ramal: s(p.ramal),
      email: s(p.email), setor: s(p.setor),
    });
  }
}

// ---------------------------------------------------------------------
// PRODUTO
// ---------------------------------------------------------------------

export async function persistProduto(d) {
  const pr = d.precos ?? {};
  await upsert('produtos', {
    source: SRC,
    source_id: int(d.id),
    sku: s(d.sku),
    gtin: s(d.gtin),
    descricao: s(d.descricao),
    descricao_complementar: s(d.descricaoComplementar),
    tipo: s(d.tipo),
    tipo_variacao: s(d.tipoVariacao),
    situacao: s(d.situacao),
    unidade: s(d.unidade),
    ncm: s(d.ncm),
    origem: s(d.origem),
    produto_pai_id: int(d.produtoPai?.id),
    categoria_id: int(d.categoria?.id),
    marca_id: int(d.marca?.id),
    preco: num(pr.preco),
    preco_promocional: num(pr.precoPromocional),
    preco_custo: num(pr.precoCusto),
    preco_custo_medio: num(pr.precoCustoMedio),
    dimensoes: d.dimensoes ?? null,
    seo: d.seo ?? null,
    tributacao: d.tributacao ?? null,
    data_criacao: dt(d.dataCriacao),
    data_alteracao: dt(d.dataAlteracao),
    payload: d,
  });

  const forn = (d.fornecedores ?? []).map((f) => ({
    source: SRC, produto_id: int(d.id), contato_id: int(f.id),
    codigo_no_fornecedor: s(f.codigoProdutoNoFornecedor),
  }));
  await replaceChildren('produto_fornecedores', 'produto_id', int(d.id), forn);

  const kit = (d.kit ?? []).map((k) => ({
    source: SRC, kit_id: int(d.id), componente_id: int(k.produto?.id), quantidade: num(k.quantidade),
  }));
  await replaceChildren('produto_kit', 'kit_id', int(d.id), kit);

  const prod = (d.producao?.produtos ?? []).map((p) => ({
    source: SRC, produto_id: int(d.id), insumo_id: int(p.produto?.id), quantidade: num(p.quantidade),
  }));
  await replaceChildren('produto_producao', 'produto_id', int(d.id), prod);

  // grade das variações: cada variação tem seu próprio produto (id) e grade[].
  for (const v of d.variacoes ?? []) {
    const grade = (v.grade ?? []).map((g) => ({
      source: SRC, produto_id: int(v.id), chave: s(g.chave), valor: s(g.valor),
    }));
    await replaceChildren('produto_grade', 'produto_id', int(v.id), grade);
  }
}

export async function persistProdutoTags(produtoId, tags) {
  const rows = (tags ?? []).map((t) => ({
    source: SRC, produto_id: int(produtoId),
    tag: s(t.nome ?? t), grupo: s(t.nomeGrupoTag),
  }));
  await replaceChildren('produto_tags', 'produto_id', int(produtoId), rows);
}

// ---------------------------------------------------------------------
// ESTOQUE (snapshot)
// ---------------------------------------------------------------------

export async function persistEstoque(d) {
  const produtoId = int(d.id);
  // snapshot geral (deposito_id = 0) + por depósito
  await upsert(
    'estoque_snapshot',
    {
      source: SRC, produto_id: produtoId, deposito_id: 0,
      saldo: num(d.saldo), reservado: num(d.reservado), disponivel: num(d.disponivel),
    },
    null, // insert puro (captured_at faz parte da PK)
  );
  for (const dep of d.depositos ?? []) {
    await persistDeposito(dep);
    await upsert(
      'estoque_snapshot',
      {
        source: SRC, produto_id: produtoId, deposito_id: int(dep.id),
        saldo: num(dep.saldo), reservado: num(dep.reservado), disponivel: num(dep.disponivel),
      },
      null,
    );
  }
}

// ---------------------------------------------------------------------
// PEDIDO
// ---------------------------------------------------------------------

export async function persistPedido(d) {
  const t = d.transportador ?? {};
  const pg = d.pagamento ?? {};
  await upsert('pedidos', {
    source: SRC,
    source_id: int(d.id),
    numero: int(d.numeroPedido),
    situacao: int(d.situacao),
    origem_pedido: int(d.origemPedido),
    data: dt(d.data),
    data_prevista: dt(d.dataPrevista),
    data_envio: dt(d.dataEnvio),
    data_entrega: dt(d.dataEntrega),
    data_faturamento: dt(d.dataFaturamento),
    cliente_id: int(d.cliente?.id),
    vendedor_id: int(d.vendedor?.id),
    deposito_id: int(d.deposito?.id),
    lista_preco_id: int(d.listaPreco?.id),
    natureza_operacao_id: int(d.naturezaOperacao?.id),
    intermediador_id: int(d.intermediador?.id),
    transportador_id: int(t.id),
    forma_envio_id: int(t.formaEnvio?.id),
    forma_frete_id: int(t.formaFrete?.id),
    forma_recebimento_id: int(pg.formaRecebimento?.id),
    meio_pagamento_id: int(pg.meioPagamento?.id),
    condicao_pagamento: s(pg.condicaoPagamento),
    ecommerce_id: int(d.ecommerce?.id),
    ecommerce_nome: s(d.ecommerce?.nome),
    numero_pedido_ecommerce: s(d.ecommerce?.numeroPedidoEcommerce),
    canal_venda: s(d.ecommerce?.canalVenda),
    nota_fiscal_id: int(d.idNotaFiscal),
    valor_produtos: num(d.valorTotalProdutos),
    valor_frete: num(d.valorFrete),
    valor_desconto: num(d.valorDesconto),
    valor_outras: num(d.valorOutrasDespesas),
    valor_total: num(d.valorTotalPedido),
    endereco_entrega: d.enderecoEntrega ?? null,
    codigo_rastreamento: s(t.codigoRastreamento),
    url_rastreamento: s(t.urlRastreamento),
    observacoes: s(d.observacoes),
    data_atualizacao: dt(d.dataAtualizacao),
    payload: d,
  });

  const itens = (d.itens ?? []).map((it, i) => ({
    source: SRC, pedido_id: int(d.id), seq: i + 1,
    produto_id: int(it.produto?.id), sku: s(it.produto?.sku),
    descricao: s(it.produto?.descricao), quantidade: num(it.quantidade),
    valor_unitario: num(it.valorUnitario), info_adicional: s(it.infoAdicional),
  }));
  await replaceChildren('pedido_itens', 'pedido_id', int(d.id), itens);

  const parc = (pg.parcelas ?? []).map((p, i) => ({
    source: SRC, pedido_id: int(d.id), seq: i + 1, dias: int(p.dias), data: dt(p.data),
    valor: num(p.valor), forma_recebimento_id: int(p.formaRecebimento?.id),
    meio_pagamento_id: int(p.meioPagamento?.id), observacoes: s(p.observacoes),
  }));
  await replaceChildren('pedido_parcelas', 'pedido_id', int(d.id), parc);

  const pgi = (d.pagamentosIntegrados ?? []).map((p, i) => ({
    source: SRC, pedido_id: int(d.id), seq: i + 1, valor: num(p.valor),
    tipo_pagamento: int(p.tipoPagamento), cnpj_intermediador: s(p.cnpjIntermediador),
    codigo_autorizacao: s(p.codigoAutorizacao), codigo_bandeira: int(p.codigoBandeira),
  }));
  await replaceChildren('pedido_pag_integrados', 'pedido_id', int(d.id), pgi);
}

// ---------------------------------------------------------------------
// NOTA FISCAL
// ---------------------------------------------------------------------

export async function persistNota(d) {
  await upsert('notas_fiscais', {
    source: SRC,
    source_id: int(d.id),
    tipo: s(d.tipo),
    situacao: int(d.situacao),
    finalidade: int(d.finalidade),
    numero: s(d.numero),
    serie: s(d.serie),
    chave_acesso: s(d.chaveAcesso),
    data_emissao: dt(d.dataEmissao),
    data_inclusao: dt(d.dataInclusao),
    cliente_id: int(d.cliente?.id),
    vendedor_id: int(d.vendedor?.id),
    origem_tipo: s(d.origem?.tipo),
    origem_id: int(d.origem?.id),
    forma_envio_id: int(d.idFormaEnvio),
    forma_frete_id: int(d.idFormaFrete),
    intermediador_id: int(d.idIntermediador),
    natureza_operacao_id: int(d.idNaturezaOperacao),
    forma_pagamento_id: int(d.idFormaPagamento),
    meio_pagamento_id: int(d.idMeioPagamento),
    valor: num(d.valor),
    valor_produtos: num(d.valorProdutos),
    valor_frete: num(d.valorFrete),
    valor_desconto: num(d.valorDesconto),
    base_icms: num(d.baseIcms),
    valor_icms: num(d.valorIcms),
    valor_ipi: num(d.valorIpi),
    valor_issqn: num(d.valorIssqn),
    valor_ibs_uf: num(d.valorTotalIBSUF),
    valor_cbs: num(d.valorTotalCBS),
    ecommerce: d.ecommerce ?? null,
    transportador: d.transportador ?? null,
    endereco_entrega: d.enderecoEntrega ?? null,
    codigo_rastreamento: s(d.codigoRastreamento),
    payload: d,
  });

  const itens = (d.itens ?? []).map((it) => ({
    source: SRC, nota_id: int(d.id), item_id: int(it.idItem),
    produto_id: int(it.idProduto), codigo: s(it.codigo), ncm: s(it.ncm),
    cfop: s(it.cfop), descricao: s(it.descricao), unidade: s(it.unidade),
    quantidade: num(it.quantidade), valor_unitario: num(it.valorUnitario),
    valor_total: num(it.valorTotal), natureza_operacao: s(it.naturezaOperacao),
    impostos: {
      pis: it.pis, icms: it.icms, cofins: it.cofins, simples: it.simples,
      ipi: it.ipi, ibsCbsIs: it.ibsCbsIs,
    },
  }));
  await replaceChildren('nf_itens', 'nota_id', int(d.id), itens);

  const parc = (d.parcelas ?? []).map((p, i) => ({
    source: SRC, nota_id: int(d.id), seq: i + 1, dias: int(p.dias), data: dt(p.data),
    valor: num(p.valor), forma_pagamento_id: int(p.idFormaPagamento),
    meio_pagamento_id: int(p.idMeioPagamento), observacoes: s(p.observacoes),
  }));
  await replaceChildren('nf_parcelas', 'nota_id', int(d.id), parc);
}

// ---------------------------------------------------------------------
// FINANCEIRO
// ---------------------------------------------------------------------

export async function persistContaReceber(d, { vendaId, notaId } = {}) {
  await upsert('contas_receber', {
    source: SRC,
    source_id: int(d.id),
    situacao: s(d.situacao),
    cliente_id: int(d.cliente?.id),
    categoria_id: int(d.categoria?.id),
    forma_recebimento_id: int(d.formaRecebimento?.id),
    venda_id: int(vendaId),
    nota_id: int(notaId),
    data: dt(d.data),
    data_vencimento: dt(d.dataVencimento),
    data_competencia: dt(d.dataCompetencia),
    data_liquidacao: dt(d.dataLiquidacao),
    numero_documento: s(d.numeroDocumento),
    serie_documento: s(d.serieDocumento),
    numero_banco: s(d.numeroBanco),
    ocorrencia: s(d.ocorrencia),
    valor: num(d.valor),
    saldo: num(d.saldo),
    valor_pago: num(d.valorPago),
    juros: num(d.juros),
    multa: num(d.multa),
    taxa: num(d.taxa),
    historico: s(d.historico),
    link_boleto: s(d.linkBoleto),
    payload: d,
  });
}

export async function persistContaPagar(d) {
  await upsert('contas_pagar', {
    source: SRC,
    source_id: int(d.id),
    situacao: s(d.situacao),
    contato_id: int(d.contato?.id),
    categoria_id: int(d.categoria?.id),
    forma_pagamento_id: int(d.formaPagamento?.id),
    data: dt(d.data),
    data_vencimento: dt(d.dataVencimento),
    data_competencia: dt(d.dataCompetencia),
    data_liquidacao: dt(d.dataLiquidacao),
    numero_documento: s(d.numeroDocumento),
    serie_documento: s(d.serieDocumento),
    ocorrencia: s(d.ocorrencia),
    valor: num(d.valor),
    saldo: num(d.saldo),
    valor_pago: num(d.valorPago),
    juros: num(d.juros),
    multa: num(d.multa),
    historico: s(d.historico),
    payload: d,
  });
}

export async function persistBaixas(contaTipo, contaId, recebimentos) {
  for (const r of recebimentos ?? []) {
    await upsert(
      'baixas',
      {
        source: SRC, conta_tipo: contaTipo, conta_id: int(contaId), source_id: int(r.id),
        data: dt(r.data), valor_pago: num(r.valorPago), valor_juro: num(r.valorJuro),
        valor_taxa: num(r.valorTaxa), valor_desconto: num(r.valorDesconto),
        valor_acrescimo: num(r.valorAcrescimo), id_conta_bancaria: s(r.idConta),
        tipo: int(r.tipo),
      },
      ['source', 'conta_tipo', 'conta_id', 'source_id'],
    );
  }
}

// ---------------------------------------------------------------------
// COMPRAS / PRODUÇÃO / LOGÍSTICA
// ---------------------------------------------------------------------

export async function persistOrdemCompra(d) {
  await upsert('ordens_compra', {
    source: SRC, source_id: int(d.id), numero: s(d.numeroPedido), situacao: int(d.situacao),
    data: dt(d.data), data_prevista: dt(d.dataPrevista), fornecedor_id: int(d.contato?.id),
    categoria_id: int(d.categoria?.id), nota_fiscal_id: int(d.notaFiscal?.id),
    total: num(d.totalPedidoCompra), frete: num(d.frete), desconto: num(d.desconto),
    frete_por_conta: s(d.fretePorConta), observacoes: s(d.observacoes), payload: d,
  });

  const itens = (d.itens ?? []).map((it, i) => ({
    source: SRC, oc_id: int(d.id), seq: i + 1, produto_id: int(it.produto?.id),
    gtin: s(it.gtin), quantidade: num(it.quantidade), preco: num(it.preco), ipi: num(it.ipi),
  }));
  await replaceChildren('oc_itens', 'oc_id', int(d.id), itens);

  const parc = (d.parcelas ?? []).map((p, i) => ({
    source: SRC, oc_id: int(d.id), seq: i + 1, dias: int(p.dias),
    data_vencimento: dt(p.dataVencimento), valor: num(p.valor),
    meio_pagamento: s(p.meioPagamento), observacoes: s(p.observacoes),
  }));
  await replaceChildren('oc_parcelas', 'oc_id', int(d.id), parc);
}

export async function persistOrdemServico(d) {
  await upsert('ordens_servico', {
    source: SRC, source_id: int(d.id), numero: s(d.numeroOrdemServico), situacao: int(d.situacao),
    data: dt(d.data), data_prevista: dt(d.dataPrevista), data_conclusao: dt(d.dataConclusao),
    contato_id: int(d.contato?.id), vendedor_id: int(d.vendedor?.id),
    categoria_id: int(d.categoria?.id), forma_recebimento_id: int(d.formaRecebimento?.id),
    deposito_id: int(d.idDeposito), lista_preco_id: int(d.idListaPreco),
    equipamento: s(d.equipamento), total_servicos: num(d.totalServicos),
    total_pecas: num(d.totalPecas), total: num(d.totalOrdemServico), payload: d,
  });
}

export async function persistSeparacao(d) {
  await upsert('separacoes', {
    source: SRC, source_id: int(d.id), situacao: int(d.situacao),
    venda_id: int(d.venda?.id), nota_id: int(d.notaFiscal?.id), cliente_id: int(d.cliente?.id),
    forma_envio_id: int(d.formaEnvio?.id), usuario_embalador_id: int(d.idUsuarioEmbalador),
    data_criacao: dt(d.dataCriacao), data_separacao: dt(d.dataSeparacao),
    data_checkout: dt(d.dataCheckout), payload: d,
  });
}

export async function persistExpedicaoAgrupamento(d) {
  await upsert('expedicao_agrupamentos', {
    source: SRC, source_id: int(d.id), identificacao: s(d.identificacao),
    data: dt(d.data), forma_envio_id: int(d.formaEnvio?.id), payload: d,
  });
  for (const e of d.expedicoes ?? []) {
    const log = e.logistica ?? {};
    await upsert('expedicoes', {
      source: SRC, source_id: int(e.id), agrupamento_id: int(d.id), situacao: s(e.situacao),
      tipo_objeto: s(e.tipoObjeto), objeto_id: int(e.idObjeto), venda_id: int(e.venda?.id),
      nota_id: int(e.notaFiscal?.id), destinatario_id: int(e.destinatario?.id),
      codigo_rastreio: s(log.codigoRastreio), url_rastreio: s(log.urlRastreio),
      transportador_id: int(log.transportador?.id), forma_frete_id: int(log.formaFrete?.id),
      volume: e.volume ?? null, payload: e,
    });
  }
}

// ---------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------

export async function persistCrmAssunto(d) {
  await upsert('crm_assuntos', {
    source: SRC, source_id: int(d.id), assunto: s(d.assunto), cliente_id: int(d.cliente?.id),
    estagio_id: int(d.estagio?.id), status_crm: s(d.cliente?.statusCrm),
    estrela: bool(d.estrela), arquivado: bool(d.arquivado),
    data: dt(d.data), data_atualizacao: dt(d.dataAtualizacao), payload: d,
  });
  for (const a of d.acoesRecentes?.itens ?? []) {
    await upsert('crm_acoes', {
      source: SRC, source_id: int(a.id), assunto_id: int(d.id), descricao: s(a.descricao),
      tipo_data: s(a.tipoData), data: dt(a.data), data_criacao: dt(a.dataCriacao),
      data_concluida: dt(a.dataConcluida), acao_concluida: bool(a.acaoConcluida),
      usuario_id: int(a.idUsuario?.id), usuario_responsavel_id: int(a.idUsuarioResponsavel?.id),
    });
  }
  for (const an of d.anotacoesRecentes?.itens ?? []) {
    await upsert('crm_anotacoes', {
      source: SRC, source_id: int(an.id), assunto_id: int(d.id), data: dt(an.data),
      anotacao: s(an.anotacao), usuario_id: int(an.usuario?.id),
    });
  }
}

// ---------------------------------------------------------------------
// MARCADORES (genérico p/ pedido/nota/cp/cr/oc/os/crm)
// ---------------------------------------------------------------------

export async function persistMarcadores(objeto, objetoId, marcadores) {
  // ids podem colidir entre tipos de objeto → filtra também por `objeto`.
  await sql.query(
    'DELETE FROM marcadores WHERE source = $1 AND objeto = $2 AND objeto_id = $3',
    [SRC, objeto, int(objetoId)],
  );
  const rows = (marcadores ?? []).map((m) => ({
    source: SRC, objeto, objeto_id: int(objetoId),
    marcador: s(m.descricao ?? m), cor: s(m.cor),
  }));
  await upsertMany('marcadores', rows, null);
}
