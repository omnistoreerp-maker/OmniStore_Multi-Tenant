(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'restaurant',name:'المطعم',version:'1.0.0',icon:'🍽️',description:'Menu, kitchen and preparation management.',
  productFields:[
    {key:'kitchen',label:'Kitchen',type:'select',options:['main','grill','bakery','bar','dessert'],required:true,table:true},
    {key:'ingredients',label:'Ingredients',type:'textarea'},{key:'preparation_time',label:'Preparation Time',type:'number',table:true},
    {key:'calories',label:'Calories',type:'number'},{key:'vegetarian',label:'Vegetarian',type:'checkbox'}
  ],
  saleFields:[{key:'table_number',label:'Table Number',type:'text'},{key:'order_type',label:'Order Type',type:'select',options:['dine_in','takeaway','delivery']}],
  validation:{product:[{field:'kitchen',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','kitchen.manage','inventory.adjust','reports.view'],
  dashboardCards:[{id:'restaurant.menu',labelKey:'products',icon:'🍽️',route:'products',metric:'product_count'}],
  reports:[{id:'restaurant.menu',labelKey:'inventory_report',metric:'product_count',route:'reports'},{id:'restaurant.sales',labelKey:'sales_report',metric:'sales_total',route:'reports'}],
  masterData:{categories:['Meals','Sandwiches','Drinks','Desserts','Extras'],brands:[],units:['طبق','وجبة','كوب','قطعة'],tags:['Spicy','Vegetarian','Popular']},
  translations:{ar:{name:'المطعم',kitchen:'المطبخ'},en:{name:'Restaurant',kitchen:'Kitchen'}},
  sampleSettings:{tableService:true,kitchenDisplay:true,defaultPreparationMinutes:15},featureFlags:{kitchen:true,tables:true,delivery:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
