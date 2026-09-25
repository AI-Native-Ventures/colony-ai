/* Review-only records. No external accounts, services or payments are accessed. */
const networks={
 instagram:{name:'Instagram',color:'#a93b81',kind:'Professional account',formats:['Image','Carousel','Video','Story'],description:'Publish content and review results for a business or creator account.'},
 tiktok:{name:'TikTok',color:'#202027',kind:'Creator account',formats:['Video','Carousel'],description:'Review creator privacy options and content disclosure before publishing.'},
 facebook:{name:'Facebook',color:'#1877f2',kind:'Page',formats:['Image','Carousel','Video','Text'],description:'Choose a Page you can manage and check its publishing permissions.'},
 linkedin:{name:'LinkedIn',color:'#0a66c2',kind:'Organization Page',formats:['Image','Carousel','Video','Text'],description:'Connect an organization Page and verify the authorized role.'},
 youtube:{name:'YouTube',color:'#e5252a',kind:'Channel',formats:['Video'],description:'Choose a channel, then review visibility and video settings.'},
 pinterest:{name:'Pinterest',color:'#bd081c',kind:'Business account',formats:['Image','Video'],description:'Choose a business account and destination board.'}
};
const studio={
 tab:'calendar',query:'',postFilter:'all',week:0,client:'all',accountNetwork:'all',accountError:'',connect:null,newContent:null,compare:null,
 accounts:[
  {id:'a-olive-ig',client:'olive',network:'instagram',name:'The Olive House',handle:'@theolivehouse',status:'connected',type:'Business',owner:'Nandi',publish:true,insights:true,inbox:true,lastSync:'23 Sep · 09:35',history:['Connected by Nandi · 15 Sep','Permissions checked · 23 Sep']},
  {id:'a-olive-fb',client:'olive',network:'facebook',name:'The Olive House',handle:'The Olive House',status:'connected',type:'Page',owner:'Nandi',publish:true,insights:true,inbox:true,lastSync:'23 Sep · 09:35',history:['Page selected by Nandi · 15 Sep']},
  {id:'a-cedar-ig',client:'cedar',network:'instagram',name:'Cedar Café',handle:'@cedarcafe',status:'expired',type:'Business',owner:'Thandi',publish:false,insights:false,inbox:false,lastSync:'22 Sep · 18:00',history:['Access expired · 23 Sep']},
  {id:'a-cedar-tt',client:'cedar',network:'tiktok',name:'Cedar Café',handle:'@cedarcafe',status:'connected',type:'Creator',owner:'Thandi',publish:true,insights:false,inbox:false,lastSync:'23 Sep · 08:20',history:['Connected by Thandi · 20 Sep']},
  {id:'a-north-li',client:'northline',network:'linkedin',name:'Northline Interiors',handle:'Northline Interiors',status:'limited',type:'Organization',owner:'Zola',publish:false,insights:true,inbox:false,lastSync:'23 Sep · 09:10',history:['Analytics access granted; publishing permission missing']}
 ],
 assets:[
  {id:'asset-olive-1',client:'olive',name:'Spring collection · brand artwork',type:'Design',source:'Approved brand library',tone:'olive',version:1,status:'ready'},
  {id:'asset-olive-2',client:'olive',name:'Product facts & styling notes',type:'Document',source:'Nandi · client brief',body:'Small-batch South African homeware. Use everyday rituals and materials as the campaign themes. Do not claim every item is handmade.',version:2,status:'ready'},
  {id:'asset-cedar-1',client:'cedar',name:'Cedar Café · morning campaign',type:'Design',source:'Client brand kit',tone:'cedar',version:1,status:'ready'},
  {id:'asset-north-1',client:'northline',name:'Northline · brand direction',type:'Design',source:'Zola · onboarding',tone:'northline',version:1,status:'ready'}
 ],
 campaigns:[{id:'spring',client:'olive',name:'A slower spring',objective:'Introduce the spring collection and send qualified visitors to the website.',audience:'People furnishing a thoughtful, everyday home.',cadence:'4 posts / week',owner:'mina',status:'active',brief:'Use everyday rituals, simple styling ideas and the spring collection. Warm, unhurried copy; no invented product claims.',due:'2026-10-02'}, {id:'morning',client:'cedar',name:'Your morning, made',objective:'Bring local customers back for their morning coffee.',audience:'People living and working near the café.',cadence:'2 posts / week',owner:'mina',status:'active',brief:'Coffee, good company and the morning routine. Use verified opening hours.',due:'2026-10-02'}, {id:'spaces',client:'northline',name:'Room to live',objective:'Introduce the studio and invite residential consultations.',audience:'Johannesburg homeowners considering a redesign.',cadence:'Awaiting scope',owner:'mina',status:'draft',brief:'Complete brand assets and agree the service before production.',due:'2026-10-05'}],
 deliveries:[],generation:{},drafts:{},feedbackSlide:'all',feedbackAudience:'internal',activeNetwork:'',reportClient:'olive',inboxSelected:'comment-1',
 inbox:[{id:'comment-1',client:'olive',network:'instagram',author:'Ayesha K.',text:'Do you deliver to Cape Town?',post:'Small changes. Softer spaces.',status:'open',draft:'',replies:[]},{id:'comment-2',client:'cedar',network:'facebook',author:'Sam P.',text:'Are you open on Saturday morning?',post:'Your morning, made',status:'open',draft:'',replies:[]}],
 money:{period:'2026-09',client:'all',query:'',costCategory:'all',tab:'overview'},
 invoices:[
  {id:'LS-026',client:'olive',date:'2026-09-01',due:'2026-09-07',title:'September social media retainer',amount:6500,status:'issued',payments:[{id:'pay-1',amount:6500,date:'2026-09-05',reference:'Bank transfer · LS-026'}],source:'Manual invoice',notes:'12 image/carousel posts, two revision rounds and one report.'},
  {id:'LS-027',client:'cedar',date:'2026-09-01',due:'2026-09-20',title:'September social media retainer',amount:4500,status:'issued',payments:[{id:'pay-2',amount:1500,date:'2026-09-10',reference:'Part payment · LS-027'}],source:'Manual invoice',notes:'8 posts and a monthly report.'},
  {id:'LS-028',client:'olive',date:'2026-09-18',due:'2026-09-30',title:'Spring campaign · additional creative',amount:3200,status:'issued',payments:[],source:'Accepted additional scope',notes:'Four additional carousel designs, agreed separately from the retainer.'},
  {id:'LS-029',client:'northline',date:'2026-09-23',due:'2026-10-01',title:'First monthly retainer',amount:8500,status:'draft',payments:[],source:'Draft from service scope',notes:'Service acceptance pending. Not included in earned revenue.'},
  {id:'LS-021',client:'olive',date:'2026-08-01',due:'2026-08-07',title:'August retainer',amount:6000,status:'issued',payments:[{id:'pay-0',amount:6000,date:'2026-08-05',reference:'Bank transfer'}],source:'Manual invoice',notes:''},
  {id:'LS-022',client:'cedar',date:'2026-08-01',due:'2026-08-07',title:'August retainer',amount:3900,status:'issued',payments:[{id:'pay-00',amount:3900,date:'2026-08-08',reference:'Bank transfer'}],source:'Manual invoice',notes:''}
 ],
 costs:[
  {id:'cost-1',date:'2026-09-03',vendor:'Zinhle Design',description:'Spring carousel production',category:'Contractors',client:'olive',amount:2700,paid:true,source:'Manual entry',receipt:'zinhle-september.pdf',recurring:false},
  {id:'cost-2',date:'2026-09-08',vendor:'AI production',description:'Image generation and agent usage',category:'AI & tools',client:'olive',amount:520,paid:true,source:'Usage record · example',receipt:'usage-september.csv',recurring:false},
  {id:'cost-3',date:'2026-09-01',vendor:'Studio software',description:'Monthly creative tools',category:'Software',client:'overhead',amount:899,paid:true,source:'Manual entry',receipt:'software-september.pdf',recurring:true},
  {id:'cost-4',date:'2026-09-21',vendor:'Morning Light Photography',description:'Cedar café photography session',category:'Contractors',client:'cedar',amount:1800,paid:false,source:'Supplier invoice',receipt:'cedar-shoot.pdf',recurring:false},
  {id:'cost-5',date:'2026-09-02',vendor:'Connectivity',description:'Studio internet',category:'Operations',client:'overhead',amount:699,paid:true,source:'Manual entry',receipt:'',recurring:true},
  {id:'cost-6',date:'2026-09-22',vendor:'Bank charges',description:'September transaction fees',category:'Fees',client:'overhead',amount:120,paid:true,source:'Manual entry',receipt:'',recurring:false},
  {id:'cost-7',date:'2026-08-10',vendor:'Studio costs',description:'August recorded costs',category:'Operations',client:'overhead',amount:3900,paid:true,source:'Imported example',receipt:'',recurring:false}
 ],
 tasks:[
  {id:'task-spring',name:'Produce the spring content campaign',client:'olive',owner:'mina',due:'2026-09-28',status:'review',budget:900,spent:320,brief:'Prepare four image/carousel posts using the approved spring brief. Present designs, captions and proposed dates for review.',deliverables:['olive-1','olive-2','olive-3','olive-4'],notes:[{by:'Mina',text:'Designs and captions are ready for review.'}],checklist:[{text:'Use approved facts and brand assets',done:true},{text:'Review each destination preview',done:true},{text:'Obtain client approval',done:false}],dependency:''},
  {id:'task-access',name:'Restore Cedar Café publishing access',client:'cedar',owner:'theo',due:'2026-09-24',status:'blocked',budget:0,spent:0,brief:'Ask the account owner to reconnect Instagram. Preserve approved content and confirm the schedule after access returns.',deliverables:[],notes:[{by:'Theo',text:'Waiting for Thandi to renew access.'}],checklist:[{text:'Reconnect the correct account',done:false},{text:'Confirm publishing permission',done:false}],dependency:'Client authorization'},
  {id:'task-onboard',name:'Complete Northline onboarding',client:'northline',owner:'aya',due:'2026-09-25',status:'active',budget:250,spent:45,brief:'Collect brand assets, confirm services and choose the named client approver.',deliverables:[],notes:[],checklist:[{text:'Business brief',done:true},{text:'Brand assets',done:false},{text:'Service scope accepted',done:false}],dependency:''}
 ],
 workView:'list',workFilter:'all',siteTab:'pages',sitePages:[{id:'home',name:'Home',path:'/',status:'Review',version:3},{id:'services',name:'Social media management',path:'/services',status:'Draft',version:1},{id:'contact',name:'Contact',path:'/contact',status:'Published',version:1}],
 domain:{name:'leratosocial.example',status:'not-connected',lastCheck:null},formSettings:{recipient:'Lerato',notify:true,thankYou:'Thanks. We’ll be in touch to learn more about your business.'},
 members:[{id:'lerato',name:'Lerato Molefe',email:'lerato@leratosocial.example',role:'Owner',status:'Active'},{id:'zinhle',name:'Zinhle Dlamini',email:'zinhle@leratosocial.example',role:'Member',status:'Active'}],preferences:{reviewRequired:true,budget:1500,timezone:'Africa/Johannesburg'},libraryClient:'all',libraryQuery:'',uploadError:'',import:null
};
agency.posts.forEach((p,i)=>{
 p.campaign=p.client==='olive'?'spring':p.client==='cedar'?'morning':'spaces';p.accountIds=[p.client==='olive'?'a-olive-ig':p.client==='cedar'?'a-cedar-ig':'a-north-li'];
 p.brief=studio.campaigns.find(c=>c.id===p.campaign).brief;p.assets=studio.assets.filter(a=>a.client===p.client).map(a=>a.id);p.method='agent';p.concept=0;p.platformCaptions={};p.production='ready';p.approvalLink='active';p.feedback=p.comments.map((c,j)=>({...c,id:p.id+'-f'+j,version:p.version,slide:'all',resolved:true,clientVisible:!!c.clientVisible}));
 p.versions=[{version:p.version,title:p.title,caption:p.caption,slides:[...p.slides],concept:0,note:'Current review version'}];
 if(p.approvedVersion===p.version)p.approval={version:p.version,accounts:[...p.accountIds],day:p.day,time:p.time,by:agencyClient(p.client).contact};
});
agencyStatus.failed=['Publish failed','red'];agencyStatus.uncertain=['Checking delivery','amber'];agencyStatus.partial=['Partially published','amber'];agencyStatus.archived=['Archived',''];
function networkLogo(id,cls=''){const n=networks[id];return n?`<span class="network-logo ${id} ${cls}"><img src="assets/networks/${id}.svg" alt="${n.name}"></span>`:'';}
function account(id){return studio.accounts.find(a=>a.id===id);}
function clientName(id){return id==='overhead'?'Agency overhead':agencyClient(id)?.name||'Unassigned';}
function postAccounts(p){return (p.accountIds||[]).map(account).filter(Boolean);}
function hasApproval(p){return p.approval?.version===p.version&&JSON.stringify(p.approval.accounts)===JSON.stringify(p.accountIds)&&p.approval.day===p.day&&p.approval.time===p.time;}
function invalidatePost(p,note='Content revised'){p.approvedVersion=null;p.approval=null;p.status='review';p.approvalLink='revoked';p.history.push({version:p.version,note});}
function snapshotPost(p,note){p.versions.push({version:p.version,title:p.title,caption:p.caption,slides:[...p.slides],concept:p.concept,assetUrl:p.assetUrl,note});}
function revisePost(p,changes,note){snapshotPost(p,'Before revision');Object.assign(p,changes);p.version++;invalidatePost(p,note);snapshotPost(p,note);}
function invoicePaid(i){return i.payments.reduce((a,p)=>a+p.amount,0);}
function invoiceBalance(i){return i.status==='issued'?Math.max(0,i.amount-invoicePaid(i)):0;}
function invoiceStatus(i){return i.status==='draft'?'Draft':i.status==='void'?'Void':invoiceBalance(i)===0?'Paid':invoicePaid(i)>0?'Part paid':i.due<'2026-09-23'?'Overdue':'Awaiting payment';}
function moneyRecords(){const m=studio.money,match=x=>m.client==='all'||x.client===m.client;return {invoices:studio.invoices.filter(i=>i.date.startsWith(m.period)&&match(i)),costs:studio.costs.filter(c=>c.date.startsWith(m.period)&&match(c))};}
function moneyTotals(){const {invoices,costs}=moneyRecords();const revenue=invoices.filter(i=>i.status==='issued').reduce((a,i)=>a+i.amount,0),expenses=costs.reduce((a,c)=>a+c.amount,0);const collected=studio.invoices.filter(i=>i.status==='issued'&&(studio.money.client==='all'||i.client===studio.money.client)).flatMap(i=>i.payments).filter(p=>p.date.startsWith(studio.money.period)).reduce((a,p)=>a+p.amount,0),paid=costs.filter(c=>c.paid).reduce((a,c)=>a+c.amount,0);return {revenue,expenses,collected,paid,outstanding:invoices.reduce((a,i)=>a+invoiceBalance(i),0),profit:revenue-expenses,cash:collected-paid,margin:revenue?(revenue-expenses)/revenue*100:0};}
