/* Guided taps over the existing mobile design handoff. All data is local sample state. */
(()=>{
'use strict';
const keys=['customers','website','social','money','agents'];
let key=new URLSearchParams(location.search).get('demo')||'social',generation=0,playing=false,phase='idle',feed=[],proposalApproved=false;
const seed={web:structuredClone(WEB),social:structuredClone(SO),agents:structuredClone(AG),money:structuredClone(MO),leads:structuredClone(dLeads)};
const names={scout:['Scout','AI Coordinator'],aya:['Aya','AI Researcher'],mina:['Mina','AI Designer'],theo:['Theo','AI Operations'],human:['Lerato','Human · Founder']};
ColonyHeads.register(AG.agents.map(a=>a.name.toLowerCase()));
const touch=document.createElement('div');touch.className='demo-touch';touch.setAttribute('popover','manual');touch.setAttribute('aria-hidden','true');document.body.append(touch);
const send=(type,extra={})=>parent.postMessage({type,key,formFactor:'phone',...extra},location.origin);
function status(value){phase=value;document.body.dataset.demoState=value;send('demo-status',{state:value});}
function wait(ms,token){return new Promise((resolve,reject)=>{let elapsed=0,last=performance.now();function tick(now){if(token!==generation){reject(Error('cancelled'));return;}if(playing)elapsed+=Math.min(80,now-last);last=now;if(elapsed>=ms)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});}
function prose(text){return escape(text).replace(/@(Scout|Aya|Mina|Theo|Lerato)/g,'<b class="mention">@$1</b>');}
function row(item){const [name,role]=names[item.id];const avatar=item.id==='human'?av('LM'):`<span class="colony-agent-head" aria-hidden="true">${ColonyHeads.art(ColonyHeads.index(item.id))}</span>`;return `<article class="message">${avatar}<div class="body"><div class="byline"><strong>${name}</strong><span class="${item.id==='human'?'human':'agent'}-label">${role}</span></div><p>${prose(item.text)}</p>${item.route?`<button class="mobile-record" data-route="${proposalApproved&&item.route==='agents/proposal'?'agents/detail':item.route}">${icon(item.icon||'file')}<span><strong>${item.title}</strong><small>${proposalApproved&&item.route==='agents/proposal'?'Approved · Added to your team':item.sub||'Ready for your review'}</small></span>${icon('arrow')}</button>`:''}</div></article>`;}

const proposalPrompt='Handle client briefs and prepare follow-ups. Ask @Scout for priorities and @Theo to check delivery details. Get approval before contacting clients.';
const proposalEdit=' Summarise open client requests every Friday.';
const proposalText=()=>M.draft['proposal-prompt']??proposalPrompt;
mRoute('agents/proposal','Review agent proposal',()=>mPage('Review new agent',`
 <div class="m-row-head"><span class="colony-agent-head" aria-hidden="true">${ColonyHeads.art(ColonyHeads.index('nori'))}</span><div><h1>Nori</h1><p>Prepared by Scout · Checked by Theo</p></div></div>
 ${mf('Name','proposal-name',M.draft['proposal-name']??'Nori')}
 ${mf('Responsibility','proposal-role',M.draft['proposal-role']??'Client success')}
 <section class="proposal-instructions"><h2>Instructions</h2><p>${prose(proposalText())}</p>${ml('Edit instructions','agents/proposal-instructions','text-button')}</section>
 ${mFacts([['Harness',mobileHarnesses.colony.name],['Provider',mobileHarnesses.colony.providers[0]],['Model',mobileModels('colony',mobileHarnesses.colony.providers[0])[0]],['Access','Only you · Starts stopped']])}
 `,'channel',mb('Approve & add Nori','proposal-approve','primary full')));
mRoute('agents/proposal-instructions','Edit proposal instructions',()=>mPage('Edit instructions',`${ma('Nori’s instructions','proposal-prompt',proposalText(),9)}`,'agents/proposal',mb('Save to proposal','proposal-save','primary full')));
mAction('proposal-save',()=>{if(!proposalText().trim())return mFlash('Add instructions before saving.');mGo('agents/proposal');});
mAction('proposal-approve',()=>{
 if(proposalApproved)return;
 const name=(M.draft['proposal-name']??'Nori').trim(),role=(M.draft['proposal-role']??'Client success').trim(),instructions=proposalText().trim();
 if(!name||!role||!instructions)return mFlash('Review the name, responsibility and instructions.');
 const provider=mobileHarnesses.colony.providers[0],id=AG.agents.length;
 AG.agents.push({id,name,role,engine:'colony',provider,model:mobileModels('colony',provider)[0],host:'Agency host',instructions,version:1,access:'Only me',channels:[],parallel:2,archived:false,pending:false,status:'Stopped',files:false});
 mAction('agent-'+id,()=>agOpen(id));proposalApproved=true;document.body.dataset.proposalState='approved';document.body.dataset.demoAgentCount=AG.agents.length;agOpen(id);
});

const originalConversation=conversation;
conversation=function(){if(page!=='channel')return originalConversation();return `${header('Campaign studio','Lerato Social · You and 4 AI employees','channels','headphones')}<main class="scroll" id="timeline"><div class="demo-feed">${feed.map(row).join('')}${sent.filter(s=>s.page==='channel').map(s=>row({id:'human',text:s.text})).join('')}</div></main>${composer()}${typing?keyboard():''}`;};
const mobileRender=render;
render=function(){mobileRender();document.body.dataset.demoRoute=page;
 if(proposalApproved&&page==='agents/detail'&&!ag().channels.length){for(const section of phone.querySelectorAll('.flow-section'))if(section.querySelector('h2')?.textContent==='Working context')section.innerHTML='<h2>Working context</h2><p>Only you. No channels assigned yet.</p>';}
document.querySelectorAll('#phone .text-button').forEach(e=>{if(/preview.*fail|preview.*error/i.test(e.textContent))e.remove();});
 // Keep the exact mobile product components, adding the approved agent artwork.
 document.querySelectorAll('#phone .setting-row,#phone .agent-hero,#phone .m-row-head').forEach(el=>{const text=el.querySelector('strong,h1')?.textContent.trim(),agent=AG.agents.find(a=>text===a.name);const avatar=el.querySelector('.avatar');if(agent&&avatar){avatar.className='colony-agent-head';avatar.innerHTML=ColonyHeads.art(ColonyHeads.index(agent.name.toLowerCase()));}});
 if(page!=='channel'){const scroll=phone.querySelector('.scroll');if(scroll){const b=document.createElement('button');b.className='demo-bridge';b.dataset.demoReturn='';b.innerHTML=icon('back')+'Back to Campaign studio';scroll.append(b);}}
};
document.addEventListener('click',e=>{if(e.target.closest('[data-demo-return]'))go('channel');},true);
const briefs={social:'@Scout, plan our next campaign with @Mina and @Theo.',customers:'@Aya, find boutique hotels that need help with social media.',website:'@Mina, improve our homepage. @Theo, check the draft.',money:'@Theo, check our revenue, costs and unpaid invoices.',agents:'@Scout, prepare an AI employee to help with client requests. I’ll review the proposal.'};
const replies={social:['scout','@Mina, create the carousel. @Theo, check the caption.'],customers:['aya','@Scout, I found six prospects. Let’s review the evidence together.'],website:['mina','@Theo, I have a new homepage direction. Please check the enquiry journey.'],money:['theo','@Scout, Cedar Café has an overdue invoice. Let’s check the record.'],agents:['scout','I’ve prepared Nori for client success. @Theo, check the instructions and access before @Lerato reviews.']};
const records={social:['social/post','September journal','Instagram carousel · Version 3'],customers:['discovery/results','Boutique hotel prospects','6 prospects · Cape Town'],website:['website/home','Lerato Social website','Homepage draft'],money:['money/home','Revenue & costs','September · Business ledger'],agents:['agents/proposal','Nori · AI Client Success','Prepared by Scout · Awaiting your approval']};
function reset(next=key){generation++;playing=false;key=keys.includes(next)?next:'social';sheet='';typing=false;drafts={};sent=[];feed=[];M.draft={};M.notice='';proposalApproved=false;document.body.dataset.proposalState='draft';
 for(const [target,value] of [[WEB,seed.web],[SO,seed.social],[AG,seed.agents],[MO,seed.money]]){for(const k of Object.keys(target))delete target[k];Object.assign(target,structuredClone(value));}
 dLeads.splice(0,dLeads.length,...structuredClone(seed.leads));Object.assign(D,{lead:0,filter:'all',selected:new Set(),leadQuery:'',saved:false,shared:false,campaign:0,name:'Cape Town boutique stays'});
 document.body.dataset.demoAgentCount=AG.agents.length;touch.hidePopover();touch.classList.remove('down');go('channel');status('idle');}
function find(selector){const e=phone.querySelector(selector);if(!e)throw Error('Mobile demo control missing: '+selector);return e;}
async function tapOn(selector,token){document.body.dataset.demoAction=selector;let e=find(selector);const pane=e.closest('.scroll');if(pane){const item=e.getBoundingClientRect(),area=pane.getBoundingClientRect();if(item.bottom>area.bottom-12)pane.scrollBy({top:item.bottom-area.bottom+18,behavior:'smooth'});else if(item.top<area.top+12)pane.scrollBy({top:item.top-area.top-18,behavior:'smooth'});}await wait(650,token);e=find(selector);const r=e.getBoundingClientRect();touch.style.transform=`translate(${r.left+r.width/2-16}px,${r.top+r.height/2-16}px)`;if(!touch.matches(':popover-open'))touch.showPopover();touch.classList.add('down');await wait(250,token);e.click();touch.classList.remove('down');await wait(550,token);}
async function typeIn(selector,text,token){await tapOn(selector,token);const e=find(selector);e.focus({preventScroll:true});e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));for(const char of text){await wait(char===' '?45:36,token);e.value+=char;e.dispatchEvent(new Event('input',{bubbles:true}));}e.blur();await wait(600,token);}
async function appendInstruction(selector,text,token){await tapOn(selector,token);const e=find(selector);e.focus({preventScroll:true});e.setSelectionRange(e.value.length,e.value.length);for(const char of text){await wait(char===' '?45:36,token);e.value+=char;e.dispatchEvent(new Event('input',{bubbles:true}));e.scrollTop=e.scrollHeight;}e.blur();await wait(700,token);}
async function reply(id,text,token,record=false){const el=document.createElement('div');el.className='demo-typing';el.textContent=names[id][0]+' is typing…';find('#timeline').append(el);find('#timeline').scrollTo({top:99999,behavior:'smooth'});await wait(1500,token);el.remove();const entry={id,text};if(record){const [route,title,sub]=records[key];Object.assign(entry,{route,title,sub});}feed.push(entry);render();find('#timeline').scrollTo({top:99999,behavior:'smooth'});await wait(Math.min(4300,1800+text.length*20),token);}
async function story(token){await wait(600,token);await typeIn('.composer textarea',briefs[key],token);await tapOn('#composer-action',token);const human=sent.at(-1);if(!human)throw Error('Mobile brief was not sent');feed.push({id:'human',text:human.text});sent=[];render();await reply(...replies[key],token);
 const writer=key==='social'?'mina':key==='customers'?'scout':key==='agents'?'theo':key==='website'?'theo':'scout';
 await reply(writer,{social:'@Theo, the design is ready. @Lerato, open it and leave your feedback.',customers:'@Aya, the shortlist looks useful. @Lerato, check The Cedar House first.',website:'@Mina, the structure works. @Lerato, review the homepage headline.',money:'@Theo, I’ve checked the totals. @Lerato, here are the source records.',agents:'@Scout, the proposal is checked. @Lerato, Nori’s role and instructions are ready. Edit anything, then approve.'}[key],token,true);
 await tapOn('.mobile-record',token);await wait(2000,token);
 if(key==='social'){
  await tapOn('[data-m="post-next"]',token);await wait(1900,token);await tapOn('[data-route="social/feedback"]',token);await typeIn('[data-m-field="post-feedback"]','@Mina, shorten slide two. @Theo, check the caption.',token);await tapOn('[data-m="post-feedback"]',token);await wait(1800,token);
 }else if(key==='customers'){
  await tapOn('[data-d="lead"][data-id="0"]',token);await wait(2800,token);await tapOn('[data-route="discovery/evidence"]',token);await wait(3500,token);
 }else if(key==='website'){
  await tapOn('[data-route="website/pages"]',token);await tapOn('[data-m="web-page-0"]',token);await typeIn('[data-m-field="web-title"]','Social media, handled. Your business, growing.',token);await tapOn('[data-m="web-save"]',token);await tapOn('[data-m="web-page-0"]',token);await tapOn('[data-route="website/preview"]',token);await wait(3200,token);
 }else if(key==='money'){
  await tapOn('[data-route="money/costs"]',token);await wait(2500,token);await tapOn('[data-route="money/revenue"]',token);await tapOn('[data-m="money-invoice-1"]',token);await wait(3300,token);
 }else if(key==='agents'){
  if(AG.agents.length!==seed.agents.agents.length)throw Error('Agent was added before approval');
  await wait(3000,token);await tapOn('[data-route="agents/proposal-instructions"]',token);await wait(2200,token);
  await appendInstruction('[data-m-field="proposal-prompt"]',proposalEdit,token);
  await tapOn('[data-m="proposal-save"]',token);await wait(2600,token);
  await tapOn('[data-m="proposal-approve"]',token);
  if(!proposalApproved||AG.agents.length!==seed.agents.agents.length+1||!AG.agents.at(-1).instructions.endsWith(proposalEdit.trim()))throw Error('Approved proposal was not saved');
  await wait(2400,token);
 }
 await tapOn('[data-demo-return]',token);
 await reply('theo',{social:'@Mina, the feedback is attached to slide two. Let’s revise it before @Lerato approves.',customers:'@Aya, keep the sources with your recommendation. @Lerato, review before outreach.',website:'@Mina, the new headline is saved as a draft. @Lerato, review it before publishing.',money:'@Scout, the invoice is overdue. @Lerato, let’s agree on the follow-up before sending.',agents:'@Lerato, Nori is added with your edits. @Scout, the Friday summary is in the instructions. Nori is ready for you to start.'}[key],token);
}
function start(){if(phase==='paused'){playing=true;status('playing');return;}if(playing)return;reset(key);playing=true;status('playing');const token=generation;story(token).then(()=>{if(token===generation){playing=false;touch.hidePopover();status('ended');}}).catch(e=>{if(token!==generation)return;playing=false;status('error');send('demo-error',{message:e.message});console.error(e);});}
addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;const d=e.data;if(d?.type==='demo-ping')send('demo-ready');if(d?.type==='demo-select')reset(d.key);if(d?.type==='demo-play')start();if(d?.type==='demo-pause'&&playing){playing=false;status('paused');}if(d?.type==='demo-replay'){reset(key);start();}});
reset(key);send('demo-ready');
})();
