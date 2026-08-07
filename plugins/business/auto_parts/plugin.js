(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'auto_parts',name:'قطع غيار السيارات',version:'1.0.0',icon:'🚗',description:'OEM parts and vehicle compatibility.',aliases:['auto_accessories','car_parts','car_accessories'],
  productFields:[
    {key:'oem',label:'OEM',type:'text',required:true,table:true},{key:'brand',label:'Brand',type:'text',required:true,table:true,storage:'direct'},
    {key:'model',label:'Model',type:'text',storage:'direct'},{key:'year',label:'Year',type:'text'},
    {key:'engine',label:'Engine',type:'text'},{key:'compatibility',label:'Compatibility',type:'textarea',required:true}
  ],
  validation:{product:[{field:'oem',rule:'required'},{field:'brand',rule:'required'},{field:'compatibility',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','compatibility.manage','reports.view'],
  dashboardCards:[{id:'auto_parts.stock',labelKey:'products',icon:'🚗',route:'products',metric:'product_count'}],
  reports:[{id:'auto_parts.compatibility',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Engine','Brakes','Suspension','Electrical','Filters'],brands:['Toyota','Hyundai','Kia','Bosch'],units:['قطعة','طقم','علبة'],tags:['OEM','Aftermarket','Fast Moving']},
  translations:{ar:{name:'قطع غيار السيارات',compatibility:'التوافق'},en:{name:'Auto Parts',compatibility:'Compatibility'}},
  sampleSettings:{oemRequired:true,vehicleCompatibility:true},featureFlags:{vehicleCompatibility:true,oem:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
