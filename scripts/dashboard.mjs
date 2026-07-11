// Gera um dashboard de BI responsivo (HTML self-contained) a partir das views
// do Neon. Reexecute a qualquer momento para atualizar:
//   node scripts/dashboard.mjs           → escreve dashboard.html
//   node scripts/dashboard.mjs saida.html
//
// Sem dependências externas: gráficos são SVG desenhados inline (funciona
// offline, sem CDN). Tema claro/escuro automático. Tooltips no hover.

import { writeFileSync } from 'node:fs';
import { sql } from '../src/lib/db.mjs';

const out = process.argv[2] || 'dashboard.html';
const q = (text, params) => sql.query(text, params);

// "vendas realizadas" = pedidos não cancelados e sem dados incompletos
const VENDA_OK = "situacao_cod NOT IN (2, 8)";

const [
  kpi, porMes, porCanal, porVendedor, topProdFat, topProdMargem, agingCR, estoqueTop,
] = await Promise.all([
  q(`SELECT
       (SELECT COALESCE(SUM(valor_total),0) FROM vw_vendas WHERE ${VENDA_OK})              AS faturamento,
       (SELECT COUNT(*) FROM vw_vendas WHERE ${VENDA_OK})                                   AS pedidos,
       (SELECT COALESCE(SUM(margem_valor),0) FROM vw_vendas_itens)                          AS margem,
       (SELECT COALESCE(SUM(saldo),0) FROM vw_contas_receber WHERE situacao <> 'pago')      AS a_receber,
       (SELECT COALESCE(SUM(saldo),0) FROM vw_contas_pagar   WHERE situacao <> 'pago')      AS a_pagar,
       (SELECT COALESCE(SUM(valor_estoque),0) FROM vw_estoque_atual)                        AS estoque`),
  q(`SELECT ano_mes, SUM(valor_total)::float AS v FROM vw_vendas
     WHERE ${VENDA_OK} AND ano_mes IS NOT NULL GROUP BY 1 ORDER BY 1`),
  q(`SELECT COALESCE(NULLIF(canal_venda,''),'(sem canal)') AS k, SUM(valor_total)::float AS v
     FROM vw_vendas WHERE ${VENDA_OK} GROUP BY 1 ORDER BY v DESC LIMIT 8`),
  q(`SELECT COALESCE(vendedor,'(sem vendedor)') AS k, SUM(valor_total)::float AS v
     FROM vw_vendas WHERE ${VENDA_OK} GROUP BY 1 ORDER BY v DESC LIMIT 8`),
  q(`SELECT COALESCE(produto,'?') AS k, SUM(valor_item)::float AS v
     FROM vw_vendas_itens GROUP BY 1 ORDER BY v DESC LIMIT 10`),
  q(`SELECT COALESCE(produto,'?') AS k, SUM(margem_valor)::float AS v
     FROM vw_vendas_itens GROUP BY 1 ORDER BY v DESC LIMIT 10`),
  q(`SELECT faixa_aging AS k, SUM(saldo)::float AS v FROM vw_contas_receber
     WHERE situacao <> 'pago' GROUP BY 1`),
  q(`SELECT COALESCE(produto,'?') AS k, SUM(valor_estoque)::float AS v
     FROM vw_estoque_atual GROUP BY 1 ORDER BY v DESC LIMIT 10`),
]);

// ordena aging por severidade
const AGING_ORDER = ['A vencer', '1-30 dias', '31-60 dias', '61-90 dias', '90+ dias', 'Sem vencimento'];
const aging = AGING_ORDER
  .map((k) => ({ k, v: Number(agingCR.find((r) => r.k === k)?.v || 0) }))
  .filter((r) => r.v > 0);

const k0 = kpi[0];
const data = {
  kpi: {
    faturamento: Number(k0.faturamento), pedidos: Number(k0.pedidos),
    ticket: Number(k0.pedidos) ? Number(k0.faturamento) / Number(k0.pedidos) : 0,
    margem: Number(k0.margem), a_receber: Number(k0.a_receber),
    a_pagar: Number(k0.a_pagar), estoque: Number(k0.estoque),
  },
  porMes: porMes.map((r) => ({ k: r.ano_mes, v: Number(r.v) })),
  porCanal: porCanal.map((r) => ({ k: r.k, v: Number(r.v) })),
  porVendedor: porVendedor.map((r) => ({ k: r.k, v: Number(r.v) })),
  topProdFat: topProdFat.map((r) => ({ k: r.k, v: Number(r.v) })),
  topProdMargem: topProdMargem.map((r) => ({ k: r.k, v: Number(r.v) })),
  aging,
  estoqueTop: estoqueTop.map((r) => ({ k: r.k, v: Number(r.v) })),
  geradoEm: new Date().toISOString().slice(0, 16).replace('T', ' '),
};

