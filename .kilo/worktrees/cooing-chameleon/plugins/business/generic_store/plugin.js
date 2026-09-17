(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'generic_store',name:'المتجر العام',version:'1.0.0',icon:'🏪',description:'Flexible generic retail schema.',aliases:['general_store','custom'],
  productFields:[
    {key:'barcode',label:'Barcode',type:'barcode',table:true,storage:'direct'},{key:'brand',label:'Brand',type:'text',table:true,storage:'direct'},
    {key:'model',label:'Model',type:'text',storage:'direct'},{key:'unit',label:'Unit',type:'text',storage:'direct'},
    {key:'notes',label:'Product Notes',type:'textarea'}
  ],
  validation:{product:[]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','reports.view'],
  dashboardCards:[{id:'generic.products',labelKey:'products',icon:'🏪',route:'products',metric:'product_count'}],
  reports:[{id:'generic.inventory',labelKey:'inventory_report',metric:'stock_value',route:'reports'},{id:'generic.sales',labelKey:'sales_report',metric:'sales_total',route:'reports'}],
  masterData:{categories:['General','Accessories','Consumables','Services'],brands:[],units:['قطعة','عبوة','كرتونة','خدمة'],tags:['New','Popular','Offer']},
  translations:{ar:{name:'المتجر العام'},en:{name:'Generic Store'}},
  sampleSettings:{flexibleFields:true},featureFlags:{generic:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
