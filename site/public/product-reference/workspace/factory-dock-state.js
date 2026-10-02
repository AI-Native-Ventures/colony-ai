/* A workspace owns layout; an agent owns work. Moving a view never reparents an agent. */
const fdId=prefix=>prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
const fdGroup=(tabs=[],active=tabs[0])=>({type:'group',id:fdId('group'),tabs,active});
const fdSplit=(axis,a,b,ratio=50)=>({type:'split',id:fdId('split'),axis,a,b,ratio});
function fdGroups(node,out=[]){if(!node)return out;if(node.type==='group')out.push(node);else{fdGroups(node.a,out);fdGroups(node.b,out);}return out;}
function fdNode(node,id){if(!node||node.id===id)return node?.id===id?node:null;return node.type==='split'?(fdNode(node.a,id)||fdNode(node.b,id)):null;}
function fdReplace(node,id,replacement){if(!node)return null;if(node.id===id)return replacement;if(node.type==='split'){node.a=fdReplace(node.a,id,replacement);node.b=fdReplace(node.b,id,replacement);if(!node.a)return node.b;if(!node.b)return node.a;}return node;}
function fdRef(ref){const [kind,id]=ref.includes(':')?ref.split(':'):['agent',ref];return {kind,id,session:fxSession(id),plan:kind==='plan'?fxPlan(id):null};}
function fdValid(ref){const r=fdRef(ref);return r.kind==='plan'?!!r.plan:!!r.session;}
function fdLabel(ref){const r=fdRef(ref);return r.kind==='agent'?r.session?.title:r.kind==='plan'?r.plan?.title:({changes:'Changes',files:'Files',terminal:'Terminal',preview:'App preview'}[r.kind]||r.kind)+' · '+(r.session?.title||'');}
function fdEnsure(t){
 if(!t)return;
 if(!t.layout)t.layout=fdGroup(t.sessions.filter(id=>fxSession(id)));
 t.collapsed||=[];t.panel||='agents';t.focusGroup=fdNode(t.layout,t.focusGroup)?.id||fdGroups(t.layout)[0]?.id;
}
function fdUpgrade(source){
 if(source.dockVersion===2)return;
 const lead=fxSeedSession('s-lead','portal','Client portal build','claude','working','plan/client-approvals',[
  ['you','Let’s build the client approval experience from our agreed plan. Keep the API, interface and access checks in separate working copies.'],
  ['agent','The plan is approved. I’ve delegated the API and review interface. Access QA is waiting for the API contract; I’m keeping that dependency visible.'],
  ['activity','Delegated 3 tasks · Plan v2 approved'],
  ['agent','You can work directly with any child agent. Their changes return here for the release review before we prepare a pull request.']
 ],{instructions:'Coordinate the approved client portal plan. Delegate bounded work, track dependencies, and ask before changing scope or publishing.',checks:'pending'});
 if(!source.sessions.some(s=>s.id===lead.id))source.sessions.unshift(lead);
 ['s-api','s-ui','s-qa'].forEach(id=>{const s=source.sessions.find(s=>s.id===id);if(s)s.parentId='s-lead';});
 source.tabs.forEach(t=>{
  if(t.id==='desk'){
   t.sessions=[...new Set(['s-lead','s-api','s-ui','s-qa','s-site','s-ops',...t.sessions])];
   t.layout=fdSplit('x',fdGroup(['s-lead','plan:portal-plan']),fdSplit('y',fdGroup(['s-api','s-ui']),fdGroup(['s-site','s-ops'])),54);
  }else if(t.id==='portal-team'){
   t.sessions=[...new Set(['s-lead',...t.sessions])];
   t.layout=fdSplit('x',fdGroup(['s-lead','plan:portal-plan']),fdGroup(['s-api','s-ui','s-qa']),52);
  }else t.layout=fdGroup(t.sessions.slice());
  t.maxGroup=null;t.focusGroup=fdGroups(t.layout)[0]?.id;t.collapsed=[];t.panel='agents';
 });
 source.dockVersion=2;source.navigatorWidth=260;source.navigatorCollapsed=false;
}
fdUpgrade(fxSeed);fdUpgrade(fx);
fx.tabs.forEach(fdEnsure);
function fdCurrentGroup(t=fxTab()){fdEnsure(t);return fdNode(t?.layout,t?.focusGroup)||fdGroups(t?.layout)[0];}
function fdMember(id,t=fxTab()){
 if(!t||!fxSession(id))return;
 const chain=[];let s=fxSession(id),count=0;
 while(s&&count++<80){chain.unshift(s.id);s=fxSession(s.parentId);}
 chain.forEach(id=>{if(!t.sessions.includes(id))t.sessions.push(id);});
}
function fdCloseRef(ref,groupId,t=fxTab()){
 const group=fdNode(t.layout,groupId);if(group?.type!=='group')return;
 const index=group.tabs.indexOf(ref);group.tabs=group.tabs.filter(x=>x!==ref);
 if(group.active===ref)group.active=group.tabs[Math.max(0,index-1)];
 if(!group.tabs.length)t.layout=fdReplace(t.layout,group.id,null)||fdGroup();
 if(!fdNode(t.layout,t.maxGroup))t.maxGroup=null;
 t.focusGroup=fdNode(t.layout,t.focusGroup)?.id||fdGroups(t.layout)[0].id;
}
function fdOpen(ref,t=fxTab(),groupId){
 if(!t||!fdValid(ref))return;
 fdEnsure(t);const r=fdRef(ref);if(r.session)fdMember(r.id,t);
 let group=fdGroups(t.layout).find(g=>g.tabs.includes(ref))||fdNode(t.layout,groupId)||fdCurrentGroup(t);
 if(!group.tabs.includes(ref))group.tabs.push(ref);
 group.active=ref;t.focusGroup=group.id;t.maxGroup=null;
 if(r.session)r.session.unread=false;
}
function fdDock(ref,targetId,zone='center',t=fxTab(),before){
 if(!fdValid(ref))return false;
 fdEnsure(t);const target=fdNode(t.layout,targetId);if(target?.type!=='group')return false;
 const source=fdGroups(t.layout).find(g=>g.tabs.includes(ref));
 if(source===target&&target.tabs.length===1)return false;
 const r=fdRef(ref);if(r.session)fdMember(r.id,t);
 if(source)fdCloseRef(ref,source.id,t);
 if(zone==='center'){
  const index=before?target.tabs.indexOf(before):-1;
  if(index<0)target.tabs.push(ref);else target.tabs.splice(index,0,ref);
  target.active=ref;t.focusGroup=target.id;
 }else{
  const added=fdGroup([ref]);
  const first=zone==='left'||zone==='top',axis=zone==='left'||zone==='right'?'x':'y';
  t.layout=fdReplace(t.layout,target.id,fdSplit(axis,first?added:target,first?target:added));
  t.focusGroup=added.id;
 }
 t.maxGroup=null;return true;
}
function fdFocus(ref,groupId){
 const t=fxTab(),g=fdNode(t.layout,groupId);if(!g)return;
 fxRemember();g.active=ref;t.focusGroup=g.id;const r=fdRef(ref);if(r.session)r.session.unread=false;fxPaint();
 requestAnimationFrame(()=>document.querySelector(`[data-fd-group="${g.id}"] [data-fd-ref="${CSS.escape(ref)}"]`)?.focus({preventScroll:true}));
}
function fdContextSession(){const g=fdCurrentGroup(),r=g&&fdRef(g.active||'');return r?.session||fxSession(fxTab()?.sessions[0]);}
function fdTabSelect(id){fxRemember();fx.active=id;fdEnsure(fxTab());fxSave();if(state.route==='factory')render();else go('factory');}
fxSelectTab=fdTabSelect;
fxAttach=function(id,tab=fxTab()){if(!tab)return;fdOpen(id,tab);fx.active=tab.id;closeModal();fxSave();if(state.route==='factory')render();else go('factory');};
function fdFinish(){closeModal();fxPaint();}
function fdScale(node){if(!node)return;if(node.type==='split'){node.ratio=50;fdScale(node.a);fdScale(node.b);}}
function fdMinimum(node){if(!node||node.type==='group')return {x:285,y:265};const a=fdMinimum(node.a),b=fdMinimum(node.b);return node.axis==='x'?{x:a.x+b.x+6,y:Math.max(a.y,b.y)}:{x:Math.max(a.x,b.x),y:a.y+b.y+6};}
