(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  const controls=Object.freeze([
    {id:'auth.jwt',area:'authentication',required:true},{id:'auth.rbac',area:'authorization',required:true},{id:'tenant.rls',area:'tenant',required:true},
    {id:'tenant.workspace',area:'tenant',required:true},{id:'api.authorization',area:'api',required:true},{id:'edge.authorization',area:'edge',required:true},
    {id:'storage.policies',area:'storage',required:true},{id:'realtime.policies',area:'realtime',required:true},{id:'secrets.serverOnly',area:'secrets',required:true},
    {id:'session.validation',area:'session',required:true},{id:'permissions.validation',area:'authorization',required:true},{id:'rateLimit.ready',area:'production',required:true}
  ]);
  ns.SecurityPolicyRegistry=Object.freeze({version:'1.0.0',controls,required:()=>controls.filter(x=>x.required)});
})(typeof globalThis!=='undefined'?globalThis:window);
