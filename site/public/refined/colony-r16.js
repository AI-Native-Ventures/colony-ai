(() => {
'use strict';
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),motionButton=document.querySelector('.r-motion-toggle');
let paused=reduced.matches;
function applyMotion(){document.body.classList.toggle('r10-paused',paused);motionButton.textContent=paused?'Resume motion':'Pause motion';motionButton.setAttribute('aria-pressed',String(paused));document.dispatchEvent(new CustomEvent('colony-motion',{detail:{paused}}));}
motionButton.addEventListener('click',()=>{paused=!paused;applyMotion();});reduced.addEventListener('change',()=>{paused=reduced.matches;applyMotion();});
if(!reduced.matches){document.body.classList.add('r10-motion');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('r10-visible');observer.unobserve(e.target);}}),{threshold:.12});document.querySelectorAll('.r10-reveal').forEach(e=>observer.observe(e));}
applyMotion();

document.querySelector('[data-show-campaign]').addEventListener('click',()=>{document.querySelector('[data-tour="social"]').click();document.getElementById('business').scrollIntoView({behavior:paused?'instant':'smooth'});});
})();
