(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};
  const ITEMS=Object.freeze(['ownerAuthenticated','productionModeExplicit','supabaseHealthy','installerVerified','databaseInstalled','tenantVerified','workspaceVerified','rolesVerified','permissionsVerified','settingsVerified','licenseVerified','loginUrlVerified','rollbackPointVerified']);
  function verify(input){input=input||{};const checks=Object.freeze(Object.fromEntries(ITEMS.map(key=>[key,Boolean(input[key])])));const failed=ITEMS.filter(key=>!checks[key]);return Object.freeze({passed:failed.length===0,score:Math.round((ITEMS.length-failed.length)/ITEMS.length*100),checks,failed:Object.freeze(failed),readOnly:true});}
  ns.ProductionVerification=Object.freeze({version:'1.0.0',ITEMS,verify});
})(typeof globalThis!=='undefined'?globalThis:window);
