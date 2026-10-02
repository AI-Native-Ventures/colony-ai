/* Presentation-only avatar integration; human identities retain their own image/initials. */
(()=>{
const original=avatar;
ColonyHeads.register(team.map(agent=>agent.id));
avatar=function(id,size=''){
if(!team.some(agent=>agent.id===id))return original(id,size);
const variant=ColonyHeads.index(id);
return `<span class="avatar colony-agent-head ${size}" data-head-variant="${variant+1}" aria-hidden="true">${ColonyHeads.art(variant)}</span>`;
};
})();
