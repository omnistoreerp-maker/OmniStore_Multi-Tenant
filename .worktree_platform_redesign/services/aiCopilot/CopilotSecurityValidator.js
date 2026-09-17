(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  const BLOCKED=Object.freeze(['execute','delete','insert','update','post','save','deploy','restore','activate','suspend']);
  function validate(text){const q=String(text||'').trim().toLowerCase(),blocked=BLOCKED.find(x=>new RegExp(`\\b${x}\\b`,'i').test(q));return Object.freeze({safe:!blocked,blockedCommand:blocked||null,mode:'read-only',writesAllowed:false});}
  ns.CopilotSecurityValidator=Object.freeze({version:'1.0.0',BLOCKED,validate});
})(typeof globalThis!=='undefined'?globalThis:window);
