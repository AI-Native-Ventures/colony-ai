/* Separate design-review fixtures. Production derives capabilities from the Rust runtime catalog. */
const agentHarnesses={
 claude:{name:'Claude Code',logo:'claude.png',providers:['Anthropic'],models:{Anthropic:['Claude Sonnet 4.6','Claude Opus 4.6']},installed:true,native:true,command:'claude-agent-acp'},
 codex:{name:'Codex',logo:'codex.webp',providers:['OpenAI'],models:{OpenAI:['GPT-5.4','GPT-5.4 Mini']},installed:true,native:true,command:'codex-acp'},
 colony:{name:'Colony Agent',logo:null,providers:['Colony credits','OpenRouter','Anthropic','OpenAI','OpenAI-compatible','Databricks','Databricks v2'],installed:true,command:'colony-agent'},
 opencode:{name:'OpenCode',logo:'opencode.ico',providers:['OpenRouter','Anthropic','OpenAI','Google'],installed:true,command:'opencode acp'},
 pi:{name:'Pi',logo:'pi.svg',providers:['Managed in Pi'],harnessOwned:true,installed:false,command:'pi-acp'},
 omp:{name:'Oh My Pi',logo:'omp.svg',providers:['OpenRouter','Anthropic','OpenAI','Google'],installed:true,command:'omp acp'},
 prime:{name:'Prime Agent',logo:'prime-mark.jpg',providers:['OpenRouter','Anthropic','OpenAI','Google'],installed:false,command:'prime acp'}
};
function agentModels(engine,provider){return agentHarnesses[engine]?.models?.[provider]||({'Colony credits':['Colony default'],OpenRouter:['anthropic/claude-sonnet-4.6','openai/gpt-5.4'],Anthropic:['Claude Sonnet 4.6','Claude Opus 4.6'],OpenAI:['GPT-5.4','GPT-5.4 Mini'],Google:['Gemini 2.5 Pro','Gemini 2.5 Flash'],'OpenAI-compatible':['Endpoint model'],'Databricks':['Workspace model'],'Databricks v2':['Workspace model'],'Managed in Pi':['Harness default']})[provider]||[];}
const agentExamples=[['Nia','Customer care','operations'],['Atlas','Market research','sales'],['Kira','Email campaigns','marketing'],['Remy','Bookkeeping','operations'],['Indigo','Product photography','marketing'],['Sage','Supplier research','operations'],['Noor','Copywriting','marketing'],['Ari','Website development','marketing'],['Echo','Customer feedback','sales'],['Luca','Inventory planning','operations'],['Iris','Retail partnerships','sales'],['Orion','Data analysis','operations'],['Faye','Social content','marketing'],['Juno','Quality assurance','operations'],['Sol','Pricing research','sales'],['Piper','Community','marketing'],['Vale','Delivery planning','operations'],['Wren','Content editing','marketing'],['Ash','Customer onboarding','sales'],['Kai','Purchase orders','operations'],['Lyra','Search visibility','marketing'],['Rumi','Competitor research','sales'],['Cleo','Campaign reporting','marketing'],['Aster','Product descriptions','marketing'],['Uma','Returns & support','operations'],['Milo','Sales reporting','sales']];
agentExamples.forEach(([name,role,channel],i)=>team.push({id:name.toLowerCase(),name,role,initials:name[0],tone:['blue','sage','rose','human'][i%4],description:`Owns ${role.toLowerCase()} for Lerato Studio.`,exampleChannel:channel,status:'Available'}));
const agentOps={query:'',status:'all',harness:'all',sort:'name',tab:'agents',drafts:{},returnTo:'team',activityChannel:'all',configs:{},defaultConfig:{engine:'colony',provider:'Colony credits',model:'Colony default',effort:'Default'},templates:[],connections:{Anthropic:'Connected',OpenAI:'Connected',OpenRouter:'Connected','OpenAI-compatible':'Not connected',Databricks:'Not connected','Databricks v2':'Not connected','Colony credits':'Connected'},recentDMs:['scout','aya','mina','theo']};
team.forEach((a,i)=>{
 const engine=['claude','codex','colony','opencode','omp'][i%5],h=agentHarnesses[engine],provider=h.providers[0],channel=a.exampleChannel||({scout:'sales',aya:'sales',mina:'marketing',theo:'operations'})[a.id];
 a.harness=h.name;a.logo=h.logo;
 agentOps.configs[a.id]={engine,provider,model:agentModels(engine,provider)[0],effort:engine==='claude'?'Managed by harness':'Default',runtime:i===9?'unknown':i===12?'needs_setup':i>6&&i%6===0?'stopped':i%4===1?'working':'idle',presence:i===9?'Unknown':i===12||i>6&&i%6===0?'Offline':'Online',managed:i===9?'other':'local',voiceCapable:i<4,owner:i===9?'Thandi Jacobs':'Lerato Molefe',runOn:i===9?'Not reported':'This Mac',lastActive:i===9?'Not reported':i%4===1?'Now':'09:52',channels:[channel],access:'Only me',allowed:'',context:'Each thread',parallelism:2,autostart:i<4,workdir:'~/Colony/Lerato Studio',command:h.command,env:'LOG_LEVEL=info',prompt:`You are ${a.name}, responsible for ${a.role.toLowerCase()} at Lerato Studio.\n\n${a.description}\n\nUse the business knowledge and the conversation you were asked to work in. State what you found, keep source references, and flag missing information rather than guessing.\n\nDo not contact customers, spend money, publish material or change an agreement without Lerato’s approval. Bring decisions back into the source conversation with the relevant record attached.`,promptVersion:1,tools:[{name:'Colony workspace',description:'Messages, work and business records',enabled:true,command:'colony mcp'},{name:'Business files',description:'Files inside the agent working folder',enabled:i<4,command:'colony-dev-mcp'}],pendingRestart:false,archived:false,events:[],error:i===12?'Your provider session expired. Reconnect before starting this agent.':''};
 if(i===9){Object.assign(agentOps.configs[a.id],{engine:null,provider:null,model:null,effort:null,command:null,env:'',workdir:null,prompt:'',tools:[]});a.harness='—';a.logo=null;}
});
agentOps.templates=['scout','aya','mina','theo'].map(id=>({id:'template-'+id,name:person(id).name+' template',role:person(id).role,description:person(id).description,config:structuredClone(agentOps.configs[id])}));
function agentConfig(id){return agentOps.configs[id];}
function agentStatus(c){return c.archived?'Archived':({working:'Working',idle:'Idle',stopped:'Stopped',needs_setup:'Needs connection',unknown:'Unknown'})[c.runtime]||'Unknown';}
function agentStatusTone(c){return c.archived?'':({working:'blue',idle:'green',needs_setup:'red',stopped:'',unknown:''})[c.runtime];}
function agentDraft(id){return agentOps.drafts[id]||(agentOps.drafts[id]=structuredClone(agentConfig(id)));}
function agentDirty(id){return !!agentOps.drafts[id]&&JSON.stringify(agentOps.drafts[id])!==JSON.stringify(agentConfig(id));}
function agentLogo(engine){const h=agentHarnesses[engine];return h?`<span class="engine-logo" aria-hidden="true">${h.logo?`<img src="../onboarding/assets/harnesses/${h.logo}" alt="">`:`<img src="../assets/colony-icon-v2.svg" alt="">`}</span>`:'<span class="engine-logo">—</span>';}
function agentOptions(items,value){return items.map(x=>`<option value="${esc(x)}" ${x===value?'selected':''}>${esc(x)}</option>`).join('');}

