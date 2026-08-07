(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  const TASKS=Object.freeze(['aggregation','search-index','report-calculation','image-metadata','data-validation']);
  function plan(task,inputSize){return Object.freeze({valid:TASKS.includes(task),task,inputSize:Math.max(0,Number(inputSize||0)),workerCount:Math.min(4,Math.max(1,Math.ceil(Number(inputSize||0)/25000))),messageTransfer:'structured-clone-preview',workersStarted:0,executed:false});}
  ns.BackgroundWorkerPreview=Object.freeze({version:'1.0.0',TASKS,plan});
})(typeof globalThis!=='undefined'?globalThis:window);
