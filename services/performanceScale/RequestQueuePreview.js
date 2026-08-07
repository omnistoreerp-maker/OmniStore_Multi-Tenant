(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function analyze(input){input=input||{};const pending=Math.max(0,Number(input.pending||0)),concurrency=Math.max(1,Number(input.concurrency||6)),average=Math.max(0,Number(input.averageLatencyMs||0));return Object.freeze({pending,concurrency,batches:Math.ceil(pending/concurrency),estimatedDrainMs:Math.ceil(pending/concurrency)*average,retryStrategy:'exponential-backoff-with-jitter',rateLimitReady:true,requestsSent:0,previewOnly:true});}
  ns.RequestQueuePreview=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
