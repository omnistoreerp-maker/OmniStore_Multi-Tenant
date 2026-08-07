(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  const intents=Object.freeze([
    {id:'low_stock',patterns:['products below minimum stock','low stock items','مخزون منخفض','أقل من الحد الأدنى']},
    {id:'today_sales',patterns:["today's sales",'sales today','مبيعات اليوم']},
    {id:'awaiting_payment',patterns:['invoices awaiting payment','unpaid invoices','فواتير في انتظار الدفع','فواتير غير مدفوعة']},
    {id:'best_sellers',patterns:['best selling products','top products','المنتجات الأكثر مبيعاً','أفضل المنتجات']},
    {id:'inactive_customers',patterns:['inactive customers','عملاء غير نشطين','العملاء غير النشطين']},
    {id:'monthly_profit',patterns:['profit this month','monthly profit','ربح هذا الشهر','أرباح الشهر']},
    {id:'top_supplier',patterns:['most purchased supplier','top supplier','أكثر مورد شراء','أفضل مورد']},
    {id:'dead_stock',patterns:['dead stock','slow moving items','مخزون راكد','أصناف راكدة']},
    {id:'fast_moving',patterns:['fast moving items','fast sellers','أصناف سريعة الحركة']},
    {id:'help',patterns:['help','how to','مساعدة','كيف']}
  ].map(x=>Object.freeze({...x,patterns:Object.freeze(x.patterns)})));
  function detect(text){const q=String(text||'').trim().toLowerCase();let best=null;for(const intent of intents){for(const pattern of intent.patterns){if(q.includes(pattern.toLowerCase())){if(!best||pattern.length>best.pattern.length)best={intent,pattern};}}}return best?Object.freeze({id:best.intent.id,confidence:1,matched:best.pattern}):Object.freeze({id:'unknown',confidence:0,matched:null});}
  ns.IntentRegistry=Object.freeze({version:'1.0.0',intents,detect});
})(typeof globalThis!=='undefined'?globalThis:window);
