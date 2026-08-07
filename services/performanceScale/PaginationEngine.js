(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function page(total,pageNumber,pageSize){total=Math.max(0,Number(total||0));pageSize=Math.max(1,Number(pageSize||50));const pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(pages,Math.max(1,Number(pageNumber||1))),offset=(current-1)*pageSize;return Object.freeze({total,page:current,pageSize,pages,offset,limit:Math.min(pageSize,Math.max(0,total-offset)),hasPrevious:current>1,hasNext:current<pages});}
  ns.PaginationEngine=Object.freeze({version:'1.0.0',page});
})(typeof globalThis!=='undefined'?globalThis:window);
