(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'mobile_shop',name:'متجر الموبايل',version:'1.0.0',icon:'📱',description:'IMEI, devices, accessories and warranty.',
  productFields:[
    {key:'imei',label:'IMEI',type:'serial'},{key:'brand',label:'Brand',type:'text',required:true,table:true,storage:'direct'},
    {key:'model',label:'Model',type:'text',required:true,table:true,storage:'direct'},{key:'storage',label:'Storage',type:'select',options:['64GB','128GB','256GB','512GB','1TB']},
    {key:'color',label:'Color',type:'text',storage:'direct'},{key:'condition',label:'Condition',type:'select',options:['new','used','refurbished']},{key:'warranty_months',label:'Warranty',type:'number'}
  ],
  validation:{product:[{field:'brand',rule:'required'},{field:'model',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','imei.manage','repairs.manage','reports.view'],
  dashboardCards:[{id:'mobile.devices',labelKey:'products',icon:'📱',route:'products',metric:'product_count'}],
  reports:[{id:'mobile.devices',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Phones','Tablets','Smart Watches','Accessories','Spare Parts'],brands:['Apple','Samsung','Xiaomi','OPPO'],units:['جهاز','قطعة','كرتونة'],tags:['5G','Dual SIM','New','Used']},
  translations:{ar:{name:'متجر الموبايل',imei:'IMEI'},en:{name:'Mobile Shop',imei:'IMEI'}},
  sampleSettings:{imeiTracking:true,repairsEnabled:true,warrantyEnabled:true},featureFlags:{imei:true,repairs:true,warranty:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