Object.assign(agentOps.configs.echo,{engine:'opencode',provider:'OpenRouter',model:'anthropic/claude-sonnet-4.6',command:'opencode acp'});Object.assign(person('echo'),{harness:'OpenCode',logo:'opencode.ico'});

Object.entries(channels).forEach(([id,c])=>c.members=team.filter(a=>agentConfig(a.id).channels.includes(id)).map(a=>a.id));

// Provider marks are distinct from the harness that uses the connection.
function providerLogo(provider){
 const sources={Anthropic:'assets/providers/anthropic.png',OpenAI:'../onboarding/assets/harnesses/codex.webp',Databricks:'assets/providers/databricks.png','Databricks v2':'assets/providers/databricks.png','Colony credits':'../assets/colony-icon-v2.svg'};
 const name=provider==='OpenAI-compatible'?'endpoint':provider.toLowerCase().replace(/[^a-z]+/g,'-');
 if(provider==='OpenRouter')return '<span class="provider-logo provider-openrouter" aria-hidden="true"><img class="provider-light" src="../onboarding/assets/harnesses/openrouter.svg" alt=""><img class="provider-dark" src="../onboarding/assets/harnesses/openrouter-dark.svg" alt=""></span>';
 if(sources[provider])return `<span class="provider-logo provider-${name}" aria-hidden="true"><img src="${sources[provider]}" alt=""></span>`;
 return '<span class="provider-logo provider-endpoint" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-12-2 18"/></svg></span>';
}
