(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function plan(input){input=input||{};return Object.freeze({strategy:input.strategy||'intersection-observer',rootMargin:input.rootMargin||'300px',threshold:Number(input.threshold||0.01),imageAttribute:'loading=lazy',moduleChunks:Object.freeze(input.moduleChunks||[]),activated:false,domChanged:false,previewOnly:true});}
  ns.LazyLoadingEngine=Object.freeze({version:'1.0.0',plan});
})(typeof globalThis!=='undefined'?globalThis:window);
