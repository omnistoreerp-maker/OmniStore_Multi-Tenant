(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  const TYPES=Object.freeze(['login','logout','customerProvision','deployment','configurationChange','licenseChange','update','backup']);
  function create(){let events=[];function previewEvent(input){if(!input||!TYPES.includes(input.type))return Object.freeze({valid:false,error:'INVALID_AUDIT_TYPE'});const event=Object.freeze({id:`audit-preview-${events.length+1}`,type:input.type,actorId:String(input.actorId||''),tenantId:String(input.tenantId||''),result:input.result||'preview',occurredAt:input.occurredAt||new Date().toISOString(),metadata:Object.freeze({...input.metadata}),persisted:false});events=[event,...events];return Object.freeze({valid:true,event});}return Object.freeze({previewEvent,list:()=>Object.freeze([...events]),clear:()=>{events=[];return Object.freeze([]);}});}
  ns.CentralAuditEngine=Object.freeze({version:'1.0.0',TYPES,create});
})(typeof globalThis!=='undefined'?globalThis:window);
