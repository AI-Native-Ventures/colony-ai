/* Local design-review state. No external services or production mutations. */
const M={actions:{},notice:'',draft:{},newRoutes:[],audit:[],saved:{}};
const mx=x=>escape(String(x??''));
const mb=(text,action,cls='',attrs='')=>`<button class="button ${cls}" data-m="${action}" ${attrs}>${text}</button>`;
const ml=(text,to,cls='')=>link(text,to,cls);
const mf=(title,key,value,type='text')=>`<label class="form-field">${title}<input data-m-field="${key}" type="${type}" value="${mx(value)}"></label>`;
const ma=(title,key,value,rows=5)=>`<label class="form-field">${title}<textarea data-m-field="${key}" rows="${rows}">${mx(value)}</textarea></label>`;
const ms=(title,key,value,options)=>`<label class="form-field">${title}<select data-m-field="${key}">${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${mx(v)}" ${String(value)===String(v)?'selected':''}>${mx(t)}</option>`;}).join('')}</select></label>`;
const mt=(title,key,on,detail='')=>`<label class="toggle-row"><span><strong>${title}</strong><small>${detail}</small></span><input data-m-field="${key}" type="checkbox" ${on?'checked':''}></label>`;
const mr=(title,sub,action,mark='',trail='')=>`<button class="setting-row" data-m="${action}">${mark?`<span class="row-mark">${mark}</span>`:''}<span><strong>${mx(title)}</strong><small>${mx(sub)}</small></span>${trail||icon('arrow')}</button>`;
const mPage=(title,body,back='business',footer='')=>flowFrame(title,`<div class="m-page">${M.notice?`<div class="m-notice" role="status">${mx(M.notice)}</div>`:''}${body}</div>`,{back,footer});
function mRoute(path,title,draw){route(path,title,path.split('/')[0],draw,'Record-specific mobile review · Sample data');M.newRoutes.push(path);}
function mGo(path){M.notice='';goFlow(path);}
function mAction(key,fn){M.actions[key]=fn;return key;}
function mFlash(text){M.notice=text;render();}
function mLog(action){M.audit.unshift({time:'10:42',who:'Lerato',action});}
const mFacts=dFacts;
const mHeading=(title,sub='')=>`<div class="m-heading"><h1>${title}</h1>${sub?`<p>${mx(sub)}</p>`:''}</div>`;
const mTabs=(items,active)=>tabs(items,active);
const mEmpty=(title,desc,to,cta)=>`<div class="m-empty">${icon('file')}<h2>${title}</h2><p>${desc}</p>${ml(cta,to,'primary')}</div>`;
document.addEventListener('input',e=>{const k=e.target.dataset.mField;if(k&&e.target.type!=='password')M.draft[k]=e.target.value;},true);
document.addEventListener('change',e=>{const k=e.target.dataset.mField;if(k&&e.target.type!=='password'){M.draft[k]=e.target.type==='checkbox'?e.target.checked:e.target.value;if(M.actions['change:'+k])M.actions['change:'+k](M.draft[k]);}},true);
document.addEventListener('click',e=>{const el=e.target.closest('[data-m]');if(!el)return;e.stopImmediatePropagation();if(!el.disabled)M.actions[el.dataset.m]?.(el);},true);
