(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  const areas=Object.freeze(['forms','search','filters','uploads','jsonImports','configurationImports','tenantProvisioning','authentication']);
  function validate(input){input=input||{};const findings=[];areas.forEach(area=>{const value=input[area]||{};if(!value.schemaValidation)findings.push({area,code:'SCHEMA_VALIDATION_REQUIRED'});if(area==='uploads'&&!value.mimeAndSizeValidation)findings.push({area,code:'UPLOAD_VALIDATION_REQUIRED'});if((area==='jsonImports'||area==='configurationImports')&&!value.prototypePollutionBlocked)findings.push({area,code:'SAFE_JSON_MERGE_REQUIRED'});});return Object.freeze({valid:findings.length===0,findings:Object.freeze(findings),areas:areas.length});}
  ns.InputSecurityValidator=Object.freeze({version:'1.0.0',areas,validate});
})(typeof globalThis!=='undefined'?globalThis:window);
