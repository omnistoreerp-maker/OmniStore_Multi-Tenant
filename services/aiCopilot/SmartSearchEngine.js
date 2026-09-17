(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};const day=v=>String(v||'').slice(0,10);
  function search(text,data,now){data=data||{};const intent=ns.IntentRegistry.detect(text),today=day(now||new Date().toISOString()),month=today.slice(0,7);let results=[],summary='';
    if(intent.id==='low_stock')results=(data.products||[]).filter(x=>Number(x.stock||0)<=Number(x.minStock||0));
    if(intent.id==='today_sales')results=(data.sales||[]).filter(x=>day(x.date)===today);
    if(intent.id==='awaiting_payment')results=(data.invoices||[]).filter(x=>x.paymentStatus==='pending'||Number(x.due||0)>0);
    if(intent.id==='best_sellers'||intent.id==='fast_moving')results=[...(data.products||[])].sort((a,b)=>Number(b.soldQty||0)-Number(a.soldQty||0)).slice(0,10);
    if(intent.id==='inactive_customers')results=(data.customers||[]).filter(x=>!x.lastActivity||new Date(x.lastActivity)<new Date(new Date(today).getTime()-90*86400000));
    if(intent.id==='monthly_profit'){const sales=(data.sales||[]).filter(x=>day(x.date).startsWith(month)).reduce((s,x)=>s+Number(x.total||0),0),cost=(data.sales||[]).filter(x=>day(x.date).startsWith(month)).reduce((s,x)=>s+Number(x.cost||0),0),expenses=(data.expenses||[]).filter(x=>day(x.date).startsWith(month)).reduce((s,x)=>s+Number(x.amount||0),0);results=[{sales,cost,expenses,profit:sales-cost-expenses}];}
    if(intent.id==='top_supplier'){const totals={};(data.purchases||[]).forEach(x=>{totals[x.supplierId]=(totals[x.supplierId]||0)+Number(x.total||0);});results=Object.entries(totals).map(([supplierId,total])=>({supplierId,total})).sort((a,b)=>b.total-a.total).slice(0,1);}
    if(intent.id==='dead_stock')results=(data.products||[]).filter(x=>Number(x.stock||0)>0&&Number(x.soldQty||0)===0);
    if(intent.id==='help')summary='Open Knowledge Center or ask about a page, report, error, or workflow.';
    if(intent.id==='unknown')summary='I can analyze stock, sales, unpaid invoices, customers, profit, suppliers, and ERP help.';
    return Object.freeze({query:String(text||''),intent,results:Object.freeze(results.map(x=>Object.freeze({...x}))),count:results.length,summary,readOnly:true,actionsExecuted:0});
  }
  ns.SmartSearchEngine=Object.freeze({version:'1.0.0',search});
})(typeof globalThis!=='undefined'?globalThis:window);
