(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function create(){let state=Object.freeze({enabled:false,serverEnabled:false,ownerVerified:false,enabledAt:null,enabledBy:null,persistedInBrowser:false});return Object.freeze({snapshot:()=>state,applyServerStatus:value=>{state=Object.freeze({enabled:Boolean(value&&value.enabled),serverEnabled:Boolean(value&&value.serverEnabled),ownerVerified:Boolean(value&&value.ownerVerified),enabledAt:value&&value.enabledAt||null,enabledBy:value&&value.enabledBy||null,persistedInBrowser:false});return state;},reset:()=>{state=Object.freeze({enabled:false,serverEnabled:false,ownerVerified:false,enabledAt:null,enabledBy:null,persistedInBrowser:false});return state;}});}
  ns.ProductionModeConfiguration=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
