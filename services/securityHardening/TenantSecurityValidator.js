(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  function validate(input){input=input||{};const checks=Object.freeze({tenantIdValidated:Boolean(input.tenantIdValidated),workspaceOwnership:Boolean(input.workspaceOwnership),crossTenantBlocked:Boolean(input.crossTenantBlocked),urlTamperingRejected:Boolean(input.urlTamperingRejected),requestSpoofingRejected:Boolean(input.requestSpoofingRejected),sessionRotation:Boolean(input.sessionRotation)});const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);return Object.freeze({valid:failed.length===0,checks,failed:Object.freeze(failed),score:Math.round((6-failed.length)/6*100)});}
  ns.TenantSecurityValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
