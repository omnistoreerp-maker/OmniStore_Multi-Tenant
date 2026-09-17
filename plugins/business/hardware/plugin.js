(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'hardware',name:'الأدوات والمعدات',version:'1.0.0',icon:'🛠️',description:'Tools, materials, measurements and specifications.',
  productFields:[
    {key:'part_number',label:'Part Number',type:'text',table:true},{key:'barcode',label:'Barcode',type:'barcode',storage:'direct'},
    {key:'brand',label:'Brand',type:'text',table:true,storage:'direct'},{key:'material',label:'Material',type:'text'},
    {key:'unit',label:'Unit',type:'select',options:['piece','meter','kg','box'],required:true,storage:'direct'},
    {key:'specification',label:'Specification',type:'textarea'}
  ],
  validation:{product:[{field:'unit',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','measurements.manage','reports.view'],
  dashboardCards:[{id:'hardware.stock',labelKey:'products',icon:'🛠️',route:'products',metric:'product_count'}],
  reports:[{id:'hardware.stock',labelKey:'inventory_report',metric:'stock_value',route:'reports'}],
  masterData:{categories:['Hand Tools','Power Tools','Fasteners','Electrical','Plumbing','Safety'],brands:['Bosch','Stanley','Makita','DeWalt'],units:['قطعة','متر','كجم','علبة'],tags:['Professional','Industrial','Heavy Duty']},
  translations:{ar:{name:'الأدوات والمعدات',specification:'المواصفات'},en:{name:'Hardware',specification:'Specification'}},
  sampleSettings:{measurementUnits:true,bulkPricing:false},featureFlags:{measurements:true,specifications:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
