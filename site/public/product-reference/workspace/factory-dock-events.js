function fdNewAgent(parentId){
 const parent=fxSession(parentId);fxAddDialog(parent?.project);
 const form=document.querySelector('[data-factory-form="add"]');if(!form)return;
 form.querySelector('[name="brief"]').closest('.field')?.insertAdjacentHTML('beforebegin',ui.select('Parent agent','parent',parentId||'',[['','Independent agent'],...fx.sessions.map(s=>[s.id,s.title])]));
 if(!form.elements.parent)form.insertAdjacentHTML('afterbegin',ui.select('Parent agent','parent',parentId||'',[['','Independent agent'],...fx.sessions.map(s=>[s.id,s.title])]));
}
function fdPlacement(ref){const t=fxTab();ui.dialog('Place '+fdLabel(ref),`<form data-dock-form="place" data-ref="${esc(ref)}">${ui.select('Workspace','workspace',t.id,fx.tabs.map(t=>[t.id,t.name]),'data-fd-destination')}${ui.select('Pane','group',t.focusGroup,fdGroups(t.layout).map(g=>[g.id,fdLabel(g.active)||'Empty pane']))}${ui.select('Position','zone','center',[['center','As a tab in this pane'],['left','To the left'],['right','To the right'],['top','Above'],['bottom','Below']])}<p class="field-note">Placement changes where you see this view. Its agent, parent, project and work stay attached.</p>${ui.formFooter('Place view')}</form>`);}
function fdAgentMenu(s){ui.dialog(s.title,`<div class="fx-menu-summary">${fxProjectChip(s.project)}${fxBadge(s.status)}</div>${s.parentId?`<p class="field-note">Child of ${esc(fxSession(s.parentId)?.title||'another agent')}</p>`:''}<div class="fd-menu-list">${fdBtn('New child agent','child',s.id)}${fdBtn('Move or split view…','place',s.id)}${fxButton('Configuration & instructions','config',s.id)}${fxButton('Iterations & decisions','history',s.id)}${fxButton('Review changes','review',s.id)}${fxButton(s.status==='working'?'Pause agent':'Resume agent',s.status==='working'?'pause':'resume',s.id)}</div>`);}
function fdGroupMenu(id){const g=fdNode(fxTab().layout,id);if(!g)return;ui.dialog('Pane layout',`<p class="field-note">${esc(fdLabel(g.active)||'Empty pane')}</p><div class="fd-layout-choices">${[['left','Split left'],['right','Split right'],['top','Split above'],['bottom','Split below']].map(([zone,label])=>fdBtn(icon('split')+label,'split',g.active,'secondary',`data-group="${id}" data-zone="${zone}" ${g.tabs.length<2?'disabled title="Open a second tab in this pane to split it out"':''}`)).join('')}</div><div class="fd-menu-list">${g.active?fdBtn('Move current view to another pane…','place',g.active):''}${fdBtn('Add another view','group-add',id)}${fdBtn('Equalise split sizes','equal')}${fdBtn('Close this pane · keep agents','close-group',id)}</div>`);}
function fdGroupAdd(id){ui.dialog('Open in this pane',`<div class="fd-open-list">${fxTab().sessions.map(fxSession).filter(Boolean).map(s=>fdBtn(`${agentLogo(s.engine)}<span>${esc(s.title)}<small>${esc(fxProject(s.project).name)}</small></span>${fxBadge(s.status)}`,'open-here',s.id,'fd-open-agent',`data-group="${id}"`)).join('')}</div><div class="fx-menu-actions">${fdBtn('Start a new agent','new-agent','','primary small')}${fdBtn('Bring in another session','existing','','secondary small')}</div>`);}
function fdExisting(){ui.dialog('Bring an agent into this workspace',`<p class="field-note">An existing session keeps its history and draft when opened here.</p><div class="fd-open-list">${fx.sessions.map(s=>fdBtn(`${agentLogo(s.engine)}<span>${esc(s.title)}<small>${esc(fxProject(s.project).name)}${s.parentId?' · Child of '+esc(fxSession(s.parentId)?.title||'agent'):''}</small></span>${fxBadge(s.status)}`,'open',s.id,'fd-open-agent')).join('')}</div>`,'wide-dialog');}
const fdActions={
 open:ref=>{if(!fxTab()){fx.tabs.push({id:fdId('tab'),name:'Workspace',sessions:[]});fx.active=fx.tabs[0].id;}fdOpen(ref);closeModal();fxSave();if(state.route==='factory')render();else go('factory');},
 'select-view':(ref,b)=>fdFocus(ref,b.dataset.group),
 'close-view':(ref,b)=>{fdCloseRef(ref,b.dataset.group);fxPaint();},
 'open-here':(ref,b)=>{fdDock(ref,b.dataset.group);fdFinish();},
 'toggle-tree':id=>{const t=fxTab();t.collapsed=t.collapsed.includes(id)?t.collapsed.filter(x=>x!==id):[...t.collapsed,id];fxPaint();},
 panel:id=>{fx.navigatorCollapsed=false;if(fxTab())fxTab().panel=id;fxPaint();},
 navigator:()=>{fx.navigatorCollapsed=!fx.navigatorCollapsed;fxPaint();},
 'new-agent':()=>fdNewAgent(),child:id=>fdNewAgent(id),existing:fdExisting,
 'agent-menu':id=>fdAgentMenu(fxSession(id)),config:id=>fxConfigDialog(fxSession(id)),
 'group-menu':fdGroupMenu,'group-add':fdGroupAdd,
 'max-group':id=>{const t=fxTab();t.maxGroup=t.maxGroup===id?null:id;t.focusGroup=id;fxPaint();},
 'close-group':id=>{const t=fxTab();t.layout=fdReplace(t.layout,id,null)||fdGroup();t.maxGroup=null;t.focusGroup=fdGroups(t.layout)[0].id;fdFinish();toast('Pane closed. Its agents remain in the navigator.');},
 place:fdPlacement,
 split:(ref,b)=>{fdDock(ref,b.dataset.group,b.dataset.zone);fdFinish();},
 tool:ref=>{const t=fxTab(),existing=fdGroups(t.layout).find(g=>g.tabs.includes(ref));if(existing)fdOpen(ref);else fdDock(ref,t.focusGroup,'right');fxPaint();},
 resource:(ref,b)=>{const r=fdRef(ref);r.session.file=Number(b.dataset.file)||0;fdActions.open(ref);},
 equal:()=>{fdScale(fxTab().layout);fdFinish();},
 'layout-help':()=>ui.dialog('Arrange your workspace',`<div class="fd-layout-guide"><div>${icon('tree')}<h3>Pick an agent</h3><p>Drag from the tree or grab a pane tab.</p></div><div>${icon('dock')}<h3>Choose a place</h3><p>Drop on an edge to split. Drop in the centre to add a tab. The shaded area shows where it will go.</p></div><div>${icon('split')}<h3>Make room</h3><p>Resize any divider. Double-click one to balance it. Focus a pane to work at full width.</p></div></div><p class="field-note">Keyboard: use the pane menu to move or split, arrow keys to switch tabs, and arrow keys on a divider to resize. Escape cancels a drag. Closing a view keeps its agent.</p>`)
};
Object.assign(fxActions,{add:()=>fdNewAgent(),existing:fdExisting,'session-menu':id=>fdAgentMenu(fxSession(id)),'open-session':id=>{const existing=fx.tabs.find(t=>t.id===fx.active&&t.sessions.includes(id))||fx.tabs.find(t=>t.sessions.includes(id));if(existing)fx.active=existing.id;fdActions.open(id);},max:id=>{const g=fdGroups(fxTab().layout).find(g=>g.tabs.includes(id));if(g)fdActions['max-group'](g.id);},detach:id=>{const g=fdGroups(fxTab().layout).find(g=>g.tabs.includes(id));if(g)fdCloseRef(id,g.id);fdFinish();},arrange:fdActions['layout-help'],equal:fdActions.equal});
document.addEventListener('click',e=>{const b=e.target.closest('[data-dock]');if(!b)return;e.preventDefault();fxRemember();fdActions[b.dataset.dock]?.(b.dataset.id,b);});
document.addEventListener('input',e=>{if(!e.target.hasAttribute('data-fd-search'))return;fxTab().search=e.target.value;const tree=document.querySelector('.fd-agent-tree');tree.innerHTML=fdAgentTree(fxTab());tree.querySelectorAll('[data-depth]').forEach(el=>el.style.paddingLeft=(6+Number(el.dataset.depth)*14)+'px');fxSave();});
document.addEventListener('change',e=>{if(!e.target.hasAttribute('data-fd-destination'))return;const t=fx.tabs.find(t=>t.id===e.target.value);fdEnsure(t);e.target.form.elements.group.innerHTML=fdGroups(t.layout).map(g=>`<option value="${g.id}">${esc(fdLabel(g.active)||'Empty pane')}</option>`).join('');});
document.addEventListener('submit',e=>{const f=e.target;if(f.dataset.dockForm!=='place')return;e.preventDefault();fxRemember();const data=Object.fromEntries(new FormData(f)),t=fx.tabs.find(t=>t.id===data.workspace);fdDock(f.dataset.ref,data.group,data.zone,t);fx.active=t.id;closeModal();fxSave();if(state.route==='factory')render();else go('factory');});
let fdDrag=null,fdSuppressClickUntil=0,fdSuppressedRef=null;
function fdClearDrop(){document.querySelectorAll('[data-fd-drop]').forEach(el=>{delete el.dataset.fdDrop;});document.querySelectorAll('.fd-workspace-drop').forEach(el=>el.classList.remove('fd-workspace-drop'));}
function fdEndDrag(cancel=false){
 const drag=fdDrag;if(!drag)return;fdDrag=null;
 drag.element.removeEventListener('pointermove',fdDragMove);drag.element.removeEventListener('pointerup',fdDragUp);drag.element.removeEventListener('pointercancel',fdDragCancel);
 if(drag.element.hasPointerCapture(drag.pointer))drag.element.releasePointerCapture(drag.pointer);
 drag.ghost?.remove();fdClearDrop();document.body.classList.remove('fd-dragging');
 if(drag.started){fdSuppressClickUntil=performance.now()+350;fdSuppressedRef=drag.ref;if(!cancel&&drag.target){fxRemember();const t=fx.tabs.find(t=>t.id===drag.target.tab)||fxTab();fdDock(drag.ref,drag.target.group,drag.target.zone,t,drag.target.before);fx.active=t.id;fxPaint();const live=document.getElementById('fd-announcement');if(live)live.textContent=fdLabel(drag.ref)+' placed '+(drag.target.zone==='center'?'as a tab':drag.target.zone)+'.';}}
}
function fdDragMove(e){
 const d=fdDrag;if(!d||e.pointerId!==d.pointer)return;
 if(!d.started&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;
 if(!d.started){d.started=true;d.ghost=document.createElement('div');d.ghost.className='fd-drag-ghost';d.ghost.textContent=fdLabel(d.ref);document.body.append(d.ghost);document.body.classList.add('fd-dragging');}
 d.ghost.style.transform=`translate(${e.clientX+14}px,${e.clientY+15}px)`;
 fdClearDrop();d.target=null;
 const hit=document.elementFromPoint(e.clientX,e.clientY),tab=hit?.closest('[data-fx-tab]');
 if(tab){const t=fx.tabs.find(t=>t.id===tab.dataset.fxTab);fdEnsure(t);tab.classList.add('fd-workspace-drop');d.target={tab:t.id,group:fdCurrentGroup(t).id,zone:'center'};return;}
 const group=hit?.closest('[data-fd-group]');if(!group)return;
 const rect=group.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;
 const inTabStrip=!!hit.closest('.fd-group-header');
 const distances={left:x,right:1-x,top:y,bottom:1-y};
 let zone='center';if(!inTabStrip){const edge=Object.keys(distances).reduce((a,b)=>distances[a]<distances[b]?a:b);if(distances[edge]<.24)zone=edge;}
 group.dataset.fdDrop=zone;group.querySelector('.fd-drop-preview span').textContent=zone==='center'?'Add as tab':({left:'Split left',right:'Split right',top:'Split above',bottom:'Split below'}[zone]);
 d.target={group:group.dataset.fdGroup,zone,before:inTabStrip?hit.closest('[data-fd-ref]')?.dataset.fdRef:null};
}
const fdDragUp=()=>fdEndDrag(false),fdDragCancel=()=>fdEndDrag(true);
document.addEventListener('pointerdown',e=>{
 if(e.button!==0||fdDrag)return;
 const element=e.target.closest('[data-fd-drag]');if(!element)return;
 fdDrag={element,ref:element.dataset.fdDrag,pointer:e.pointerId,x:e.clientX,y:e.clientY,started:false,target:null};
 element.setPointerCapture(e.pointerId);element.addEventListener('pointermove',fdDragMove);element.addEventListener('pointerup',fdDragUp);element.addEventListener('pointercancel',fdDragCancel);
});
document.addEventListener('click',e=>{if(performance.now()<fdSuppressClickUntil&&e.target.closest('[data-fd-drag]')?.dataset.fdDrag===fdSuppressedRef){e.preventDefault();e.stopImmediatePropagation();}},true);
function fdSetFocus(e){const group=e.target.closest('[data-fd-group]'),t=fxTab();if(!group||!t||t.focusGroup===group.dataset.fdGroup)return;t.focusGroup=group.dataset.fdGroup;document.querySelectorAll('[data-fd-group]').forEach(el=>el.classList.toggle('fd-focused',el===group));const active=fdNode(t.layout,t.focusGroup)?.active;document.querySelectorAll('.fd-tree-row').forEach(row=>{const selected=row.querySelector('.fd-tree-agent')?.dataset.id===active;row.classList.toggle('is-selected',selected);row.parentElement.setAttribute('aria-selected',selected);});fxSave();}
document.addEventListener('pointerdown',fdSetFocus,true);
document.addEventListener('focusin',fdSetFocus);
document.addEventListener('pointerdown',e=>{
 const divider=e.target.closest('[data-fd-resize],[data-fd-nav-resize]');if(!divider||e.button!==0)return;e.preventDefault();
 const nav=divider.hasAttribute('data-fd-nav-resize'),node=nav?null:fdNode(fxTab().layout,divider.dataset.fdResize),rect=divider.parentElement.getBoundingClientRect(),pointer=e.pointerId;
 const start=nav?fx.navigatorWidth:node.ratio,startX=e.clientX;
 divider.setPointerCapture(pointer);document.body.classList.add('fx-resizing');
 const move=ev=>{if(ev.pointerId!==pointer)return;if(nav){fx.navigatorWidth=Math.max(210,Math.min(380,start+ev.clientX-startX));divider.setAttribute('aria-valuenow',Math.round(fx.navigatorWidth));}else node.ratio=Math.round(Math.max(15,Math.min(85,(node.axis==='x'?(ev.clientX-rect.left)/rect.width:(ev.clientY-rect.top)/rect.height)*100)));fdApplySizes();};
 const stop=ev=>{if(ev.pointerId!==pointer)return;if(ev.type==='pointercancel'){if(nav)fx.navigatorWidth=start;else node.ratio=start;fdApplySizes();}divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',stop);divider.removeEventListener('pointercancel',stop);if(divider.hasPointerCapture(pointer))divider.releasePointerCapture(pointer);document.body.classList.remove('fx-resizing');fxSave();};
 divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',stop);divider.addEventListener('pointercancel',stop);
});
document.addEventListener('dblclick',e=>{const divider=e.target.closest('[data-fd-resize]');if(!divider)return;fdNode(fxTab().layout,divider.dataset.fdResize).ratio=50;fdApplySizes();fxSave();});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&fdDrag){e.preventDefault();fdEndDrag(true);return;}
 const agent=e.target.closest('.fd-tree-agent');
 if(agent&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
  e.preventDefault();const t=fxTab(),id=agent.dataset.id,all=[...document.querySelectorAll('.fd-tree-agent')],index=all.indexOf(agent),children=fx.sessions.filter(s=>s.parentId===id&&t.sessions.includes(s.id));
  if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){const next=e.key==='Home'?0:e.key==='End'?all.length-1:Math.max(0,Math.min(all.length-1,index+(e.key==='ArrowDown'?1:-1)));all[next]?.focus();}
  else if(e.key==='ArrowRight'&&children.length){if(t.collapsed.includes(id)){fdActions['toggle-tree'](id);document.querySelector(`.fd-tree-agent[data-id="${id}"]`)?.focus();}else document.querySelector(`.fd-tree-agent[data-id="${children[0].id}"]`)?.focus();}
  else if(e.key==='ArrowLeft'){if(children.length&&!t.collapsed.includes(id)){fdActions['toggle-tree'](id);document.querySelector(`.fd-tree-agent[data-id="${id}"]`)?.focus();}else document.querySelector(`.fd-tree-agent[data-id="${fxSession(id)?.parentId}"]`)?.focus();}
  return;
 }
 const tab=e.target.closest('[data-fd-ref]');
 if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
  e.preventDefault();const g=fdNode(fxTab().layout,tab.dataset.group),i=g.tabs.indexOf(tab.dataset.fdRef),next=e.key==='Home'?0:e.key==='End'?g.tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+g.tabs.length)%g.tabs.length;fdFocus(g.tabs[next],g.id);return;
 }
 const separator=e.target.closest('[data-fd-resize],[data-fd-nav-resize]');
 if(separator&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){
  e.preventDefault();const nav=separator.hasAttribute('data-fd-nav-resize'),n=nav?null:fdNode(fxTab().layout,separator.dataset.fdResize);
  if(e.key!=='Home'&&((nav||n.axis==='x')?!['ArrowLeft','ArrowRight'].includes(e.key):!['ArrowUp','ArrowDown'].includes(e.key)))return;
  const delta=['ArrowLeft','ArrowUp'].includes(e.key)?-5:5;
  if(nav){fx.navigatorWidth=e.key==='Home'?260:Math.max(210,Math.min(380,fx.navigatorWidth+delta*4));separator.setAttribute('aria-valuenow',fx.navigatorWidth);}else n.ratio=e.key==='Home'?50:Math.max(15,Math.min(85,n.ratio+delta));fdApplySizes();fxSave();
 }
});
window.addEventListener('blur',()=>fdEndDrag(true));
let fdPaneObserver;
function fdWatchPaneSizes(){fdPaneObserver?.disconnect();fdPaneObserver=new ResizeObserver(entries=>{for(const entry of entries){const el=entry.target,s=fxSession(el.dataset.session);if(s&&s.stickToLatest!==false)el.scrollTop=el.scrollHeight;}});document.querySelectorAll('.fd-agent .fx-conversation').forEach(el=>fdPaneObserver.observe(el));}
const fdScrollIntent=new Map();
function fdMarkScrollIntent(e){const el=e.target.closest?.('.fd-agent .fx-conversation');if(el)fdScrollIntent.set(el.dataset.session,performance.now()+1000);}
document.addEventListener('wheel',fdMarkScrollIntent,{capture:true,passive:true});
document.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))fdMarkScrollIntent(e);},true);
document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')fdMarkScrollIntent(e);},true);
document.addEventListener('scroll',e=>{const el=e.target;if(!el.matches?.('.fd-agent .fx-conversation'))return;const s=fxSession(el.dataset.session);if(s&&performance.now()<(fdScrollIntent.get(s.id)||0))s.stickToLatest=el.scrollHeight-el.scrollTop-el.clientHeight<5;},true);
