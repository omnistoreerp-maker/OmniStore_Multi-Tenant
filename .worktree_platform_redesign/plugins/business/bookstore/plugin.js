(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'bookstore',name:'المكتبة',version:'1.0.0',icon:'📚',description:'ISBN, authors, publishers and genres.',aliases:['book_store'],
  productFields:[
    {key:'isbn',label:'ISBN',type:'barcode',required:true,table:true},{key:'author',label:'Author',type:'text',required:true,table:true},
    {key:'publisher',label:'Publisher',type:'text',table:true},{key:'genre',label:'Genre',type:'select',options:['fiction','non_fiction','education','children','religion','other']},
    {key:'pages',label:'Pages',type:'number'},{key:'book_language',label:'Language',type:'select',options:['ar','en','fr','other']}
  ],
  validation:{product:[{field:'isbn',rule:'required'},{field:'author',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','catalog.manage','reports.view'],
  dashboardCards:[{id:'bookstore.catalog',labelKey:'products',icon:'📚',route:'products',metric:'product_count'}],
  reports:[{id:'bookstore.catalog',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Fiction','Education','Children','Religion','Business','Stationery'],brands:[],units:['كتاب','نسخة','علبة'],tags:['Bestseller','New Release','Arabic','English']},
  translations:{ar:{name:'المكتبة',author:'المؤلف'},en:{name:'Bookstore',author:'Author'}},
  sampleSettings:{isbnRequired:true,authorCatalog:true},featureFlags:{isbn:true,catalog:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
