(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'computer_shop',name:'متجر الكمبيوتر',version:'1.0.0',icon:'💻',description:'Computers, components, serials and warranty.',aliases:[],
  productFields:[
    {key:'cpu',label:'CPU',type:'text',table:true},{key:'ram',label:'RAM',type:'text',table:true},
    {key:'ssd',label:'SSD',type:'text'},{key:'gpu',label:'GPU',type:'text'},
    {key:'condition',label:'Condition',type:'select',options:['new','used','refurbished'],required:true},
    {key:'warranty_months',label:'Warranty (months)',type:'number'}
  ],
  validation:{product:[{field:'condition',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','serials.manage','reports.view'],
  sidebar:[{route:'business-plugin-settings',labelKey:'settings',icon:'💻',group:'admin'}],
  dashboardCards:[{id:'computer_shop.stock',labelKey:'products',icon:'💻',route:'products',metric:'product_count'}],
  reports:[{id:'computer_shop.stock',labelKey:'inventory_report',metric:'stock_value',route:'reports'},{id:'computer_shop.sales',labelKey:'sales_report',metric:'sales_total',route:'reports'}],
  masterData:{categories:['Laptops','Desktop','Components','Monitors','Accessories'],brands:['Dell','HP','Lenovo','ASUS'],units:['جهاز','قطعة','كرتونة'],tags:['Gaming','Business','New','Used']},
  translations:{ar:{name:'متجر الكمبيوتر',condition:'الحالة'},en:{name:'Computer Shop',condition:'Condition'}},
  sampleSettings:{serialTracking:true,warrantyEnabled:true,defaultWarrantyMonths:12},
  featureFlags:{serials:true,warranty:true,repairs:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
