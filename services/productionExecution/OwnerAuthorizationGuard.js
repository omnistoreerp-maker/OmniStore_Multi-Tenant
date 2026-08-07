(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function validate(session){const errors=[];if(!session||!session.accessToken)errors.push('OWNER_SESSION_REQUIRED');if(!session||session.platformRole!=='erp_owner')errors.push('ERP_OWNER_ROLE_REQUIRED');if(!session||!session.userId)errors.push('OWNER_USER_ID_REQUIRED');return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),ownerId:session&&session.userId||null});}
  ns.OwnerAuthorizationGuard=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
