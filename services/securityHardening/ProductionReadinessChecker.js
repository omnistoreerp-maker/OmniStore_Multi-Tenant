(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  const ITEMS=Object.freeze(['https','csp','securityHeaders','compression','caching','serviceWorker','manifest','offlineMode','errorBoundaries','rateLimiting']);
  function check(input){input=input||{};const values=Object.fromEntries(ITEMS.map(k=>[k,Boolean(input[k])]));const missing=ITEMS.filter(k=>!values[k]);return Object.freeze({ready:missing.length===0,score:Math.round((ITEMS.length-missing.length)/ITEMS.length*100),checks:Object.freeze(values),missing:Object.freeze(missing)});}
  ns.ProductionReadinessChecker=Object.freeze({version:'1.0.0',ITEMS,check});
})(typeof globalThis!=='undefined'?globalThis:window);
