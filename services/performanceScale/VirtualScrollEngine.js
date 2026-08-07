(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function windowFor(input){input=input||{};const total=Math.max(0,Number(input.totalItems||0)),height=Math.max(1,Number(input.itemHeight||40)),viewport=Math.max(1,Number(input.viewportHeight||600)),scroll=Math.max(0,Number(input.scrollTop||0)),overscan=Math.max(0,Number(input.overscan||5));const visible=Math.ceil(viewport/height),start=Math.max(0,Math.floor(scroll/height)-overscan),end=Math.min(total,start+visible+overscan*2);return Object.freeze({totalItems:total,start,end,count:Math.max(0,end-start),offsetTop:start*height,totalHeight:total*height,itemsAllocated:0,readOnly:true});}
  ns.VirtualScrollEngine=Object.freeze({version:'1.0.0',windowFor});
})(typeof globalThis!=='undefined'?globalThis:window);
