/* Review-only work area. Conversations own local views; messages own shared artifacts. */
const waKey='colony-conversation-workarea-v1';
let waStore={version:1,contexts:{}};
try{const saved=JSON.parse(localStorage.getItem(waKey));if(saved?.version===1&&saved.contexts)waStore=saved;}catch{}
const waId=()=> 'wa-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
const waSampleURL='https://olivehouse.example/';
function waContext(route=state.route){return route==='workspace/empty'?'review:empty':route.startsWith('workspace/')?'review:website':route;}
function waSupported(){return /^(workspace|channel|thread|agency-thread|dm|topic)\//.test(state.route);}
function waGet(key=waContext()){
 if(!waStore.contexts[key])waStore.contexts[key]={key,open:key==='review:website',tabs:[],active:null,closed:[],placement:'right',width:64,height:55,expanded:false};
 return waStore.contexts[key];
}
function waSave(){try{localStorage.setItem(waKey,JSON.stringify(waStore));}catch{toast('This device could not save the work area. Keep this window open.');}}
function waTab(w=waGet()){return w.tabs.find(t=>t.id===w.active);}
function waMake(kind,url=''){
 const names={browser:'New tab',brief:'Campaign brief',report:'September report',image:'Campaign design',notes:'Notes',terminal:'Terminal',changes:'Changes'};
 return {id:waId(),kind,title:names[kind],url:'',history:[],cursor:-1,scroll:0,text:'',log:[],project:'portal',device:'desktop',control:'you',comments:[],selection:null,...(kind==='browser'&&url?{url,history:[url],cursor:0,title:waPageTitle(url)}:{})};
}
function waPageTitle(url){try{const u=new URL(url);return u.hostname==='olivehouse.example'?(u.pathname.startsWith('/collection')?'Spring collection':'The Olive House'):u.hostname==='localhost'?(u.pathname==='/website'?'Agency website':u.pathname==='/reports'?'Studio reports':'Client portal'):u.hostname==='accounts.example'?'Sign in':u.hostname==='offline.example'?'Page unavailable':u.hostname;}catch{return 'New tab';}}
function waSafeURL(raw){const value=raw.trim();if(!value)return '';try{const u=new URL(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^localhost:\d+/i.test(value)?value:'https://'+value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;return u.href;}catch{return null;}}
function waNavigate(t,raw){const url=waSafeURL(raw);if(url===null)return false;t.url=url;t.title=waPageTitle(url);t.history=t.history.slice(0,t.cursor+1);t.history.push(url);t.history=t.history.slice(-40);t.cursor=t.history.length-1;t.scroll=0;t.selection=null;t.annotating=false;return true;}
function waAdd(kind,url='',w=waGet()){
 if(w.tabs.length>=12){toast('This review supports 12 tabs per conversation. Close a tab to continue.');return;}
 let t=w.tabs.find(t=>kind!=='browser'?t.kind===kind:url&&t.kind===kind&&t.url===url);
 if(!t){t=waMake(kind,url);w.tabs.push(t);}w.active=t.id;w.open=true;return t;
}
function waClose(id,w=waGet()){const i=w.tabs.findIndex(t=>t.id===id);if(i<0)return;w.closed.push({tab:w.tabs[i],index:i});w.closed=w.closed.slice(-8);w.tabs.splice(i,1);if(w.active===id)w.active=w.tabs[Math.max(0,i-1)]?.id||null;if(!w.tabs.length){w.open=false;w.expanded=false;}}
function waReopen(w=waGet()){const c=w.closed.pop();if(!c)return;w.tabs.splice(Math.min(c.index,w.tabs.length),0,c.tab);w.active=c.tab.id;w.open=true;}
function waFactory(session){const w=waGet('factory:'+session.id);if(!w.tabs.length)waAdd('browser',waProjectURL(session.project),w);return w;}
function waRemember(){document.querySelectorAll('[data-wa-scroll]').forEach(el=>{const w=waStore.contexts[el.dataset.waScope],t=w?.tabs.find(t=>t.id===el.dataset.waScroll);if(t)t.scroll=el.scrollTop;});saveExperience();}
function waPaint(){waSave();waBaseRender();}

function waProjectURL(project){return 'http://localhost:3000/'+({website:'website',ops:'reports'}[project]||'');}
function waAgentName(w){return w.key.startsWith('factory:')?(fxSession(w.key.slice(8))?.title||'Agent'):'Mina';}
