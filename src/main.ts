import './styles.css';
import type {SupabaseClient,User} from '@supabase/supabase-js';
import type {Cfg,Flag,Option,PassCol,PassFields,RawFlag,SaveState} from './types';
import {flagGroup,sameFlag,oneCardPerFlag,mergeSaves,candidates,norm,KNOWN,MC_DONE,REGS,POOLS,MODES,TIMES,destinationOptions,destRegs,prio,applyAnswer,flightCode,parseFlight,isKnown,needsWork} from './logic';
const {default:RAW}=await import('./flags.json');
const EXTRA:Record<string,string[]>={'United States':['us','america'],'United Kingdom':['uk','britain','greatbritain'],'Netherlands':['holland'],'Myanmar':['burma'],'Eswatini':['swaziland'],'North Macedonia':['macedonia'],'Czechia':['czechrepublic'],'Turkey':['turkiye'],'Timor-Leste':['easttimor'],'Cape Verde':['caboverde'],'Vatican City':['vatican','holysee'],'Republic of the Congo':['congobrazzaville'],'South Korea':['korea'],'Russia':['russianfederation']};
const FLAGS:Flag[]=(RAW as RawFlag[]).map(f=>{
  const reg=f.r==='Americas'?(f.s==='South America'?'South America':'North America'):f.r,meta=[f.s,reg,f.k==='un'?'UN member':'Non-UN'].filter((v,i,a)=>v&&a.indexOf(v)===i);
  return {...f,a:new Set([...f.a,...(EXTRA[f.n]||[])]),reg,meta,tags:[f.r,...meta].map(norm)};
});
const BY_NAME=new Map(FLAGS.map(f=>[f.n,f]));
// a typed answer is right if it names any place that flies this exact flag
const accepts=(f:Flag,v:string)=>flagGroup(f.n).some(n=>BY_NAME.get(n)?.a.has(v));
const alsoFlown=(f:Flag)=>flagGroup(f.n).filter(n=>n!==f.n);

const store={get<T>(k:string,d:T):T{try{const v=localStorage.getItem('fs.'+k);return v?JSON.parse(v) as T:d}catch{return d}},set(k:string,v:unknown){try{localStorage.setItem('fs.'+k,JSON.stringify(v))}catch{}}};
const DEF:Cfg={pace:'learn',hap:true,kbd:'app',mode:'adaptive',dur:120,pool:'un',dest:'world',regs:REGS.slice()};
// everything worth keeping lives in one object: history, marks, best scores, settings
let S:SaveState=store.get<SaveState|null>('state',null)||{hist:store.get('hist',{}),marks:[],best:{},cfg:store.get('cfg',{}),t:0};
let cfg=Object.assign({},DEF,S.cfg),hist=S.hist,marks=new Set(S.marks);
cfg.regs=destRegs(cfg.dest);
// conf[name][otherName] = times a player answered otherName for this flag; kat[name] = when it first became known
let conf=S.conf||{},kat=S.kat||{};
let cloud:{set:(st:SaveState)=>PromiseLike<void>}|null=null,saveTimer:ReturnType<typeof setTimeout>|undefined;
function persist(){
  S={hist,marks:[...marks],best:S.best,cfg,conf,kat,t:Date.now()};
  store.set('state',S);
  clearTimeout(saveTimer);
  if(cloud)saveTimer=setTimeout(()=>cloud?.set(S).then(()=>sync(true),()=>sync(false,'Account save failed, kept in this browser')),600);
}
function sync(on:boolean,msg?:string){$('sync').textContent=msg||'';$('sync').classList.toggle('on',on)} // speak only when something needs the player


