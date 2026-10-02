(()=>{
'use strict';
const inputs=new WeakMap();
// Handles are free-form in Colony. Match whole @handles, never part of an email.
const pattern=()=>/(?<![\p{L}\p{N}_@])@[\p{L}][\p{L}\p{N}_-]*/gu;
function fragments(text){
 const out=document.createDocumentFragment();let last=0;
 for(const match of text.matchAll(pattern())){
  out.append(document.createTextNode(text.slice(last,match.index)));
  const mark=document.createElement('span');mark.className='colony-mention';mark.textContent=match[0];out.append(mark);last=match.index+match[0].length;
 }
 out.append(document.createTextNode(text.slice(last)));return out;
}
function sync(input){
 const item=inputs.get(input);if(!item)return;
 const style=getComputedStyle(input),mobile=input.matches('#phone .composer textarea');
 if(mobile){
  const padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
  const cap=parseFloat(style.lineHeight)*5+padding;
  input.style.height='0px';const needed=input.scrollHeight;
  input.style.height=Math.max(44,Math.min(needed,cap))+'px';
  input.style.overflowY=needed>cap?'auto':'hidden';
 }
 const now=getComputedStyle(input);
 for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','padding','textIndent','textTransform','tabSize','wordSpacing','boxSizing'])item.text.style[property]=now[property];
 item.mirror.style.top=now.borderTopWidth;item.mirror.style.left=now.borderLeftWidth;
 item.text.style.width=input.clientWidth+'px';
 item.wrap.classList.toggle('has-text',!!input.value);
 if(item.value!==input.value){item.value=input.value;item.text.replaceChildren(fragments(input.value+'\u200b'));}
 item.text.style.transform=`translateY(${-input.scrollTop}px)`;
}
function setup(input){
 if(inputs.has(input))return;
 const wrap=document.createElement('div');wrap.className='mention-editor';
 const mirror=document.createElement('div');mirror.className='mention-mirror';mirror.setAttribute('aria-hidden','true');
 const text=document.createElement('div');text.className='mention-mirror-text';mirror.append(text);
 input.before(wrap);wrap.append(mirror,input);inputs.set(input,{wrap,mirror,text,value:null});
 input.addEventListener('input',()=>sync(input));input.addEventListener('scroll',()=>syncScroll(input));
 input.addEventListener('focus',()=>sync(input));input.addEventListener('change',()=>sync(input));
 new ResizeObserver(()=>sync(input)).observe(wrap);sync(input);
}
function syncScroll(input){const item=inputs.get(input);if(item)item.text.style.transform=`translateY(${-input.scrollTop}px)`;}
function scan(){
 document.querySelectorAll('.composer textarea,#sf-comment,[data-m-field="post-feedback"],[data-m-field="agent-prompt"]').forEach(input=>{setup(input);sync(input);});
 document.querySelectorAll('.message p,.demo-chat p,.r10-messages p,.feedback-list p,.sf-feedback p').forEach(p=>{
  const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode()){const node=walker.currentNode;if(!node.parentElement.closest('.colony-mention,.mention,.showcase-mention')&&pattern().test(node.textContent))nodes.push(node);}
  nodes.forEach(node=>node.replaceWith(fragments(node.textContent)));
 });
}
let queued=false;
function observeBody(){
 const body=document.body;
 if(!body){document.addEventListener('DOMContentLoaded',observeBody,{once:true});return;}
 new MutationObserver(records=>{
  if(records.every(record=>record.target.parentElement?.closest('.mention-editor')))return;
  if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;scan();});}
 }).observe(body,{childList:true,subtree:true});
 scan();
}
observeBody();
})();
