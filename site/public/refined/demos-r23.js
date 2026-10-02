(()=>{
'use strict';
const reduced=matchMedia('(prefers-reduced-motion:reduce)'),mobile=matchMedia('(max-width:700px)');
for(const section of document.querySelectorAll('[data-demo]')){
 const frame=section.querySelector('iframe'),device=section.querySelector('.r12-device'),play=section.querySelector('[data-demo-play]'),replay=section.querySelector('[data-demo-replay]'),tabs=[...section.querySelectorAll('[data-tour]')];
 let key=section.dataset.demo,state='idle',ready=false,visible=false,pending=false,loading=true;
 const send=(type,extra={})=>frame.contentWindow?.postMessage({type,...extra},location.origin);
 const allowed=()=>!document.hidden&&!reduced.matches&&!document.body.classList.contains('r10-paused');
 const resize=()=>{frame.style.width=mobile.matches?'100%':'1360px';frame.style.height=mobile.matches?'100%':'805px';frame.style.transform=mobile.matches?'none':`scale(${frame.parentElement.clientWidth/1360})`;};
 new ResizeObserver(resize).observe(frame.parentElement);
 function paint(){const label=state==='playing'?'Pause demo':state==='paused'?'Resume demo':state==='ended'?'Replay demo':state==='error'?'Retry demo':'Play demo';play.innerHTML=label+' <span aria-hidden="true">'+(state==='playing'?'Ⅱ':state==='ended'?'↻':'▶')+'</span>';play.setAttribute('aria-label',label+' · '+(section.id==='product'?'collaboration':key));play.setAttribute('aria-pressed',String(state==='playing'));play.disabled=!ready;replay.disabled=!ready;section.dataset.playback=state;}
 function pause(){if(state==='playing')send('demo-pause');}
 function restart(){pending=true;if(!ready)return;send('demo-select',{key});state='idle';if(allowed()){send('demo-play');state='playing';pending=false;}paint();}
 function choose(next){key=next;section.dataset.demo=key;tabs.forEach(t=>{const selected=t.dataset.tour===key;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});section.querySelector('[role="tabpanel"]')?.setAttribute('aria-labelledby','tour-'+key);restart();}
 play.addEventListener('click',()=>{pending=false;if(state==='playing')pause();else send('demo-play');});
 replay.addEventListener('click',()=>{pending=false;send('demo-replay');});
 tabs.forEach((t,i)=>{t.addEventListener('click',()=>choose(t.dataset.tour));t.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=tabs.length-1;if(n!==undefined){e.preventDefault();tabs[n].focus();choose(tabs[n].dataset.tour);}});});
 addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const d=e.data;if(d?.type==='demo-ready'&&!ready&&!loading){ready=true;if(visible||pending)restart();else{send('demo-select',{key});paint();}}if(d?.type==='demo-status'&&d.key===key){state=d.state;paint();}if(d?.type==='demo-error'){play.title=d.message;console.error(d.message);}});
 frame.addEventListener('load',()=>{loading=false;send('demo-ping');});
 function loadFormat(){ready=false;loading=true;state='idle';pending=visible;section.dataset.format=mobile.matches?'phone':'laptop';frame.src=mobile.matches?'../product-reference/mobile-r21/demo-r23.html?demo='+key:frame.dataset.desktopSrc.replace(/demo=[^&#]+/,'demo='+key);frame.title=mobile.matches?'Colony mobile app demonstration':'Colony desktop app demonstration';resize();paint();}
 mobile.addEventListener('change',loadFormat);loadFormat();
 // Enter at 25%; only rearm once fully outside, avoiding scroll-boundary resets.
 new IntersectionObserver(entries=>{const e=entries[0];if(!e.isIntersecting){visible=false;pending=false;pause();}else if(e.intersectionRatio>=.25&&!visible){visible=true;restart();}},{threshold:[0,.25]}).observe(device);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 document.addEventListener('colony-motion',()=>{if(!allowed())pause();else if(visible&&pending)restart();});
 reduced.addEventListener('change',()=>{if(reduced.matches)pause();});
 paint();
}
})();
