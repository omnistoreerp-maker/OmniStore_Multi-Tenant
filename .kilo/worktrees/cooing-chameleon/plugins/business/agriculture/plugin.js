(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'agriculture',name:'الزراعة',version:'1.0.0',icon:'🌾',description:'Crops, varieties, seasons, harvest and grades.',
  productFields:[
    {key:'crop',label:'Crop',type:'text',required:true,table:true},{key:'variety',label:'Variety',type:'text',required:true,table:true},
    {key:'season',label:'Season',type:'select',options:['summer','winter','perennial'],table:true},
    {key:'harvest_date',label:'Harvest Date',type:'date'},{key:'grade',label:'Grade',type:'select',options:['A','B','C']},
    {key:'weight',label:'Weight',type:'number'},{key:'unit',label:'Unit',type:'select',options:['kg','ton','box','bag'],storage:'direct'}
  ],
  validation:{product:[{field:'crop',rule:'required'},{field:'variety',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','harvest.manage','reports.view'],
  dashboardCards:[{id:'agriculture.crops',labelKey:'products',icon:'🌾',route:'products',metric:'product_count'}],
  reports:[{id:'agriculture.harvest',labelKey:'inventory_report',metric:'stock_value',route:'reports'}],
  masterData:{categories:['Seeds','Crops','Fertilizers','Tools','Animal Feed'],brands:[],units:['كجم','طن','صندوق','شوال'],tags:['Organic','Seasonal','Local','Export']},
  translations:{ar:{name:'الزراعة',harvest:'الحصاد'},en:{name:'Agriculture',harvest:'Harvest'}},
  sampleSettings:{harvestTracking:true,gradeTracking:true,weightPrecision:2},featureFlags:{harvest:true,grading:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
