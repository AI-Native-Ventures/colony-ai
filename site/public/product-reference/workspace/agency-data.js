/* Fictional, session-only agency data. No network or external account operations. */
const agency = {
  client: 'all', view: 'calendar', day: 0, slide: 0, siteDevice: 'desktop', siteMode: 'draft',
  clients: [
    {id:'olive',name:'The Olive House',initials:'OH',contact:'Nandi',email:'nandi@olivehouse.example',industry:'Homeware & interiors',tone:'olive',status:'Active',retainer:6500,scope:12,used:8,voice:'Warm, considered, unhurried. Talk about everyday rituals, materials and the people who make them.',facts:'Small-batch homeware. Made in South Africa. Never claim that all products are handmade.',account:'@theolivehouse.example',connection:'Connected',brief:true,assets:true,approver:true,channel:'olive',campaign:'A slower spring'},
    {id:'cedar',name:'Cedar Café',initials:'CC',contact:'Thandi',email:'thandi@cedarcafe.example',industry:'Neighbourhood café',tone:'cedar',status:'Active',retainer:4500,scope:8,used:5,voice:'Neighbourly, bright and straightforward. Make a morning coffee feel like a small occasion.',facts:'Open Monday–Saturday, 07:00–16:00. Seasonal menu; confirm prices before publishing.',account:'@cedarcafe.example',connection:'Expired',brief:true,assets:true,approver:true,channel:'cedar',campaign:'Your morning, made'},
    {id:'northline',name:'Northline Interiors',initials:'NI',contact:'Zola',email:'zola@northline.example',industry:'Interior design studio',tone:'northline',status:'Onboarding',retainer:8500,scope:12,used:0,voice:'Confident, precise and quietly inviting. Explain the choices behind a room.',facts:'Johannesburg-based interior design practice. Residential consultations by appointment.',account:'@northline.example',connection:'Not connected',brief:true,assets:false,approver:false,channel:'northline',campaign:'Room to live'}
  ],
  posts: [
    {id:'olive-1',client:'olive',title:'Make room for slow mornings',format:'Carousel',day:0,time:'09:00',status:'review',version:2,caption:'A little space. A favourite cup. A slower start. Meet the pieces that make an ordinary morning feel like yours. Explore our spring edit at the link in our bio.',slides:['Make room for slow mornings.','Objects with a little more meaning.','Find your everyday favourites.'],history:[{version:1,note:'First draft by Mina'},{version:2,note:'Lerato asked for a quieter opening'}],comments:[{author:'Lerato',text:'Let the first slide breathe. Keep the product detail on slide two.'},{author:'Mina',text:'Updated in v2. The caption and three slides are ready for your review.'}],approvedVersion:null},
    {id:'cedar-1',client:'cedar',title:'Your morning, made',format:'Image',day:0,time:'07:00',status:'blocked',version:1,caption:'Your usual, or something new? We are here from seven. Come on in.',slides:['Your morning, made.'],history:[{version:1,note:'Client-approved draft'}],comments:[{author:'Theo',text:'Publishing is paused until Thandi renews the Instagram connection.'}],approvedVersion:1},
    {id:'olive-2',client:'olive',title:'Meet your everyday favourites',format:'Image',day:1,time:'12:00',status:'client',version:1,caption:'Pieces you reach for, again and again. Discover our spring edit.',slides:['Everyday. Anything but ordinary.'],history:[{version:1,note:'Sent to Nandi for review'}],comments:[{author:'Mina',text:'Nandi can review the image, caption and proposed date together.'}],approvedVersion:null},
    {id:'northline-1',client:'northline',title:'A room that feels like you',format:'Carousel',day:2,time:'11:00',status:'draft',version:1,caption:'Good spaces begin with how you live. A first look at our approach to residential interiors.',slides:['A room that feels like you.','Start with the way you live.','Make space for what matters.'],history:[{version:1,note:'Concept awaiting client brand assets'}],comments:[],approvedVersion:null},
    {id:'olive-3',client:'olive',title:'Small changes. Softer spaces.',format:'Carousel',day:3,time:'09:00',status:'scheduled',version:1,caption:'A new texture. A warmer corner. Small changes can make a space your own.',slides:['Small changes. Softer spaces.','Bring a little warmth home.'],history:[{version:1,note:'Approved by Nandi · 22 Sep'}],comments:[],approvedVersion:1},
    {id:'cedar-2',client:'cedar',title:'See you on the sunny side',format:'Image',day:4,time:'08:00',status:'review',version:1,caption:'Coffee, good company, and a seat in the morning sun. See you this weekend.',slides:['See you on the sunny side.'],history:[{version:1,note:'Prepared by Mina'}],comments:[],approvedVersion:null},
    {id:'olive-4',client:'olive',title:'An invitation to slow down',format:'Image',day:4,time:'16:00',status:'approved',version:1,caption:'A quieter weekend starts at home. Discover the spring edit.',slides:['An invitation to slow down.'],history:[{version:1,note:'Approved by Nandi · 23 Sep'}],comments:[],approvedVersion:1}
  ],
  invoices:[{id:'LS-028',client:'olive',amount:6500,due:'30 Sep',status:'Due'},{id:'LS-027',client:'cedar',amount:4500,due:'20 Sep',status:'Overdue'},{id:'LS-029',client:'northline',amount:8500,due:'On acceptance',status:'Draft'}],
  site:{version:3,liveVersion:2,title:'Good content. More time for your business.',subtitle:'Social media, thoughtfully managed. We plan, create and look after your content, so you can get back to the business you love.',service:'Social, taken care of.',price:'From R 4,500 / month',cta:'Tell us about your business',published:false,history:[]},
  enquiries:[{id:'enquiry-1',name:'Bloom Florist',contact:'Ayesha',email:'ayesha@bloom.example',message:'We need consistent Instagram content for our flower studio. Can you help with 8 posts a month?',source:'Website · Retainer enquiry form',status:'New',time:'09:18'}],
  channelNotes:{}, demoPublished:0
};
const agencyDays=['Mon, 28 Sep','Tue, 29 Sep','Wed, 30 Sep','Thu, 1 Oct','Fri, 2 Oct'];
const agencyStatus={draft:['Draft',''],review:['Your review','rose'],client:['Client review','amber'],changes:['Changes requested','amber'],approved:['Approved','green'],scheduled:['Scheduled','blue'],blocked:['Connection issue','red'],published:['Published · demo','green']};
function agencyClient(id){return agency.clients.find(c=>c.id===id);}
function agencyPost(id){return agency.posts.find(p=>p.id===id);}
function agencyPosts(){return agency.posts.filter(p=>agency.client==='all'||p.client===agency.client);}
function agencyBadge(p){const [label,tone]=agencyStatus[p.status];return pill(label,tone);}
function agencyDate(p){return agencyDays[p.day]+' · '+p.time+' SAST';}
function agencyMark(c){return `<span class="agency-mark ${c.tone}" aria-hidden="true">${esc(c.initials)}</span>`;}
function agencyAction(label,action,id='',style='secondary small'){return `<button class="${style}" data-agency="${action}" data-id="${esc(id)}">${label}</button>`;}
function agencyFilter(){return `<label class="agency-client-filter">${icon('briefcase')}<span class="sr-only">Filter by client</span><select aria-label="Filter by client" data-agency-filter><option value="all" ${agency.client==='all'?'selected':''}>All clients</option>${agency.clients.map(c=>`<option value="${c.id}" ${agency.client===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>`;}
state.business='Lerato Social';
team.find(a=>a.id==='mina').role='Social media manager';
team.find(a=>a.id==='mina').status='Preparing client content';
team.find(a=>a.id==='aya').description='Finds agency clients and prepares proposals for their social media needs.';
agency.clients.forEach(c=>{channels[c.id]={name:c.name,description:c.campaign,members:['mina','theo','scout'],icon:'hash'};['mina','theo','scout'].forEach(id=>{const cfg=agentConfig(id);if(!cfg.channels.includes(c.id))cfg.channels.push(c.id);});});
state.leads.forEach(l=>{l.fit='Potential client for managed social content';l.campaign='agency-prospects';});
state.campaign.name='Independent brands needing social support';
state.tasks.push({id:'agency-review',name:'Review The Olive House campaign',owner:'mina',status:'review',due:'Today',channel:'Marketing',reviewer:'human',reviewAt:'09:42'}, {id:'agency-access',name:'Renew Cedar Café account access',owner:'theo',status:'blocked',due:'Today',channel:'Operations',reviewer:'human',reviewAt:'09:30'}, {id:'agency-onboard',name:'Complete Northline brand brief',owner:'aya',status:'active',due:'Tomorrow',channel:'Sales'});

agency.site.live={...agency.site,title:"Your social media, in good hands.",live:undefined,history:undefined};

state.sections.forums=false;
state.sections.direct=false;
