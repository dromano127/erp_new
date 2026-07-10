// Roda a sincronização Tiny → Neon.
//
//   node scripts/tiny-sync.mjs full            → carga completa (seção 5.3)
//   node scripts/tiny-sync.mjs incremental     → sync incremental (seção 5.4)
//   node scripts/tiny-sync.mjs <recurso>       → só um recurso, ex.:
//        dimensoes contatos produtos pedidos notas ordem-compra ordem-servico
//        contas-receber contas-pagar separacao expedicao crm estoque
//
// Requer credenciais Tiny + DATABASE_URL (ver .env.example).

import * as S from '../src/connectors/tiny/sync.mjs';

const only = {
  dimensoes: () => S.syncDimensoes(),
  contatos: () => S.syncContatos(),
  produtos: () => S.syncProdutos(),
  pedidos: () => S.syncPedidos(),
  notas: () => S.syncNotas(),
  'ordem-compra': () => S.syncOrdemCompra(),
  'ordem-servico': () => S.syncOrdemServico(),
  'contas-receber': () => S.syncContasReceber(),
  'contas-pagar': () => S.syncContasPagar(),
  separacao: () => S.syncSeparacao(),
  expedicao: () => S.syncExpedicao(),
  crm: () => S.syncCrm(),
  estoque: () => S.syncEstoque(),
};

const mode = process.argv[2] || 'incremental';

try {
  if (mode === 'full') await S.runFull();
  else if (mode === 'incremental') await S.runIncremental();
  else if (only[mode]) await only[mode]();
  else {
    console.error(`Modo desconhecido: ${mode}`);
    console.error('Use: full | incremental | ' + Object.keys(only).join(' | '));
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exit(1);
}
