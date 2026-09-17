(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  const articles=Object.freeze([
    {id:'dashboard',title:'Dashboard',keywords:['dashboard','لوحة التحكم'],answer:'The dashboard summarizes sales, profit, stock, treasury, and operational alerts.'},
    {id:'reports',title:'Reports',keywords:['reports','report','التقارير','تقرير'],answer:'Reports explain sales, inventory, financial and operational trends. Copilot summaries are advisory only.'},
    {id:'errors',title:'Errors',keywords:['error','errors','خطأ','مشكلة'],answer:'Open the relevant health or error center, read validation details, and avoid retrying destructive actions without verification.'},
    {id:'products',title:'Products',keywords:['products','product','الأصناف','المنتجات'],answer:'Products contain stock, pricing, categories and business-specific fields.'},
    {id:'backup',title:'Backup',keywords:['backup','نسخ احتياطي'],answer:'Backup and recovery centers provide previews unless Controlled Production Mode is explicitly enabled by the platform owner.'},
    {id:'training',title:'Training',keywords:['training','learn','تدريب','تعليم'],answer:'Use the training and customer acceptance checklists to practice workflows safely.'}
  ].map(x=>Object.freeze({...x,keywords:Object.freeze(x.keywords)})));
  function answer(text){const q=String(text||'').toLowerCase(),article=articles.find(x=>x.keywords.some(k=>q.includes(k.toLowerCase())));return Object.freeze(article||{id:'unknown',title:'ERP Help',answer:'Ask about a page, report, error, product, backup, or training workflow.'});}
  ns.KnowledgeCenter=Object.freeze({version:'1.0.0',articles,answer});
})(typeof globalThis!=='undefined'?globalThis:window);
