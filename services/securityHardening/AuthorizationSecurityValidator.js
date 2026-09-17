(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  function validate(input){input=input||{};const checks={authentication:Boolean(input.authentication),rbac:Boolean(input.rbac),jwtValidation:Boolean(input.jwtValidation),sessionValidation:Boolean(input.sessionValidation),permissionValidation:Boolean(input.permissionValidation),apiAuthorization:Boolean(input.apiAuthorization),edgeAuthorization:Boolean(input.edgeAuthorization),serviceRoleIsolated:Boolean(input.serviceRoleIsolated)};const failed=Object.keys(checks).filter(k=>!checks[k]);return Object.freeze({valid:!failed.length,checks:Object.freeze(checks),failed:Object.freeze(failed)});}
  ns.AuthorizationSecurityValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
