/* Embedded prototype focus must never pull the marketing page to another section. */
if(window.parent!==window){
 const focus=HTMLElement.prototype.focus;
 HTMLElement.prototype.focus=function(options){return focus.call(this,{...options,preventScroll:true})};
}
