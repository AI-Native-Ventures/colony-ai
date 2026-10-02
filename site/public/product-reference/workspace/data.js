const demoLeads = [
 ['the-olive-house','The Olive House','Parkhurst, Johannesburg','Independent homeware boutique','NH','Nandi','Open to locally made collections','Website + business directory',94,'qualified',18500],
 ['form-field','Form & Field','Woodstock, Cape Town','Design-led home and living store','JM','Jules','Carries ceramics and small-batch textiles','Business directory',91,'new',12500],
 ['sunday-edit','The Sunday Edit','Rosebank, Johannesburg','Lifestyle and gift store','AK','Ayesha','Seasonal ranges with a local maker focus','Website + business directory',89,'new',8500],
 ['stillroom','Stillroom','Stellenbosch, Western Cape','Home decor boutique','LS','Lea','Natural materials and everyday objects','Public website',88,'contacted',16000],
 ['gather-house','Gather House','Morningside, Durban','Home and gifting retailer','TN','Thandi','Growing collection of South African makers','Business directory',86,'new',9500],
 ['common-ground','Common Ground Store','Melville, Johannesburg','Independent design retailer','PB','Palesa','Modern craft and thoughtful gifts','Public website',85,'new',11000],
 ['clay-collective','The Clay Collective','Gardens, Cape Town','Ceramics and homeware gallery','SN','Sam','Stockist programme for local ceramicists','Public website',84,'new',14500],
 ['woven-living','Woven Living','Brooklyn, Pretoria','Textile and interiors boutique','KV','Kea','Natural fibre and handmade home goods','Business directory',82,'proposal',22000],
 ['little-kin','Little Kin','Linden, Johannesburg','Neighbourhood gift shop','ML','Maya','Thoughtful gifts and locally made objects','Public website',81,'new',6500],
 ['north-note','North Note','Ballito, KwaZulu-Natal','Coastal homeware store','DL','Dineo','Small seasonal retail collections','Business directory',79,'new',7500],
 ['studio-local','Studio Local','Observatory, Cape Town','Design and craft concept store','ZN','Zoe','Features new independent makers monthly','Public website',77,'new',9000],
 ['cedar-co','Cedar & Co.','Somerset West, Western Cape','Home decor and lifestyle','RG','Rene','Established homeware and gift selection','Business directory',75,'won',18000]
];
function seedLeads(){return demoLeads.map((l,i)=>({id:l[0],name:l[1],location:l[2],type:l[3],initials:l[4],contact:l[5],fit:l[6],source:l[7],score:l[8],stage:l[9],value:l[10],accepted:i===0||i===3||i===7||i===11,selected:false,note:'',campaign:'stockists',tone:['sage','peach','blue','rose'][i%4],website:l[0]+'.example',email:'hello@'+l[0]+'.example'}));}
const team = [
 {id:'scout',name:'Scout',role:'Business partner',initials:'S',tone:'scout',status:'Available',harness:'Claude Code',logo:'claude.png',description:'Helps you plan, connects the work and brings decisions back to you.'},
 {id:'aya',name:'Aya',role:'Sales & discovery',initials:'A',tone:'blue',status:'Reviewing prospects',harness:'Codex',logo:'codex.webp',description:'Finds prospective customers, qualifies leads and prepares thoughtful outreach.'},
 {id:'mina',name:'Mina',role:'Brand & content',initials:'M',tone:'rose',status:'Collection lookbook',harness:'Colony Agent',logo:null,description:'Keeps your voice consistent across campaigns, content and customer material.'},
 {id:'theo',name:'Theo',role:'Operations',initials:'T',tone:'sage',status:'Available',harness:'OpenCode',logo:'opencode.ico',description:'Organises delivery, keeps work moving and catches operational gaps.'}
];
const state = {
 route:'today',business:'Lerato Studio',dark:false,first:false,leads:seedLeads(),selected:new Set(),
 discovery:{mode:'businesses',industry:null,query:''},leadQuery:'',leadFilter:'all',leadSort:'fit',leadView:'list',
 campaign:{id:'stockists',name:'Spring collection stockists',industry:'home-living',vertical:'home-decor-gift-shops',label:'Home Decor & Gift Shops',location:'South Africa',target:50,budget:2.50,status:'complete',count:12,created:false,mode:'businesses',error:''},
 shared:false,sharedIds:[],threadMessages:[],channelMessages:{sales:[],marketing:[],operations:[]},directMessages:{},forumReplies:[],newTopics:[],newChannels:[],
 proposal:{status:'review',version:2,note:'',approvedAt:null},workFilter:'all',libraryFilter:'all',libraryQuery:'',knowledge:[],channelView:'discussion',forumFilter:'all',runToken:0,
 tasks:[{id:'stockists',name:'Find stockists for the spring collection',owner:'aya',status:'review',due:'Today',channel:'Sales'},{id:'proposal',name:'Prepare The Olive House proposal',owner:'aya',status:'review',due:'Today',channel:'Sales'},{id:'lookbook',name:'Spring collection lookbook',owner:'mina',status:'active',due:'Tomorrow',channel:'Marketing'},{id:'delivery',name:'Confirm sample delivery dates',owner:'theo',status:'active',due:'Fri, 25 Sep',channel:'Operations'}],
 settings:{notifications:true,approvals:true},detail:null,scrolls:{},replyTimer:0
};
const stageNames = {new:'New',qualified:'Qualified',contacted:'In conversation',proposal:'Proposal',won:'Won'};
const channels={sales:{name:'Sales',description:'From first hello to lasting partnerships.',members:['aya','scout'],icon:'hash'},marketing:{name:'Marketing',description:'Our story, shared with care.',members:['mina','scout'],icon:'hash'},operations:{name:'Operations',description:'The work behind the work.',members:['theo','scout'],icon:'hash'}};
const documents=[{id:'proposal',title:'The Olive House · stockist proposal',type:'Proposal',owner:'Aya',updated:'Today',tone:'rose'}, {id:'lookbook',title:'Spring collection lookbook',type:'Lookbook',owner:'Mina',updated:'Today',tone:'peach'},{id:'brand',title:'The Lerato Studio brand guide',type:'Knowledge',owner:'Lerato',updated:'21 Sep',tone:'blue'},{id:'pricing',title:'Wholesale pricing & terms',type:'Spreadsheet',owner:'Lerato',updated:'20 Sep',tone:'sage'}];

state.campaigns=[state.campaign];