const html = render(data);
writeFileSync(out, html);
console.log(`Dashboard escrito em ${out} (${(html.length / 1024).toFixed(0)} kB)`);
process.exit(0);

// ---------------------------------------------------------------------
function render(d) {
  const json = JSON.stringify(d).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard ERP — FLORIPACAI</title>
<style>
  :root{
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --base:#c3c2b7; --series:#2a78d6; --pos:#006300; --neg:#c0392b;
    --ring:rgba(11,11,11,.10);
  }
  @media (prefers-color-scheme:dark){:root{
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --base:#383835; --series:#3987e5; --pos:#0ca30c; --neg:#e66767;
    --ring:rgba(255,255,255,.10);
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.4}
  .wrap{max-width:1200px;margin:0 auto;padding:20px}
  header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px}
  h1{font-size:20px;margin:0}
  .sub{color:var(--muted);font-size:12px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}
  .kpi{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:14px 16px}
  .kpi .lbl{color:var(--ink2);font-size:12px;margin-bottom:6px}
  .kpi .val{font-size:22px;font-weight:650;letter-spacing:-.01em}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
  .card{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:14px 16px 8px;overflow:hidden}
  .card h2{font-size:13px;margin:0 0 2px;font-weight:600}
  .card .csub{color:var(--muted);font-size:11px;margin-bottom:8px}
  svg{width:100%;height:auto;display:block;overflow:visible}
  .axis{fill:var(--muted);font-size:10px}
  .axis-tab{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
  .lbl-in{fill:var(--ink2);font-size:10px;font-variant-numeric:tabular-nums}
  .bar{fill:var(--series)}
  .gl{stroke:var(--grid);stroke-width:1}
  .foot{color:var(--muted);font-size:11px;margin-top:18px;text-align:center}
  #tt{position:fixed;pointer-events:none;background:var(--ink);color:var(--surface);
    padding:5px 8px;border-radius:6px;font-size:11px;opacity:0;transition:opacity .08s;
    white-space:nowrap;z-index:9;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="wrap">
  <header><h1>Dashboard ERP — FLORIPACAI</h1><span class="sub" id="sub"></span></header>
  <div class="kpis" id="kpis"></div>
  <div class="grid" id="grid"></div>
  <div class="foot">Gerado do Neon em ${d.geradoEm} • rode <code>node scripts/dashboard.mjs</code> para atualizar</div>
</div>
<div id="tt"></div>
<script>
const D=${json};
const brl=n=>'R$ '+(n>=1e6?(n/1e6).toFixed(1)+' mi':n>=1e3?(n/1e3).toFixed(0)+' mil':n.toFixed(0));
const brlFull=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const tt=document.getElementById('tt');
function showTT(e,t){tt.textContent=t;tt.style.opacity=1;moveTT(e)}
function moveTT(e){tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY+12)+'px'}
function hideTT(){tt.style.opacity=0}

document.getElementById('sub').textContent=D.kpi.pedidos.toLocaleString('pt-BR')+' pedidos • atualiza conforme a carga avança';

// KPIs
const kdefs=[
  ['Faturamento',brlFull(D.kpi.faturamento)],
  ['Ticket médio',brlFull(D.kpi.ticket)],
  ['Pedidos',D.kpi.pedidos.toLocaleString('pt-BR')],
  ['Margem bruta',brlFull(D.kpi.margem)],
  ['A receber (aberto)',brlFull(D.kpi.a_receber)],
  ['A pagar (aberto)',brlFull(D.kpi.a_pagar)],
  ['Valor em estoque',brlFull(D.kpi.estoque)],
];
document.getElementById('kpis').innerHTML=kdefs.map(([l,v])=>
  '<div class="kpi"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>').join('');

// helpers de layout
const NS='http://www.w3.org/2000/svg';
function el(n,a){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;}

// gráfico de barras horizontais (categorias) — magnitude, hue único
function barsH(rows,fmt){
  const W=520,rh=26,padL=8,padR=64,padT=6,H=padT*2+rows.length*rh;
  const max=Math.max(...rows.map(r=>r.v),1);
  const labelW=170, plotX=labelW, plotW=W-labelW-padR;
  const svg=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img'});
  rows.forEach((r,i)=>{
    const y=padT+i*rh, bh=16, by=y+(rh-bh)/2;
    const w=Math.max(2,plotW*r.v/max);
    const name=r.k.length>26?r.k.slice(0,25)+'…':r.k;
    const tx=el('text',{x:labelW-8,y:by+bh/2+3,'text-anchor':'end',class:'axis'});tx.textContent=name;svg.appendChild(tx);
    const bar=el('rect',{x:plotX,y:by,width:w,height:bh,rx:4,class:'bar'});
    bar.addEventListener('mousemove',e=>showTT(e,r.k+': '+fmt(r.v)));
    bar.addEventListener('mouseleave',hideTT);
    svg.appendChild(bar);
    const vt=el('text',{x:plotX+w+6,y:by+bh/2+3,class:'lbl-in'});vt.textContent=fmt(r.v);svg.appendChild(vt);
  });
  return svg;
}

// gráfico de linha (série temporal)
function line(rows,fmt){
  const W=520,H=180,padL=44,padR=12,padT=12,padB=24;
  const max=Math.max(...rows.map(r=>r.v),1);
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const x=i=>padL+(rows.length<=1?plotW/2:plotW*i/(rows.length-1));
  const y=v=>padT+plotH*(1-v/max);
  const svg=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img'});
  // gridlines + eixo Y
  for(let g=0;g<=3;g++){const gv=max*g/3,gy=y(gv);
    svg.appendChild(el('line',{x1:padL,y1:gy,x2:W-padR,y2:gy,class:'gl'}));
    const t=el('text',{x:padL-6,y:gy+3,'text-anchor':'end',class:'axis-tab'});t.textContent=fmt(gv);svg.appendChild(t);}
  // path
  const dd=rows.map((r,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(r.v).toFixed(1)).join(' ');
  svg.appendChild(el('path',{d:dd,fill:'none',stroke:'var(--series)','stroke-width':2,'stroke-linejoin':'round'}));
  // marcadores + rótulos X (a cada N)
  const step=Math.ceil(rows.length/8);
  rows.forEach((r,i)=>{
    const cx=x(i),cy=y(r.v);
    const dot=el('circle',{cx,cy,r:3.5,fill:'var(--series)'});
    dot.addEventListener('mousemove',e=>showTT(e,r.k+': '+fmt(r.v)));
    dot.addEventListener('mouseleave',hideTT);
    svg.appendChild(dot);
    if(i%step===0||i===rows.length-1){const t=el('text',{x:cx,y:H-8,'text-anchor':'middle',class:'axis'});t.textContent=r.k;svg.appendChild(t);}
  });
  return svg;
}

function card(title,sub,node){
  const c=document.createElement('div');c.className='card';
  c.innerHTML='<h2>'+title+'</h2><div class="csub">'+sub+'</div>';
  c.appendChild(node);return c;
}
const grid=document.getElementById('grid');
grid.appendChild(card('Faturamento por mês','Pedidos não cancelados',line(D.porMes,brl)));
grid.appendChild(card('Faturamento por canal','Top canais de venda',barsH(D.porCanal,brlFull)));
grid.appendChild(card('Faturamento por vendedor','',barsH(D.porVendedor,brlFull)));
grid.appendChild(card('Top 10 produtos por faturamento','',barsH(D.topProdFat,brlFull)));
grid.appendChild(card('Top 10 produtos por margem','Preço de venda − custo médio',barsH(D.topProdMargem,brlFull)));
if(D.aging.length)grid.appendChild(card('Contas a receber — aging','Saldo em aberto por faixa de atraso',barsH(D.aging,brlFull)));
grid.appendChild(card('Estoque — top 10 por valor','Saldo × custo médio',barsH(D.estoqueTop,brlFull)));
window.addEventListener('mousemove',e=>{if(tt.style.opacity==1)moveTT(e)});
</script>
</body></html>`;
}
