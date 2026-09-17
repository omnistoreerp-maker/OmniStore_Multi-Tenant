(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const ACTIONS=Object.freeze(['create','suspend','activate','resetPassword','resetLicense','generateInvite','openWorkspace','openLogs','backup','restore','export','clone','delete']);
  const DESTRUCTIVE=Object.freeze(['suspend','resetPassword','resetLicense','restore','clone','delete']);
  function plan(action,input){input=input||{};if(!ACTIONS.includes(action))return Object.freeze({valid:false,error:'UNSUPPORTED_CUSTOMER_ACTION'});const tenantId=String(input.tenantId||'');if(action!=='create'&&!tenantId)return Object.freeze({valid:false,error:'TENANT_ID_REQUIRED'});const confirmation=action==='delete'?`DELETE_CUSTOMER:${tenantId}`:null;return Object.freeze({valid:true,action,tenantId,destructive:DESTRUCTIVE.includes(action),requiresConfirmation:DESTRUCTIVE.includes(action),confirmation,steps:Object.freeze(action==='create'?['validate input','prepare onboarding workflow','await future authorized executor']:['validate platform owner','validate tenant scope',`preview ${action}`,'await future authorized executor']),executed:false,writes:0,previewOnly:true});}
  function confirm(planValue,text){return Object.freeze({valid:Boolean(planValue&&planValue.valid&&planValue.action==='delete'&&text===planValue.confirmation),executed:false});}
  ns.CustomerActionPlanner=Object.freeze({version:'1.0.0',ACTIONS,DESTRUCTIVE,plan,confirm});
})(typeof globalThis!=='undefined'?globalThis:window);
