(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  function validate(input){const errors=[];if(!input||!Array.isArray(input.customers))errors.push('CUSTOMERS_ARRAY_REQUIRED');if(!input||!Array.isArray(input.health))errors.push('HEALTH_ARRAY_REQUIRED');return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),readOnly:true});}
  ns.PlatformOperationsValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
