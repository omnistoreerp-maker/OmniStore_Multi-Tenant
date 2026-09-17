(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  function build(customers,health){
    customers=customers||[];health=health||[];
    const versions={};health.forEach(x=>{versions[x.version]=(versions[x.version]||0)+1;});
    return Object.freeze({totalCustomers:customers.length,activeCustomers:customers.filter(x=>x.status==='active').length,expiredCustomers:customers.filter(x=>x.licenseStatus==='expired').length,onlineWorkspaces:health.filter(x=>x.connectionStatus==='online').length,offlineWorkspaces:health.filter(x=>x.connectionStatus!=='online').length,databaseHealth:health.length?Math.round(health.filter(x=>x.apiHealth==='healthy').length/health.length*100):0,storageUsage:health.length?Math.round(health.reduce((s,x)=>s+x.storageUsage,0)/health.length):0,versionDistribution:Object.freeze(versions)});
  }
  ns.PlatformDashboard=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
