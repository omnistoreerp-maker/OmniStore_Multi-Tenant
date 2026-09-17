(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'clothes',name:'الملابس',version:'1.0.0',icon:'👕',description:'Sizes, colors, materials and seasonal collections.',aliases:['fashion'],
  productFields:[
    {key:'sku',label:'SKU',type:'barcode',table:true},{key:'brand',label:'Brand',type:'text',table:true,storage:'direct'},
    {key:'size',label:'Size',type:'select',options:['XS','S','M','L','XL','XXL'],required:true,table:true,storage:'direct'},
    {key:'color',label:'Color',type:'text',required:true,storage:'direct'},{key:'material',label:'Material',type:'text'},
    {key:'season',label:'Season',type:'select',options:['summer','winter','all_season']}
  ],
  validation:{product:[{field:'size',rule:'required'},{field:'color',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','variants.manage','reports.view'],
  dashboardCards:[{id:'clothes.variants',labelKey:'products',icon:'👕',route:'products',metric:'product_count'}],
  reports:[{id:'clothes.variants',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Men','Women','Kids','Shoes','Bags','Accessories'],brands:[],units:['قطعة','زوج','طقم'],tags:['Summer','Winter','Sale','New Collection']},
  translations:{ar:{name:'الملابس',size:'المقاس'},en:{name:'Clothes',size:'Size'}},
  sampleSettings:{variantMatrix:true,seasonalCollections:true},featureFlags:{variants:true,sizes:true,colors:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
