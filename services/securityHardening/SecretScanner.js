(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  const rules=Object.freeze([
    {id:'service-role',pattern:/service_role\s*[:=]\s*['"`][^'"`]+/i},{id:'jwt',pattern:/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/},
    {id:'secret-key',pattern:/sb_secret_[A-Za-z0-9._-]+/i},{id:'database-url',pattern:/postgres(?:ql)?:\/\/[^\s'"`]+/i},
    {id:'hardcoded-password',pattern:/(?:password|passwd)\s*[:=]\s*['"`](?!password|example|test)[^'"`]{8,}/i}
  ]);
  function scan(files){const findings=[];(files||[]).forEach(file=>rules.forEach(rule=>{if(rule.pattern.test(String(file.content||'')))findings.push(Object.freeze({rule:rule.id,file:file.path||'unknown',severity:'critical'}));}));return Object.freeze({passed:findings.length===0,findings:Object.freeze(findings),filesScanned:(files||[]).length});}
  ns.SecretScanner=Object.freeze({version:'1.0.0',rules,scan});
})(typeof globalThis!=='undefined'?globalThis:window);
