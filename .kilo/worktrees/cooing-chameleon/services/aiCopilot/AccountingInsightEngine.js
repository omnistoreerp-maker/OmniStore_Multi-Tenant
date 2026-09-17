(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  function analyze(data){const sales=(data&&data.sales||[]).reduce((s,x)=>s+Number(x.total||0),0),cost=(data&&data.sales||[]).reduce((s,x)=>s+Number(x.cost||0),0),expenses=(data&&data.expenses||[]).reduce((s,x)=>s+Number(x.amount||0),0);return Object.freeze({revenue:sales,costOfSales:cost,grossProfit:sales-cost,expenses,netProfit:sales-cost-expenses,expenseAnalysis:Object.freeze((data&&data.expenses||[]).map(x=>Object.freeze({category:x.category||'other',amount:Number(x.amount||0)}))),officialStatement:false,postingPerformed:false,readOnly:true});}
  ns.AccountingInsightEngine=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
