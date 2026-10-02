/* One palette per visit, shared by the landing page and its same-origin demos. */
(()=>{
'use strict';
const palettes={
 sage:{ink:'#293b30',muted:'#62715d',accent:'#168343',light:'#3b9e4e',paper:'#faf9f1',wash:'#dbf6ce',line:'#bfdfbc',a:'#8ff063',b:'#e3fac5',c:'#31bb75'},
 iris:{ink:'#353145',muted:'#72677f',accent:'#763dde',light:'#8f55da',paper:'#faf7fc',wash:'#eedcfe',line:'#d9bdf5',a:'#c48aff',b:'#f8d8f5',c:'#9368f4'},
 rose:{ink:'#473236',muted:'#83676c',accent:'#c93971',light:'#d64a89',paper:'#fcf7f5',wash:'#ffe0eb',line:'#f2b8cf',a:'#ff8fbc',b:'#ffe8cf',c:'#f45fa2'},
 coast:{ink:'#293b47',muted:'#637783',accent:'#087abb',light:'#2189bd',paper:'#f5f9fb',wash:'#d4f3ff',line:'#a8dfee',a:'#69d9ff',b:'#cef6f1',c:'#4b9df5'},
 amber:{ink:'#44392e',muted:'#7e705d',accent:'#b85c15',light:'#bd7828',paper:'#fbf8f0',wash:'#ffedc7',line:'#eed098',a:'#ffcf5a',b:'#fff1c6',c:'#ff965b'}
};
let id;
if(window!==parent){try{id=parent.document.documentElement.dataset.palette;}catch{}}
if(!palettes[id]){
 const ids=Object.keys(palettes);let last;
 try{last=sessionStorage.getItem('colony-last-palette');}catch{}
 const choices=ids.filter(x=>x!==last);id=choices[Math.floor(Math.random()*choices.length)];
 try{sessionStorage.setItem('colony-last-palette',id);}catch{}
}
const root=document.documentElement;root.dataset.palette=id;
for(const [key,value] of Object.entries(palettes[id]))root.style.setProperty('--p-'+key,value);
})();
