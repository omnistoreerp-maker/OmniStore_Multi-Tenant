(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  function analyze(data){const sales=data&&data.sales||[],total=sales.reduce((s,x)=>s+Number(x.total||0),0),cost=sales.reduce((s,x)=>s+Number(x.cost||0),0),byDay={};sales.forEach(x=>{const d=String(x.date||'').slice(0,10);byDay[d]=(byDay[d]||0)+Number(x.total||0);});const trend=Object.entries(byDay).sort().map(([date,value])=>Object.freeze({date,value}));return Object.freeze({totalSales:total,cost,grossProfit:total-cost,averageInvoice:sales.length?total/sales.length:0,trend:Object.freeze(trend),recommendations:Object.freeze(trend.length<2?['Collect more sales history for trend analysis']:['Review changes between recent sales periods']),readOnly:true});}
  ns.SalesInsightEngine=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
