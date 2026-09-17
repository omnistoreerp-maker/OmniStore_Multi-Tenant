(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'supermarket',name:'السوبر ماركت',version:'1.0.0',icon:'🛒',description:'Barcode, weight, expiry and fast retail.',aliases:['grocery'],
  productFields:[
    {key:'barcode',label:'Barcode',type:'barcode',required:true,table:true,storage:'direct'},
    {key:'weight',label:'Weight',type:'number',table:true},{key:'unit',label:'Unit',type:'select',options:['piece','kg','gram','liter','pack'],storage:'direct'},
    {key:'expiry_date',label:'Expiry Date',type:'date'},{key:'brand',label:'Brand',type:'text',storage:'direct'}
  ],
  validation:{product:[{field:'barcode',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','barcode.manage','reports.view'],
  dashboardCards:[{id:'supermarket.products',labelKey:'products',icon:'🛒',route:'products',metric:'product_count'}],
  reports:[{id:'supermarket.expiry',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Food','Beverages','Dairy','Frozen','Cleaning'],brands:[],units:['قطعة','كجم','جرام','لتر','عبوة'],tags:['Offer','Imported','Organic','Fast Moving']},
  translations:{ar:{name:'السوبر ماركت',expiry:'الصلاحية'},en:{name:'Supermarket',expiry:'Expiry'}},
  sampleSettings:{weightedProducts:true,expiryAlerts:true,autoBarcode:true},featureFlags:{barcode:true,expiry:true,weightedProducts:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
