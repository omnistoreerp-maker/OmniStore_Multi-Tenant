(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function plan(total,chunkSize){total=Math.max(0,Number(total||0));chunkSize=Math.max(1,Number(chunkSize||500));const chunks=Math.ceil(total/chunkSize);return Object.freeze({total,chunkSize,chunks,estimatedFrames:chunks,itemsAllocated:0,rendered:0,scheduler:'requestIdleCallback-preview',previewOnly:true});}
  ns.ChunkedRenderingEngine=Object.freeze({version:'1.0.0',plan});
})(typeof globalThis!=='undefined'?globalThis:window);
