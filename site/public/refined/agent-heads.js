/* Approved 24-head artwork. SVG viewports frame the unchanged source atlas. */
(()=>{
'use strict';
const atlas=new URL('assets/agent-heads-approved-24.png',document.currentScript.src).href;
const fixed={scout:0,aya:5,mina:2,theo:4};
const assignments=new Map(Object.entries(fixed));
const slots=Array.from({length:24},(_,i)=>i).filter(i=>!Object.values(fixed).includes(i));
function hash(id){let h=2166136261;for(const c of String(id)){h=Math.imul(h^c.charCodeAt(0),16777619);}return (h>>>0)%24;}
function index(id){return assignments.has(id)?assignments.get(id):hash(id);}
function register(ids){let n=0;for(const id of ids){if(!assignments.has(id)){assignments.set(id,n<slots.length?slots[n]:hash(id));n++;}}}
let serial=0;
function art(i){i=((i%24)+24)%24;const col=i%6,row=Math.floor(i/6),y=[16,277,506,729][row],height=[226,197,196,230][row],clip='colony-head-crop-'+(++serial);return `<svg class="colony-head-art" viewBox="${col*256+12} ${y} 232 ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><defs><clipPath id="${clip}"><rect x="${col*256+12}" y="${y}" width="232" height="${height}"/></clipPath></defs><image clip-path="url(#${clip})" href="${atlas}" x="0" y="0" width="1536" height="1024"/></svg>`;}
window.ColonyHeads=Object.freeze({index,register,art,count:24});
for(const el of document.querySelectorAll('[data-colony-head]')){el.classList.add('colony-agent-head');el.innerHTML=art(index(el.dataset.colonyHead));}
})();
