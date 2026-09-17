(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  function validate(snapshot){
    const missing=[];
    if(!snapshot||!Array.isArray(snapshot.customers))missing.push('customers');
    if(!snapshot||!snapshot.monitoring||typeof snapshot.monitoring!=='object')missing.push('monitoring');
    if(!snapshot||!snapshot.notifications||typeof snapshot.notifications!=='object')missing.push('notifications');
    if(!snapshot||!Array.isArray(snapshot.jobs))missing.push('jobs');
    if(!snapshot||!Array.isArray(snapshot.apiUsage))missing.push('apiUsage');
    return Object.freeze({valid:missing.length===0,missing:Object.freeze(missing),writesAllowed:false,connectionsOpened:false});
  }
  ns.PlatformAutomationValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