const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function chips(el:HTMLElement,type:string,name:string,items:Option<string>[],isOn:(v:string)=>boolean,onChange:(e:Event)=>void){
  el.innerHTML=items.map(([v,l],i)=>`<label class="chip"><input type="${type}" name="${name}" id="${name}-${i}" value="${v}" ${isOn(v)?'checked':''}><span>${l}</span></label>`).join('');
  el.onchange=onChange;
}
function renderSetup(){
  chips($('pace'),'radio','pace',[['learn','Learn'],['sprint','Sprint']],v=>v===cfg.pace,e=>{if(e.target instanceof HTMLInputElement&&(e.target.value==='learn'||e.target.value==='sprint')){cfg.pace=e.target.value;save()}});
  chips($('kbd'),'radio','kbd',[['app','Flag Sprint'],['system','System']],v=>v===cfg.kbd,e=>{if(e.target instanceof HTMLInputElement&&(e.target.value==='app'||e.target.value==='system')){cfg.kbd=e.target.value;save()}});
  chips($('hap'),'radio','hap',[['1','On'],['0','Off']],v=>(v==='1')===cfg.hap,e=>{if(e.target instanceof HTMLInputElement){cfg.hap=e.target.value==='1';save();buzz(true)}});
  renderPass();updCount();
}
const DESC:Partial<Record<string,Partial<Record<string|number,string>>>>={
  pool:{un:'The 194 UN member states.',all:'Adds territories and partly recognized states.',weak:'Up to 40 flags you miss or answer slowly.',marked:'Flags you starred with ☆.'},
  mode:{adaptive:'Multiple choice until you know a flag, then you type it.',type:'Type every answer. Abbreviations like USA and UK work.',mc:'Pick from four names. Keys 1–4 work too.'},
  pace:{learn:'A miss pauses the clock and shows the answer. The flag comes back soon.',sprint:'The clock never stops. Misses come up more often later.'},
  dur:{0:'Runs until you press End.'},
};
function save(){persist();updCount()}
function buildPool(){
  let p=FLAGS.filter(f=>cfg.regs.includes(f.reg));
  if(cfg.pool==='un'&&cfg.dest!=='Antarctica')p=p.filter(f=>f.k==='un'); // the charter's territories are all non-UN
  if(cfg.pool==='marked')p=p.filter(f=>marks.has(f.n));
  if(cfg.pool==='weak')p=p.filter(f=>hist[f.n]&&prio(hist[f.n])>=1).sort((a,b)=>prio(hist[b.n])-prio(hist[a.n])).slice(0,40);
  return oneCardPerFlag(p);
}
// ── boarding pass: four fields, every option visible; arrows move, Enter chooses (shared with the library pass) ──
const passCols=():PassCol<PassFields>[]=>[
  {k:'pool',label:'Set',opts:POOLS},
  {k:'dest',label:'Destination',opts:destinationOptions(store.get('charter',false))},
  {k:'mode',label:'Answer',opts:MODES,short:{mc:'4 choices'}},
  {k:'dur',label:'Time',opts:TIMES}
];
const redEye=()=>new Date().getHours()<5; // midnight to 5am the pass becomes a red-eye
function passHTML<T extends object>(cols:PassCol<T>[],val:(k:keyof T)=>string|number){
  return cols.map((c,ci)=>{const v=val(c.k),cur=c.opts.find(o=>o[0]===v)||c.opts[0];
    return `<div class="field" role="radiogroup" aria-label="${c.label}"><span class="flabel">${c.label}</span>${c.big===false?'':`<span class="fval" data-k="${c.k}" title="${cur[1]}">${(c.short||{})[v]||cur[1]}</span>`}`+
      c.opts.map((o,ri)=>{const on=o[0]===v,tip=(DESC[c.k]||{})[o[0]];return `<button type="button" class="popt${on?' on':''}${o[0]==='Antarctica'?' secret':''}" role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-ci="${ci}" data-ri="${ri}"${tip?` title="${tip}"`:''}><i></i>${o[1]}${o[2]!=null?`<small>${o[2]}</small>`:''}</button>`}).join('')+'</div>'}).join('');
}
function bindPass<T extends object>(el:HTMLElement,cols:()=>PassCol<T>[],onPick:(ci:number,ri:number)=>void){
  el.addEventListener('click',e=>{const b=e.target instanceof Element?e.target.closest<HTMLElement>('.popt'):null;if(b)onPick(Number(b.dataset.ci),Number(b.dataset.ri))});
  el.addEventListener('keydown',e=>{
    const b=e.target instanceof Element?e.target.closest<HTMLElement>('.popt'):null;if(!b)return;
    const ci=Number(b.dataset.ci),ri=Number(b.dataset.ri),n=cols().length;
    const moves:Partial<Record<string,[number,number]>>={ArrowDown:[ci,ri+1],ArrowUp:[ci,ri-1],ArrowRight:[ci+1,ri],ArrowLeft:[ci-1,ri],Home:[ci,0],End:[ci,99]},mv=moves[e.key];
    if(mv){e.preventDefault();if(mv[0]<0||mv[0]>=n)return;const os=el.querySelectorAll('.field')[mv[0]].querySelectorAll<HTMLElement>('.popt');os[Math.max(0,Math.min(mv[1],os.length-1))].focus();return}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(ci,ri)}
  });
}
// re-render keeps keyboard focus on the same option
function refocus(el:HTMLElement,ci:number,ri:number){const b=el.querySelector<HTMLElement>(`.popt[data-ci="${ci}"][data-ri="${ri}"]`);if(b)b.focus()}
let lastFlight='';
function renderPass(changed?:keyof PassFields){
  const night=redEye();
  $('passLabel').textContent=night?'BOARDING PASS · RED-EYE':'BOARDING PASS';
  $('gate').textContent=night?'RED-EYE':'GATE OPEN';
  $('passFields').innerHTML=passHTML(passCols(),k=>cfg[k]);
  if(changed){const v=$('passFields').querySelector(`.fval[data-k="${changed}"]`);if(v)v.classList.add('flap')}
  const code=flightCode(cfg,store.get('charter',false));
  if(code!==lastFlight){lastFlight=code;$('flight').setAttribute('aria-label','Flight '+code);
    $('flight').innerHTML=code.split('').map((c,i)=>`<span class="tile" style="animation-delay:${i*45}ms">${c===' '?'&nbsp;':c}</span>`).join('')}
  $('charterStamp').hidden=cfg.dest!=='Antarctica';
}
function pickPass(ci:number,ri:number){
  const c=passCols()[ci],v=c.opts[ri][0];
  if(cfg[c.k]!==v){
    switch(c.k){case 'pool':cfg.pool=c.opts[ri][0];break;case 'dest':cfg.dest=c.opts[ri][0];cfg.regs=destRegs(cfg.dest);break;case 'mode':cfg.mode=c.opts[ri][0];break;case 'dur':cfg.dur=c.opts[ri][0]}
    save();renderPass(c.k);
  }
  refocus($('passFields'),ci,ri);
}
bindPass($('passFields'),passCols,pickPass);
// typing "south" on the Play page opens the charter to Antarctica
let typed='';
document.addEventListener('keydown',e=>{
  if($('setup').hidden||(e.target instanceof Element&&/^(INPUT|TEXTAREA)$/.test(e.target.tagName))||e.metaKey||e.ctrlKey||!/^[a-z]$/i.test(e.key))return;
  typed=(typed+e.key.toLowerCase()).slice(-5);
  if(typed==='south'){typed='';store.set('charter',true);cfg.dest='Antarctica';cfg.regs=destRegs('Antarctica');save();renderPass('dest')}
});
function updCount(){
  const n=buildPool().length;
  $('count').textContent=n?`${n} flag${n===1?'':'s'}`:(cfg.pool==='weak'?'No weak flags here yet':cfg.pool==='marked'?'No marked flags here yet':'No flags here');
  $<HTMLButtonElement>('start').disabled=!n;
}

