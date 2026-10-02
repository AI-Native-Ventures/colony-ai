/* Browser-local parity review. No external services or native capabilities. */
const pxKey='colony-parity-review-v1';
const pxSeed={version:1,recipients:{},format:{},media:{},draftNames:{},reminders:[],following:[],stars:['sales'],sections:[{id:'clients',name:'Client work'}],placements:{olive:'clients',cedar:'clients',northline:'clients'},left:[],status:{text:'',symbol:'leaf',expires:0},search:{query:'',author:'all',channel:'all',before:'',after:''},memory:{},huddleVoices:{},huddleMode:'Voice activity',huddleSpeech:true,updates:[{id:'update-1',author:'zinhle',text:'October briefs are ready. I’m checking client deadlines before we finalise the production calendar.',time:'Today · 08:45'},{id:'update-2',author:'mina',text:'The Olive House carousel is ready for internal review. Version 2 includes the revised opening slide.',time:'Today · 09:20',route:'social/post/olive-1'}],followPeople:['zinhle','mina'],updateFilter:'all',business:'lerato',businesses:[{id:'lerato',name:'Lerato Social',role:'Owner',state:'connected'},{id:'collective',name:'Studio Collective',role:'Member',state:'connected'}],otherScopes:{},compute:{state:'off',model:'Qwen3 · 4B',progress:0,downloaded:['Qwen3 · 4B'],mode:'share'},repos:{},workflows:{}};
let px=structuredClone(pxSeed);
try{const saved=JSON.parse(sessionStorage.getItem(pxKey)||'null');if(saved?.version===1)px={...px,...saved};}catch{ /* A fresh example is available when storage is unavailable. */ }
const pxActions={},pxForms={};
let pxUndo=null,pxAnnotation=null,pxComposerKey='',pxReplyTarget=null;
function pxSave(){try{const data=JSON.stringify(px);if(data.length>2500000)throw new Error('limit');sessionStorage.setItem(pxKey,data);saveFullSession();}catch{toast('This review could not be saved on this device. Keep the page open to retain your changes.');}}
function pxPaint(message){pxSave();render();if(message)toast(message);}
function pxButton(label,action,id='',cls='secondary small',extra=''){return `<button type="button" class="${cls}" data-px="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;}
function pxLink(label,route,cls='text-button'){return `<a class="${cls}" href="#${esc(route)}">${label}</a>`;}
function pxForm(kind,body,id='',label='Save'){const prefix='px-'+kind+'-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'-')+'-';body=body.replace(/ (id|for)="sf-/g,' $1="'+prefix);return `<form data-px-form="${kind}" data-id="${esc(id)}">${body}<p class="px-error" role="alert" tabindex="-1" hidden></p><footer class="dialog-actions">${kind==='workflow'?pxButton('Discard changes','workflow-discard'):['business-message','issue-comment','review-comment'].includes(kind)?'':pxButton('Cancel','close')}<button class="primary small">${label}</button></footer></form>`;}
function pxError(form,text){const el=form.querySelector('.px-error');if(el){el.hidden=false;el.textContent=text;el.focus();}else toast(text);}
function pxDialog(title,body,wide=false){ui.dialog(title,body,wide?'px-dialog-wide':'px-dialog');}
function pxTabs(tabs,current){return `<nav class="px-tabs" aria-label="Views">${tabs.map(([id,label,route])=>`<a href="#${route}" ${id===current?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;}
function pxPage(title,body,actions='',tabs='',sub=''){return `<section class="px-page">${ui.header(title,actions,sub)}${tabs}<div class="px-scroll" tabindex="0" aria-label="${esc(title)} content">${body}</div></section>`;}
function pxEmpty(title,text,action=''){return `<div class="px-empty">${icon('folder')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;}
function pxRow(title,sub,action='',symbol='file'){return `<div class="px-row">${icon(symbol)}<div class="px-row-copy"><strong>${esc(title)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div><div class="px-row-actions">${action}</div></div>`;}
function pxInitials(name){return name.split(' ').map(s=>s[0]).slice(0,2).join('');}
function pxPeople(){return [{id:'human',name:full.system.name||'Lerato Molefe',role:'Owner',kind:'person',status:'Active'},...studio.members.filter(m=>m.role!=='Owner').map(m=>({...m,kind:'person'})),...team.filter(a=>!agentConfig(a.id).archived).map(a=>({...a,kind:'agent',status:'Active'}))];}
function pxPerson(id){return pxPeople().find(p=>p.id===id)||{id,name:'Former teammate',role:'No longer in this business',kind:'person',status:'Removed'};}
const pxBasePerson=person,pxBaseAvatar=avatar;
person=function(id){const p=pxPeople().find(p=>p.id===id);return p||pxBasePerson(id);};
avatar=function(id,size=''){const p=pxPeople().find(p=>p.id===id);return p?.kind==='person'?`<span class="avatar human ${size}" aria-hidden="true">${esc(pxInitials(p.name))}</span>`:pxBaseAvatar(id,size);};
function pxPersonRows(selected=[],type='checkbox',name='members',excludeSelf=true){return ['person','agent'].map(kind=>`<div class="px-picker-group"><h3>${kind==='person'?'People':'Agents'}</h3>${pxPeople().filter(p=>p.kind===kind&&(!excludeSelf||p.id!=='human')).map(p=>`<label class="px-person-option" data-px-person-name="${esc(p.name.toLowerCase())}"><input type="${type}" name="${name}" value="${p.id}" ${selected.includes(p.id)?'checked':''} ${p.status!=='Active'?'disabled':''}>${avatar(p.id,'tiny')}<span><strong>${esc(p.name)}</strong><small>${esc(p.status==='Active'?p.role:p.status+' · not yet available')}</small></span>${kind==='agent'?'<span class="px-kind">Agent</span>':''}</label>`).join('')}</div>`).join('');}
function pxPickerFilter(){return `<label class="px-filter-input">${icon('search')}<input aria-label="Find a person or agent" placeholder="Find a person or agent…" data-px-filter="people" autocomplete="off"></label>`;}
function pxText(html){const el=document.createElement('div');el.innerHTML=html;return (el.textContent||'').replace(/\s+/g,' ').trim();}
function pxMessageRecord(key){const m=state.messageRoots[key];return m?{key,author:m.author,text:pxText(m.body).slice(0,500),context:m.context||'channel/sales',body:m.body}:null;}
function pxDate(value){return new Date(value).toLocaleString('en-ZA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function pxFinish(text){full.unsaved=false;closeModal();pxPaint(text);}
pxActions.close=()=>closeModal();
pxActions.undo=()=>{if(pxUndo){pxUndo();pxUndo=null;pxPaint('Restored.');}};
