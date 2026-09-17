(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const TYPES=Object.freeze(['systemAlerts','expiredLicenses','storageWarnings','failedBackups','deploymentErrors','databaseHealth','apiErrors','edgeFunctionErrors']);
  function aggregate(input){input=input||{};const groups=Object.freeze(Object.fromEntries(TYPES.map(key=>[key,Object.freeze(input[key]||[])])));return Object.freeze({groups,total:TYPES.reduce((sum,key)=>sum+groups[key].length,0),sent:0,previewOnly:true});}
  ns.PlatformNotificationAggregator=Object.freeze({version:'1.0.0',TYPES,aggregate});
})(typeof globalThis!=='undefined'?globalThis:window);