function fit(){
  const vv=window.visualViewport,h=vv?vv.height:innerHeight;
  document.documentElement.style.setProperty('--vvh',h+'px');
  document.documentElement.style.setProperty('--chrome',(G&&G.mc?330:230+($('kb').hidden?0:$('kb').offsetHeight))+'px');
  if(G&&!$('game').hidden&&innerWidth<=820)window.scrollTo(0,0);
}
interface RunState{
  pool:Flag[];recent:Flag[];due:{f:Flag;at:number}[];shown:number;rv:boolean;learn:boolean;cur:Flag|null;score:number;miss:Flag[];times:[Flag,number][];t0:number;end:number;began:number;seen:Set<Flag>;dur:Cfg['dur'];label:string;timer:ReturnType<typeof setInterval>|undefined;mode:Cfg['mode'];mc:boolean;lock:boolean;opts:Flag[];pausedAt:number;lastMiss:Flag[];
}
let G:RunState|null=null;
const shuffle=<T>(a:T[])=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
function start(pool:Flag[],label:string){
  G={pool,recent:[],due:[],shown:0,rv:false,learn:cfg.pace==='learn',cur:null,score:0,miss:[],times:[],t0:0,end:cfg.dur?performance.now()+cfg.dur*1000:Infinity,began:performance.now(),seen:new Set(),dur:cfg.dur,label,timer:undefined,mode:cfg.mode,mc:false,lock:false,opts:[],pausedAt:0,lastMiss:[]};
  $('bar').parentElement!.hidden=!G.dur;$('score').textContent='0';
  show('game');next();$('last').textContent='';
  $<HTMLInputElement>('answer').value='';if(!G.mc)$('answer').focus();
  tick();G.timer=setInterval(tick,100);
}
// weighted pick by priority; the last few flags shown sit out so nothing repeats back to back
function next(){
  if(!G)return;
  G.shown++;
  const shown=G.shown,cur=G.cur,d=G.due.findIndex(x=>x.at<=shown&&x.f!==cur);
  if(d>=0){G.cur=G.due.splice(d,1)[0].f;G.recent.push(G.cur);G.seen.add(G.cur);$<HTMLImageElement>('flag').src=G.cur.f;starBtn($('flagstar'),G.cur);G.t0=performance.now();applyMode();return}
  const cand=candidates(G.pool,G.recent),ws=cand.map(f=>prio(hist[f.n]));
  let r=Math.random()*ws.reduce((a,b)=>a+b,0),i=0;
  while(i<ws.length-1&&(r-=ws[i])>0)i++;
  G.cur=cand[i];G.recent.push(G.cur);G.seen.add(G.cur);$<HTMLImageElement>('flag').src=G.cur.f;starBtn($('flagstar'),G.cur);G.t0=performance.now();
  applyMode();
}
// show the current flag as multiple choice or typing, per run mode (or per flag in Adaptive)
function applyMode(){
  if(!G||!G.cur)return;
  const e=(hist[G.cur.n]||[])[4]||0;
  G.mc=G.mode==='mc'||(G.mode==='adaptive'&&e<MC_DONE);
  $('choices').hidden=!G.mc;$('answer').parentElement!.hidden=G.mc;
  showKb(!G.mc);
  if(G.mc)renderChoices();else $('answer').focus();
  fit();
}
// distractors: same subregion first, then same region, then anywhere; drawn from the chosen flag set so they look plausible
function renderChoices(){
  if(!G||!G.cur)return;
  const c=G.cur,base=FLAGS.filter(f=>!sameFlag(f.n,c.n)&&(cfg.pool!=='un'||f.k==='un')),opts=[c]; // never two right buttons
  for(const tier of [(f:Flag)=>f.s===c.s,(f:Flag)=>f.r===c.r,()=>true]){
    for(const f of shuffle(base.filter(tier)))if(opts.length<4&&!opts.includes(f))opts.push(f);
  }
  G.opts=shuffle(opts);
  $('choices').innerHTML=G.opts.map((_f,i)=>`<button type="button" data-i="${i}"><kbd>${i+1}</kbd><span></span></button>`).join('');
  const choices=G.opts;$('choices').querySelectorAll('span').forEach((s,i)=>s.textContent=choices[i].n);
}
function pick(i:number){
  if(!G||!G.cur||G.lock||G.rv||!G.opts[i])return;
  const f=G.opts[i],btns=$('choices').children;
  if(sameFlag(f.n,G.cur.n)){
    G.score++;const ms=performance.now()-G.t0;G.times.push([G.cur,ms]);rec(G.cur,false,ms);
    $('score').textContent=String(G.score);
    fx(true);advance();
  }else{
    G.miss.push(G.cur);rec(G.cur,true);noteConf(G.cur,f);fx(false);
    if(G.learn){review(f);return}
    G.lock=true;
    btns[i].classList.add('wrong');btns[G.opts.indexOf(G.cur)].classList.add('right');
    $('last').innerHTML='That was <span class="miss"></span>';$('last').querySelector('.miss')!.textContent=G.cur.n;
    setTimeout(()=>{if(G&&G.lock){G.lock=false;next()}},700);
  }
}
$('choices').addEventListener('click',e=>{const b=e.target instanceof Element?e.target.closest('button'):null;if(b)pick(Number(b.dataset.i))});
document.addEventListener('keydown',e=>{
  if(!G||!G.cur||$('game').hidden)return;
  if(G.mc&&G.rv&&(e.key==='Enter'||e.key===' ')){e.preventDefault();endReview();return}
  if(G.mc&&e.key>='1'&&e.key<='4'){e.preventDefault();pick(+e.key-1)}
  if(G.mc&&e.key==='Escape')finish();
  if(e.key==='/'){e.preventDefault();toggleMark(G.cur);starBtn($('flagstar'),G.cur)}
});
$('flagstar').onclick=()=>{if(G&&G.cur){toggleMark(G.cur);starBtn($('flagstar'),G.cur);if(!G.mc)$('answer').focus()}};
function toggleMark(f:Flag){marks.has(f.n)?marks.delete(f.n):marks.add(f.n);persist();if(!$('setup').hidden)updCount()}
function starBtn(b:HTMLElement,f:Flag){const on=marks.has(f.n);b.textContent=on?'★':'☆';b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',(on?'Unmark ':'Mark ')+f.n)}
// any .star with data-n toggles that flag, wherever it is rendered
document.addEventListener('click',e=>{const b=e.target instanceof Element?e.target.closest<HTMLElement>('.star[data-n]'):null;if(!b)return;const f=FLAGS.find(x=>x.n===b.dataset.n);if(!f)return;toggleMark(f);starBtn(b,f);if(!$('library').hidden&&(lib.show==='marked'||lib.view==='passport'))renderLib()});
// Learn pace: show the answer, pause the clock, require one correct entry, then bring the flag back ~3 flags later
function review(picked?:Flag){
  if(!G||!G.cur)return;
  G.rv=true;G.pausedAt=performance.now();
  const f=G.cur;
  const also=alsoFlown(f);
  $('rvWhere').textContent=(f.s||f.r)+(also.length?' · same flag as '+also.join(', '):'');$('rvName').textContent=f.n;
  if(picked&&picked!==f){$('rvCmp').hidden=false;$('rvCmp').innerHTML='<span>You picked <b></b></span><img alt="">';$('rvCmp').querySelector('b')!.textContent=picked.n;$('rvCmp').querySelector('img')!.src=picked.f}
  else $('rvCmp').hidden=true;
  $('review').hidden=false;$('choices').hidden=true;
  if(G.mc){$('rvDo').textContent='';$('rvGo').hidden=false;$('rvGo').focus()}
  else{$('rvGo').hidden=true;$('rvDo').textContent='Type the name to continue';$<HTMLInputElement>('answer').value='';$<HTMLInputElement>('answer').placeholder=f.n;$('answer').focus()}
  if(G.pool.length>1&&!G.due.some(x=>x.f===f))G.due.push({f,at:G.shown+3+(Math.random()*2|0)});
}
function endReview(){
  if(!G||!G.rv)return;
  const paused=performance.now()-G.pausedAt;
  if(G.dur)G.end+=paused;G.began+=paused;
  G.rv=false;$('review').hidden=true;$<HTMLInputElement>('answer').placeholder='';$<HTMLInputElement>('answer').value='';$('last').textContent='';
  next();
}
$('rvGo').onclick=endReview;
$('skip').onclick=()=>{if(!G)return;$<HTMLInputElement>('answer').value='';submit();$('answer').focus()};
// correct answer: Learn holds the flag with its name for a beat; Sprint moves on at once
function advance(){
  if(!G||!G.cur)return;
  if(!G.learn){$('last').textContent='';next();return}
  G.lock=true;$('last').innerHTML='<span class="gotit"></span>';$('last').firstChild!.textContent='✓ '+G.cur.n;
  setTimeout(()=>{if(!G)return;G.lock=false;next()},550);
}
function rec(f:Flag,miss:boolean,ms=0){
  const h=applyAnswer(hist[f.n],miss,ms,!!G&&G.mc);
  if((h[4]||0)>=KNOWN&&!kat[f.n])kat[f.n]=Date.now();
  hist[f.n]=h;
}
function noteConf(f:Flag,other:Flag|undefined){if(!other||other===f)return;const c=conf[f.n]||(conf[f.n]={});c[other.n]=(c[other.n]||0)+1}
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function tick(){
  if(!G)return;
  if(G.rv)return;
  if(!G.dur){$('tleft').innerHTML=`Time: <b>${clock((performance.now()-G.began)/1000)}</b> · Seen <b>${G.seen.size}/${G.pool.length}</b>`;return}
  const left=Math.max(0,(G.end-performance.now())/1000);
  $('tleft').innerHTML=`Seconds left: <b>${Math.ceil(left)}</b>`;
  $('tleft').classList.toggle('low',left<=10);
  $('bar').style.transform=`scaleX(${left/G.dur})`;
  if(left<=0)finish();
}
// typing never answers on its own: Enter submits, so a wrong guess can't be quietly corrected
$<HTMLInputElement>('answer').addEventListener('input',e=>{
  if(!G||!G.cur||!G.rv||!(e.target instanceof HTMLInputElement))return;
  if(accepts(G.cur,norm(e.target.value)))endReview(); // Learn's "type the name to continue" is copying, not answering
});
// Enter with the right name scores; a wrong name is a miss (and noted as a mix-up); empty is a skip
function submit(){
  if(!G||!G.cur||G.rv||G.lock||G.mc)return;
  const input=$<HTMLInputElement>('answer'),v=norm(input.value);
  if(v&&accepts(G.cur,v)){
    G.score++;const ms=performance.now()-G.t0;G.times.push([G.cur,ms]);rec(G.cur,false,ms);
    input.value='';$('score').textContent=String(G.score);
    fx(true);advance();return;
  }
  const cur=G.cur,other=v?FLAGS.find(f=>!sameFlag(f.n,cur.n)&&f.a.has(v)):undefined;
  G.miss.push(G.cur);rec(G.cur,true);noteConf(G.cur,other);fx(false);
  if(G.learn){review(other);return}
  const also=alsoFlown(G.cur);
  $('last').innerHTML=`${v?'That was':'Skipped:'} <span class="miss"></span>`;$('last').querySelector('.miss')!.textContent=G.cur.n+(also.length?` (same flag as ${also.join(', ')})`:'');
  input.value='';next();
}
$<HTMLInputElement>('answer').addEventListener('keydown',e=>{
  if(!G||kbOn())return; // the app keyboard has its own key handler
  if(e.key==='Enter'){e.preventDefault();submit()}
  if(e.key==='Escape')finish();
});
// ── Flag Sprint keyboard: big keys, no autocorrect, and the system keyboard never opens ──
const KB_ROWS=['qwertyuiop','asdfghjkl','zxcvbnm'];
const kbOn=()=>cfg.kbd==='app'&&matchMedia('(pointer:coarse)').matches;
$('kb').innerHTML=KB_ROWS.map((r,i)=>`<div class="kb-row">${[...r].map(c=>`<button type="button" data-k="${c}">${c}</button>`).join('')}${i===2?'<button type="button" class="kb-wide" data-k="Backspace" aria-label="Delete">⌫</button>':''}</div>`).join('')+
  '<div class="kb-row"><button type="button" class="kb-wide" data-k="Skip">Skip</button><button type="button" class="kb-space" data-k=" " aria-label="Space">space</button><button type="button" class="kb-enter" data-k="Enter">Enter</button></div>';
function kbKey(k:string){
  if(!G)return;
  const input=$<HTMLInputElement>('answer');
  if(k==='Enter')return submit();
  if(k==='Skip'){input.value='';return submit()}
  input.value=k==='Backspace'?input.value.slice(0,-1):input.value+k;
  input.dispatchEvent(new Event('input')); // Learn's copy step listens for input
}
// pointerdown answers at the touch, before the browser's tap delay and without stealing focus
$('kb').addEventListener('pointerdown',e=>{const b=e.target instanceof Element?e.target.closest<HTMLButtonElement>('button[data-k]'):null;if(!b)return;e.preventDefault();b.classList.add('down');setTimeout(()=>b.classList.remove('down'),120);kbKey(b.dataset.k!)});
// an iPad with a hardware keyboard still types while the app keyboard is showing
document.addEventListener('keydown',e=>{
  if(!G||$('game').hidden||$('kb').hidden||e.metaKey||e.ctrlKey)return;
  if(e.key==='Escape'){finish();return}
  if(/^[a-z ]$/i.test(e.key)||e.key==='Backspace'||e.key==='Enter'){e.preventDefault();kbKey(e.key.length===1?e.key.toLowerCase():e.key)}
});
function showKb(on:boolean){
  const use=on&&kbOn(),input=$<HTMLInputElement>('answer');
  $('kb').hidden=!use;input.readOnly=use;input.inputMode=use?'none':'text';
}
function finish(){
  if(!G)return;
  clearInterval(G.timer);G.lock=false;G.rv=false;$('review').hidden=true;$<HTMLInputElement>('answer').placeholder='';
  // the flag on screen at the buzzer is not a miss
  const key=`${G.mode}.${G.label}.${G.dur}`,best=S.best[key]||0,pb=G.score>best&&G.label!=='drill'&&G.dur>0;
  if(pb)S.best[key]=G.score;
  persist();
  $('rscore').textContent=String(G.score);
  const att=G.score+G.miss.length,avg=G.times.length?(G.times.reduce((s,t)=>s+t[1],0)/G.times.length/1000).toFixed(2):'–';
  $('rstats').innerHTML=`<div>Accuracy<b>${att?Math.round(G.score/att*100):0}%</b></div><div>Avg time<b>${avg}s</b></div>${G.dur&&G.label!=='drill'?`<div>Best<b class="${pb?'pb':''}">${Math.max(best,G.score)}${pb?' new':''}</b></div>`:`<div>Time<b>${clock((performance.now()-G.began)/1000)}</b></div>`}`;
  const item=(f:Flag,extra?:string)=>`<div class="item"><img src="${f.f}" alt=""><span>${f.n}${extra?`<br><small>${extra}</small>`:''}</span><button class="star" data-n="${f.n}" aria-pressed="${marks.has(f.n)}" aria-label="Mark ${f.n}">${marks.has(f.n)?'★':'☆'}</button></div>`;
  const uniqMiss=[...new Set(G.miss)];
  $('missWrap').hidden=!uniqMiss.length;
  $('misses').innerHTML=uniqMiss.map(f=>item(f)).join('');
  const slow=G.times.slice().sort((a,b)=>b[1]-a[1]).slice(0,6).filter(t=>t[1]>2500);
  $('slowWrap').hidden=!slow.length;
  $('slow').innerHTML=slow.map(([f,t])=>item(f,(t/1000).toFixed(1)+'s')).join('');
  G.lastMiss=[...uniqMiss,...slow.map(t=>t[0])];$('drill').hidden=!G.lastMiss.length;
  show('result');$('again').focus();
}
// right/wrong feedback: border pulse or shake on the flag, a drawn check or cross, and +1 by the score
// one short tap for right, a double buzz for wrong; silently does nothing where vibration is unsupported or blocked
function buzz(ok:boolean){
  if(!cfg.hap)return;
  try{if(navigator.vibrate){navigator.vibrate(ok?18:[35,45,35]);return}}catch{}
  // iOS has no vibrate(); tapping a native switch gives a system haptic tick in iOS 18+ Safari
  const l=$('haplbl'),a=document.activeElement;
  try{l.click();if(a instanceof HTMLElement&&a!==document.body)a.focus({preventScroll:true})}catch{}
}
function fx(ok:boolean){
  buzz(ok);
  const b=$('flagbox'),m=$('mark'),c=ok?'ok':'no';
  for(const el of [b,m]){el.classList.remove('ok','no');void el.offsetWidth;el.classList.add(c)}
  $('sr').textContent=ok?'Correct':'Wrong';
  if(ok){const p=document.createElement('span');p.className='pop';p.textContent='+1';p.style.right='-22px';p.style.top='0';$('scorebox').append(p);setTimeout(()=>p.remove(),550)}
}
function show(id:string){document.body.classList.toggle('playing',id==='game');setTimeout(fit,0);['setup','game','result','library','prefs'].forEach(s=>$(s).hidden=s!==id);const tab=id==='library'?'tabLib':id==='prefs'?'tabSet':'tabPlay';['tabPlay','tabLib','tabSet'].forEach(t=>$(t).setAttribute('aria-current',t===tab?'page':'false'))}
type Lib={reg:string;show:'all'|'marked'|'work'|'new';sort:'region'|'az';view:'tickets'|'passport'};
const lib:Lib=Object.assign({reg:'all',show:'all',sort:'region',view:'tickets'},store.get<Partial<Lib>>('lib',{}));
const REG_ORDER:readonly string[]=[...REGS,'Antarctic'];
const INK:Partial<Record<string,string>>={Africa:'#9a4b2f',Asia:'#8a2f45',Europe:'#2f4b8a','North America':'#2f6b5a','South America':'#6b4a8a',Oceania:'#2f6f86',Antarctic:'#4a6b7a'};
const libCols=():PassCol<Lib>[]=>[
  {k:'reg',label:'Region',big:false,opts:[['all','All regions',FLAGS.length],...['Africa','Asia','Europe','Americas','Oceania'].map((r):Option<string>=>[r,r,FLAGS.filter(f=>destRegs(r).includes(f.reg)).length])]},
  {k:'show',label:'Show',big:false,opts:[['all','All'],['marked','Marked'],['work','Needs work'],['new','Not seen']]},
  {k:'sort',label:'Sort',big:false,opts:[['region','By region'],['az','A–Z']]},
  {k:'view',label:'View',big:false,opts:[['tickets','Tickets'],['passport','Passport']]}
];
bindPass($('libFields'),libCols,(ci,ri)=>{const c=libCols()[ci];switch(c.k){case 'reg':lib.reg=c.opts[ri][0];break;case 'show':lib.show=c.opts[ri][0];break;case 'sort':lib.sort=c.opts[ri][0];break;case 'view':lib.view=c.opts[ri][0]}store.set('lib',lib);renderLib();refocus($('libFields'),ci,ri)});
const esc=(t:string)=>String(t).replace(/[&<>"]/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':'&quot;');
const stampDate=(t:number|undefined)=>{if(!t)return '';const d=new Date(t);return `${d.getDate()} ${'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[d.getMonth()]} ${d.getFullYear()}`};
const hash=(t:string)=>[...t].reduce((a,c)=>(a*31+c.charCodeAt(0))|0,7);
function ticket(f:Flag){
  const h=hist[f.n],st=isKnown(h)?['known','KNOWN']:needsWork(h)?['work','NEEDS WORK']:h?['learn','LEARNING']:['new','NOT SEEN'];
  const top=Object.entries(conf[f.n]||{}).sort((a,b)=>b[1]-a[1])[0];
  return `<div class="tkt"><button type="button" class="turn" aria-pressed="false" aria-label="Turn over ${esc(f.n)}"><span class="flipper">`+
    `<span class="face front"><span class="plate"><img src="${f.f}" alt="" loading="lazy" decoding="async"></span><span class="tear"></span><span class="tinfo"><b>${esc(f.n)}</b><small class="tstat s-${st[0]}">${st[1]}</small></span></span>`+
    `<span class="face back"><span class="tag">LUGGAGE TAG<i></i></span><b>${esc(f.n)}</b><span class="rows"><span>Seen</span><span>${h?h[0]:0}</span><span>Missed</span><span>${h?h[1]:0}</span><span>Avg time</span><span>${h&&h[2]?(h[2]/1000).toFixed(1)+' s':'—'}</span><span>Mixed up with</span><span>${top?esc(top[0]):'—'}</span>${alsoFlown(f).length?`<span>Same flag as</span><span>${esc(alsoFlown(f).join(', '))}</span>`:''}</span><span class="hint2">${esc(f.s||f.reg)} · TAP TO TURN BACK</span></span>`+
    `</span></button><button class="star" data-n="${esc(f.n)}" aria-pressed="${marks.has(f.n)}" aria-label="${marks.has(f.n)?'Unmark':'Mark'} ${esc(f.n)}">${marks.has(f.n)?'★':'☆'}</button></div>`;
}
function visa(f:Flag){
  if(!isKnown(hist[f.n]))return `<div class="visa"><span class="vempty">${esc(f.n)}<small>NO VISA YET</small></span></div>`;
  const hv=hash(f.n),rot=(Math.abs(hv)%17)-8;
  return `<div class="visa"><span class="vstamp ${hv&1?'round':'rect'}" style="color:${INK[f.reg]||'#2f4b8a'};transform:rotate(${rot}deg)"><small>Admitted</small><b>${esc(f.n)}</b><small>${stampDate(kat[f.n])}</small></span></div>`;
}
function renderLib(){
  const route=parseFlight($<HTMLInputElement>('q').value,store.get('charter',false)),q=route?'':norm($<HTMLInputElement>('q').value);
  const regs=route?destRegs(route.dest):lib.reg==='all'?null:destRegs(lib.reg);
  let L=FLAGS.filter(f=>(!regs||regs.includes(f.reg))&&(!q||[...f.a,...f.tags].some(a=>a.includes(q))));
  if(route){if(route.pool==='un')L=L.filter(f=>f.k==='un');if(route.pool==='weak')L=L.filter(f=>needsWork(hist[f.n]));if(route.pool==='marked')L=L.filter(f=>marks.has(f.n))}
  if(lib.show==='marked')L=L.filter(f=>marks.has(f.n));
  if(lib.show==='work')L=L.filter(f=>needsWork(hist[f.n]));
  if(lib.show==='new')L=L.filter(f=>!hist[f.n]);
  const passport=lib.view==='passport',stamped=FLAGS.filter(f=>isKnown(hist[f.n])).length;
  $('libFields').innerHTML=passHTML(libCols(),k=>lib[k]);
  $('route').hidden=!route;if(route)$('route').innerHTML=`<b>ROUTE ${route.code}</b><span>${esc(route.text)}</span>`;
  $('libLabel').textContent=passport?'PASSPORT · VISAS':'FLAG LIBRARY';
  $('libnote').textContent=passport?`${L.filter(f=>isKnown(hist[f.n])).length} OF ${L.length} STAMPED`:`${L.length} OF ${FLAGS.length} SHOWN`;
  $('stSeen').textContent=String(Object.keys(hist).length);$('stStamp').textContent=String(stamped);$('stMark').textContent=String(marks.size);
  const item=passport?visa:ticket,wrap=(h:string)=>passport?`<div class="ppage">${h}</div>`:`<div class="tgrid">${h}</div>`;
  if(lib.sort==='az'){L.sort((a,b)=>a.n.localeCompare(b.n));$('libgrid').innerHTML=L.length?wrap(L.map(item).join('')):'<p class="hint">Nothing here yet.</p>';return}
  L.sort((a,b)=>REG_ORDER.indexOf(a.reg)-REG_ORDER.indexOf(b.reg)||(a.s||'').localeCompare(b.s||'')||a.n.localeCompare(b.n));
  let out='';
  for(const r of REG_ORDER){const R=L.filter(f=>f.reg===r);if(!R.length)continue;
    out+=`<div class="lreg"><h2>${r}</h2><span>${R.length} FLAGS</span></div>`;
    if(passport){out+=wrap(R.map(item).join(''));continue}
    for(const sub of [...new Set(R.map(f=>f.s||r))]){out+=`<p class="lsub">${esc(sub.toUpperCase())}</p>`+wrap(R.filter(f=>(f.s||r)===sub).map(item).join(''))}
  }
  $('libgrid').innerHTML=out||'<p class="hint">Nothing here yet.</p>';
}
// tickets turn over to show their luggage tag
$('libgrid').addEventListener('click',e=>{const t=e.target instanceof Element?e.target.closest('.turn'):null;if(t)t.setAttribute('aria-pressed',String(t.getAttribute('aria-pressed')!=='true'))});
$('q').addEventListener('input',renderLib);
$('logo').onclick=e=>{e.preventDefault();$('tabPlay').click()};
const SUN='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
const MOON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
// no saved choice = follow the device; the button always flips whatever is showing now
function applyTheme(t:string|null){
  if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;
  const dark=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
  $('mode-t').innerHTML=dark?SUN:MOON;$('mode-t').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
}
applyTheme(store.get('theme',null)||(redEye()?'dark':null));
$('mode-t').onclick=()=>{const t=$('mode-t').getAttribute('aria-label')!.includes('dark')?'dark':'light';store.set('theme',t);applyTheme(t)};
$('tabLib').onclick=()=>{if(G&&!$('game').hidden)finish();renderLib();show('library')};
$('tabPlay').onclick=()=>{G=null;renderSetup();show('setup')};
$('tabSet').onclick=()=>{if(G&&!$('game').hidden)finish();G=null;renderSetup();show('prefs')};
let lastDrill:Flag[]|null=null;
const go=()=>start(buildPool(),cfg.pool+'.'+cfg.regs.join(','));
$('start').onclick=()=>{
  const b=$('start');if(b.classList.contains('torn'))return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches)return go();
  b.classList.add('torn');$('boardFlight').textContent=flightCode(cfg,store.get('charter',false));$('boarding').hidden=false;
  setTimeout(()=>{b.classList.remove('torn');$('boarding').hidden=true;go()},650);
};
$('again').onclick=()=>{if(G?.label==='drill'&&lastDrill)start(lastDrill,'drill');else go()};
$('endbtn').onclick=()=>{if(G)finish()};
$('drill').onclick=()=>{if(!G)return;lastDrill=[...new Set(G.lastMiss)];start(lastDrill,'drill')};
$('back').onclick=()=>{G=null;show('setup');renderSetup()};
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('result').hidden&&document.activeElement?.tagName!=='BUTTON'){e.preventDefault();$('again').click()}});
(window.visualViewport||window).addEventListener('resize',fit);addEventListener('orientationchange',fit);fit();
renderSetup();
// account storage: one Supabase row per player (RLS: own row only); falls back to this browser when signed out
const SB_URL='https://poemkxmxbmstigpcwyas.supabase.co',SB_KEY='sb_publishable_6VF4jt4SEN3k8wze05e7Dg_4i1XFRk7'; // project URL + publishable key; safe in the page because RLS guards the table
let sb:SupabaseClient|null=null;
let uid:string|null=null;
// Decide what to keep when this browser and the account both have progress.
async function connect(user:User|null){
  if(!sb)return;
  if((user&&user.id)===uid)return; // token refreshes re-fire auth events; only act when the player changes
  uid=user?user.id:null;cloud=null;
  $('acctIn').hidden=!!user;$('acctOut').hidden=!user;$('acctWho').textContent=user?user.email||'':'';
  if(!user){sync(false);return}
  const client=sb;cloud={set:st=>client.from('flag_sprint_state').upsert({user_id:uid,state:st,updated_at:new Date().toISOString()}).then(r=>{if(r.error)throw r.error})};
  if(!await pullMerge())sync(false,'Account load failed, kept in this browser');
}
// pull the account's save, merge it with this device's, and write the result to both
async function pullMerge():Promise<boolean>{
  if(!sb||!uid)return false;
  const {data,error}=await sb.from('flag_sprint_state').select('state').eq('user_id',uid).returns<{state:SaveState}[]>().maybeSingle();
  if(error)return false;
  S={hist,marks:[...marks],best:S.best,cfg,conf,kat,t:S.t||0}; // fold in-memory changes in WITHOUT a new timestamp, so "newer" still means last real change
  if(data&&data.state)S=JSON.parse(JSON.stringify(mergeSaves(S,data.state)));
  cfg=Object.assign({},DEF,S.cfg);cfg.regs=destRegs(cfg.dest);hist=S.hist||{};marks=new Set(S.marks||[]);S.best=S.best||{};conf=S.conf||{};kat=S.kat||{};
  if(!G){renderSetup();renderLib()}
  store.set('state',S);clearTimeout(saveTimer);
  try{await cloud?.set(S);return true}catch{return false}
}
$('syncNow').onclick=async()=>{
  const b=$<HTMLButtonElement>('syncNow');b.disabled=true;$('syncStat').textContent='Syncing…';
  const ok=await pullMerge();b.disabled=false;
  $('syncStat').textContent=ok?`Synced at ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Sync failed. Check your connection and try again.';
};
function wireAccount(){
  if(!sb)return;const client=sb;
  $('acct').hidden=false;
  $('acctForm').onsubmit=async e=>{
    e.preventDefault();
    const {error}=await client.auth.signInWithOtp({email:$<HTMLInputElement>('email').value,options:{emailRedirectTo:location.origin+location.pathname}});
    sync(false,error?'Could not send the link: '+error.message:'Check your email for the sign-in link');
  };
  // signing out also wipes this browser's copy, so the next person on a shared device sees nothing
  const forget=async()=>{
    cloud=null;clearTimeout(saveTimer);
    await client.auth.signOut({scope:'local'});
    ['state','hist','cfg'].forEach(k=>{try{localStorage.removeItem('fs.'+k)}catch{}});
    S={hist:{},marks:[],best:{},cfg:{},conf:{},kat:{},t:0};cfg=Object.assign({},DEF);cfg.regs=destRegs(cfg.dest);hist=S.hist;marks=new Set();conf={};kat={};
    if(!G){renderSetup();renderLib()}
  };
  $('signout').onclick=forget;
  $('delacct').onclick=async()=>{
    if(!confirm('Delete your account, email address and all saved progress? This cannot be undone.'))return;
    const {error}=await client.rpc('delete_my_account');
    if(error){sync(true,'Could not delete: '+error.message);return}
    await forget();setTimeout(()=>sync(false,'Account deleted')); // after the auth listener's own status update
  };
  // supabase-js holds a lock during this callback; defer queries out of it to avoid a deadlock
  client.auth.onAuthStateChange((_e,session)=>{setTimeout(()=>connect(session?session.user:null))});
}
// supabase-js loads after the page is up, so a slow load never holds up the game
async function loadAccount(){
  if(!SB_URL)return;
  try{const {createClient}=await import('@supabase/supabase-js');sb=createClient(SB_URL,SB_KEY);wireAccount()}catch{sync(false)}
}
if(document.readyState==='complete')void loadAccount();else addEventListener('load',loadAccount);
