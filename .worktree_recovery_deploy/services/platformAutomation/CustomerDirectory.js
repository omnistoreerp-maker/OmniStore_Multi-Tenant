(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const FIELDS=Object.freeze(['id','businessName','status','plan','workspace','owner','email','phone','storage','databaseSize','invoices','activeDevices','lastLogin','lastBackup']);
  function normalize(value){value=value||{};return Object.freeze({id:String(value.id||''),businessName:String(value.businessName||''),status:value.status||'unknown',plan:value.plan||'unknown',workspace:value.workspace||'',owner:value.owner||'',email:value.email||'',phone:value.phone||'',storage:Number(value.storage||0),databaseSize:Number(value.databaseSize||0),invoices:Number(value.invoices||0),activeDevices:Number(value.activeDevices||0),lastLogin:value.lastLogin||null,lastBackup:value.lastBackup||null});}
  function search(values,query){const q=String(query||'').trim().toLowerCase();return Object.freeze((values||[]).map(normalize).filter(x=>!q||[x.businessName,x.owner,x.email,x.phone,x.workspace,x.plan,x.status].some(v=>String(v).toLowerCase().includes(q))));}
  ns.CustomerDirectory=Object.freeze({version:'1.0.0',FIELDS,normalize,search});
})(typeof globalThis!=='undefined'?globalThis:window);
