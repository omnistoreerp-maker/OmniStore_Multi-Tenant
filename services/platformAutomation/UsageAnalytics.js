(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  function build(customers,api){customers=customers||[];api=api||[];return Object.freeze({storageBytes:customers.reduce((s,x)=>s+Number(x.storage||0),0),databaseBytes:customers.reduce((s,x)=>s+Number(x.databaseSize||0),0),apiRequests:api.reduce((s,x)=>s+Number(x.requests||0),0),edgeInvocations:api.reduce((s,x)=>s+Number(x.edgeInvocations||0),0),activeDevices:customers.reduce((s,x)=>s+Number(x.activeDevices||0),0),readOnly:true});}
  ns.UsageAnalytics=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
