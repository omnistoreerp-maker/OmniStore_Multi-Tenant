(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  function review(input){input=input||{};const required=['rlsPolicies','indexes','constraints','foreignKeys','triggers','functions','migrationIntegrity'];const checks=Object.fromEntries(required.map(k=>[k,Boolean(input[k])]));const failed=required.filter(k=>!checks[k]);return Object.freeze({valid:failed.length===0,checks:Object.freeze(checks),failed:Object.freeze(failed),reviewOnly:true,sqlExecuted:false});}
  ns.DatabaseSecurityReviewer=Object.freeze({version:'1.0.0',review});
})(typeof globalThis!=='undefined'?globalThis:window);
