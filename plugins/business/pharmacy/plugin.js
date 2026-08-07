(function(root){'use strict';
root.OmniPluginSDK.register(root.OmniPluginSDK.defineBusinessPlugin({
  id:'pharmacy',name:'الصيدلية',version:'1.0.0',icon:'💊',description:'Batch, expiry, dosage and prescription fields.',
  productFields:[
    {key:'barcode',label:'Barcode',type:'barcode',table:true,storage:'direct'},{key:'batch_number',label:'Batch Number',type:'text',required:true,table:true},
    {key:'expiry_date',label:'Expiry Date',type:'date',required:true,table:true},{key:'dosage',label:'Dosage',type:'text'},
    {key:'active_ingredient',label:'Active Ingredient',type:'text'},{key:'prescription_required',label:'Prescription Required',type:'checkbox'}
  ],
  validation:{product:[{field:'batch_number',rule:'required'},{field:'expiry_date',rule:'required'}]},
  permissions:['products.read','products.write','orders.create','inventory.adjust','batches.manage','reports.view'],
  dashboardCards:[{id:'pharmacy.stock',labelKey:'products',icon:'💊',route:'products',metric:'product_count'}],
  reports:[{id:'pharmacy.expiry',labelKey:'inventory_report',metric:'product_count',route:'reports'}],
  masterData:{categories:['Medicine','Supplements','Skin Care','Baby Care','Medical Supplies'],brands:[],units:['علبة','شريط','زجاجة','قطعة'],tags:['Prescription','OTC','Cold Storage']},
  translations:{ar:{name:'الصيدلية',batch:'التشغيلة'},en:{name:'Pharmacy',batch:'Batch'}},
  sampleSettings:{batchTracking:true,expiryAlerts:true,prescriptionMode:false},featureFlags:{batch:true,expiry:true,prescription:true}
}));
})(typeof globalThis!=='undefined'?globalThis:window);
