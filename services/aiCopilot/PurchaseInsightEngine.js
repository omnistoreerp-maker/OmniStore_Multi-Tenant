(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  function analyze(data){const purchases=data&&data.purchases||[],total=purchases.reduce((s,x)=>s+Number(x.total||0),0),inventory=ns.InventoryInsightEngine.analyze(data);return Object.freeze({totalPurchases:total,averagePurchase:purchases.length?total/purchases.length:0,recommendations:Object.freeze(inventory.lowStock.map(x=>Object.freeze({productId:x.id,product:x.name,suggestedQty:Math.max(0,Number(x.minStock||0)*2-Number(x.stock||0)),reason:'below_minimum_stock'}))),ordersCreated:0,readOnly:true});}
  ns.PurchaseInsightEngine=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
