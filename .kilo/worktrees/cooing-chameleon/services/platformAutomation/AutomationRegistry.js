(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const definitions=Object.freeze([
    {id:'health-check',name:'Automatic Health Check',schedule:'*/5 * * * *'},
    {id:'backup-schedule',name:'Automatic Backup Schedule',schedule:'0 2 * * *'},
    {id:'license-validation',name:'Automatic License Validation',schedule:'0 */6 * * *'},
    {id:'storage-cleanup',name:'Automatic Storage Cleanup Preview',schedule:'0 3 * * 0'},
    {id:'database-optimization',name:'Automatic Database Optimization Preview',schedule:'0 4 * * 0'},
    {id:'update-checker',name:'Automatic Update Checker',schedule:'0 */12 * * *'}
  ].map(x=>Object.freeze({...x,executionEnabled:false})));
  ns.AutomationRegistry=Object.freeze({version:'1.0.0',definitions,get:id=>definitions.find(x=>x.id===id)||null});
})(typeof globalThis!=='undefined'?globalThis:window);
