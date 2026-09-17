(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'jewelry',name:'المجوهرات',version:'1.0.0',icon:'💍',description:'Metal, purity, weight, gemstones and certificates.',
  productFields:[
    {key:'sku',label:'SKU',type:'barcode',required:true,table:true},{key:'metal',label:'Metal',type:'select',options:['gold','silver','platinum','other'],required:true,table:true},
    {key:'purity',label:'Purity',type:'select',options:['24K','22K','21K','18K','925'],required:true,table:true},
    {key:'weight_grams',label:'Weight (g)',type:'number',required:true},{key:'gemstone',label:'Gemstone',type:'text'},
    {key:'certificate_number',label:'Certificate Number',type:'text'}
  ],
  validation:{product:[{field:'sku',rule:'required'},{field:'metal',rule:'required'},{field:'purity',rule:'required'},{field:'weight_grams',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','certificates.manage','reports.view'],
  dashboardCards:[{id:'jewelry.stock',labelKey:'products',icon:'💍',route:'products',metric:'stock_value'}],
  reports:[{id:'jewelry.valuation',labelKey:'inventory_report',metric:'stock_value',route:'reports'}],
  masterData:{categories:['Rings','Necklaces','Bracelets','Earrings','Coins'],brands:[],units:['قطعة','جرام','طقم'],tags:['Gold','Silver','Certified','Handmade']},
  translations:{ar:{name:'المجوهرات',purity:'العيار'},en:{name:'Jewelry',purity:'Purity'}},
  sampleSettings:{liveMetalPrice:false,certificateTracking:true,weightPrecision:3},featureFlags:{purity:true,weight:true,certificates:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
