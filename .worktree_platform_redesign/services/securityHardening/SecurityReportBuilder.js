(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  function build(parts){parts=parts||{};const sections=[parts.authorization,parts.tenant,parts.database,parts.inputs,parts.secrets,parts.production].filter(Boolean);const scores=sections.map(x=>x.score!=null?x.score:(x.valid||x.passed||x.ready?100:0));const score=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;return Object.freeze({generatedAt:new Date().toISOString(),score,risk:score>=90?'low':score>=70?'medium':'high',sections:Object.freeze(sections),readOnly:true});}
  ns.SecurityReportBuilder=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
