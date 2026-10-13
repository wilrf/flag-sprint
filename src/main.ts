const FLAGS=JSON.parse(document.getElementById('data').textContent);
const EXTRA={'United States':['us','america'],'United Kingdom':['uk','britain','greatbritain'],'Netherlands':['holland'],'Myanmar':['burma'],'Eswatini':['swaziland'],'North Macedonia':['macedonia'],'Czechia':['czechrepublic'],'Turkey':['turkiye'],'Timor-Leste':['easttimor'],'Cape Verde':['caboverde'],'Vatican City':['vatican','holysee'],'Republic of the Congo':['congobrazzaville'],'South Korea':['korea'],'Russia':['russianfederation']};
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/\bsaint\b/g,'st').replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|of|and)\b/g,' ').replace(/\s+/g,'');
FLAGS.forEach(f=>{f.a=new Set([...f.a,...(EXTRA[f.n]||[])]);f.reg=f.r==='Americas'?(f.s==='South America'?'South America':'North America'):f.r;f.meta=[f.s,f.reg,f.k==='un'?'UN member':'Non-UN'].filter((v,i,a)=>v&&a.indexOf(v)===i);f.tags=[f.r,...f.meta].map(norm);});

const DURS=[30,60,120,180,0]; // 0 = unlimited
const POOLS=[['un','UN members'],['all','Everything'],['weak','Weak'],['marked','Marked']];
const REGS=['Africa','Asia','Europe','North America','South America','Oceania'];
const store={get(k,d){try{const v=localStorage.getItem('fs.'+k);return v?JSON.parse(v):d}catch{return d}},set(k,v){try{localStorage.setItem('fs.'+k,JSON.stringify(v))}catch{}}};
const DEF={pace:'learn',hap:true,mode:'adaptive',dur:120,pool:'un',dest:'world',regs:REGS.slice()};
// a destination stands for a set of regions; the charter flies to the Antarctic territories
const DEST_REGS={world:REGS.slice(),Americas:['North America','South America'],Antarctica:['Antarctic']};
const destRegs=d=>DEST_REGS[d]||[d];
// everything worth keeping lives in one object: history, marks, best scores, settings
let S=store.get('state',null)||{hist:store.get('hist',{}),marks:[],best:{},cfg:store.get('cfg',{}),t:0};
let cfg=Object.assign({},DEF,S.cfg),hist=S.hist,marks=new Set(S.marks);
cfg.regs=destRegs(cfg.dest);
// conf[name][otherName] = times a player answered otherName for this flag; kat[name] = when it first became known
let conf=S.conf||{},kat=S.kat||{};
let cloud=null,saveTimer=null;
function persist(){
  S={hist,marks:[...marks],best:S.best,cfg,conf,kat,t:Date.now()};
  store.set('state',S);
  clearTimeout(saveTimer);
  if(cloud)saveTimer=setTimeout(()=>cloud.set(S).then(()=>sync(true),()=>sync(false,'Account save failed, kept in this browser')),600);
}
function sync(on,msg){$('sync').textContent=msg||'';$('sync').classList.toggle('on',on)} // speak only when something needs the player


const $=id=>document.getElementById(id);
function chips(el,type,name,items,isOn,onChange){
  el.innerHTML=items.map(([v,l],i)=>`<label class="chip"><input type="${type}" name="${name}" id="${name}-${i}" value="${v}" ${isOn(v)?'checked':''}><span>${l}</span></label>`).join('');
  el.onchange=onChange;
}
function renderSetup(){
  chips($('pace'),'radio','pace',[['learn','Learn'],['sprint','Sprint']],v=>v===cfg.pace,e=>{cfg.pace=e.target.value;save()});
  chips($('hap'),'radio','hap',[['1','On'],['0','Off']],v=>(v==='1')===cfg.hap,e=>{cfg.hap=e.target.value==='1';save();buzz(true)});
  renderPass();updCount();
}
const DESC={
  pool:{un:'The 194 UN member states.',all:'Adds territories and partly recognized states.',weak:'Up to 40 flags you miss or answer slowly.',marked:'Flags you starred with ☆.'},
  mode:{adaptive:'Multiple choice until you know a flag, then you type it.',type:'Type every answer. Abbreviations like USA and UK work.',mc:'Pick from four names. Keys 1–4 work too.'},
  pace:{learn:'A miss pauses the clock and shows the answer. The flag comes back soon.',sprint:'The clock never stops. Misses come up more often later.'},
  dur:{0:'Runs until you press End.'},
};
function save(){persist();updCount()}
// hist[name] = [seen, missed, avg ms on correct answers (moving average), last answer wrong 0/1, evidence since last miss]
// evidence: a typed correct answer counts 1, a multiple-choice correct counts 0.4 (a 1-in-4 guess is easy).
// A flag needs KNOWN=3 evidence in a row before it is treated as learned, so one lucky answer cannot bury it.
const KNOWN=3;
// Adaptive mode: a flag is shown as multiple choice until it has MC_DONE evidence (3 correct picks), then as typing.
// Multiple-choice answers alone can lift evidence to MC_CAP at most, so "known" always takes typed recall.
const MC_DONE=1.2,MC_CAP=2;
function prio(f){
  const h=hist[f.n];if(!h)return 2;
  const miss=(h[1]+.5)/(h[0]+1),slow=h[2]?Math.min(1.5,Math.max(0,(h[2]-1500)/3000)):0;
  const unsure=1.2*Math.max(0,1-(h[4]||0)/KNOWN);
  return .15+3*miss+slow+(h[3]?1.5:0)+unsure;
}
function buildPool(){
  let p=FLAGS.filter(f=>cfg.regs.includes(f.reg));
  if(cfg.pool==='un'&&cfg.dest!=='Antarctica')p=p.filter(f=>f.k==='un'); // the charter's territories are all non-UN
  if(cfg.pool==='marked')p=p.filter(f=>marks.has(f.n));
  if(cfg.pool==='weak')p=p.filter(f=>hist[f.n]&&prio(f)>=1).sort((a,b)=>prio(b)-prio(a)).slice(0,40);
  return p;
}
// ── boarding pass: four fields, every option visible; arrows move, Enter chooses (shared with the library pass) ──
const passCols=()=>[
  {k:'pool',label:'Set',opts:POOLS},
  {k:'dest',label:'Destination',opts:[['world','The world'],['Africa','Africa'],['Asia','Asia'],['Europe','Europe'],['Americas','Americas'],['Oceania','Oceania']].concat(store.get('charter',false)?[['Antarctica','Antarctica']]:[])},
  {k:'mode',label:'Answer',opts:[['adaptive','Adaptive'],['type','Type'],['mc','Multiple choice']],short:{mc:'4 choices'}},
  {k:'dur',label:'Time',opts:[[30,'30 s'],[60,'1 min'],[120,'2 min'],[180,'3 min'],[0,'Unlimited']]}
];
// one digit per field, so every combination of choices flies its own number; the charter is FS 0000
function flightCode(){
  if(cfg.dest==='Antarctica')return 'FS 0000';
  const at=c=>Math.max(0,c.opts.findIndex(o=>o[0]===cfg[c.k])),[p,d,m,t]=passCols().map(at);
  return `FS ${p+1}${d}${m+1}${t+1}`;
}
const redEye=()=>new Date().getHours()<5; // midnight to 5am the pass becomes a red-eye
function passHTML(cols,val,prefix){
  return cols.map((c,ci)=>{const v=val(c.k),cur=c.opts.find(o=>o[0]===v)||c.opts[0];
    return `<div class="field" role="radiogroup" aria-label="${c.label}"><span class="flabel">${c.label}</span>${c.big===false?'':`<span class="fval" data-k="${c.k}" title="${cur[1]}">${(c.short||{})[v]||cur[1]}</span>`}`+
      c.opts.map((o,ri)=>{const on=o[0]===v,tip=(DESC[c.k]||{})[o[0]];return `<button type="button" class="popt${on?' on':''}${o[0]==='Antarctica'?' secret':''}" role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-ci="${ci}" data-ri="${ri}"${tip?` title="${tip}"`:''}><i></i>${o[1]}${o[2]!=null?`<small>${o[2]}</small>`:''}</button>`}).join('')+'</div>'}).join('');
}
function bindPass(el,cols,onPick){
  el.addEventListener('click',e=>{const b=e.target.closest('.popt');if(b)onPick(+b.dataset.ci,+b.dataset.ri)});
  el.addEventListener('keydown',e=>{
    const b=e.target.closest('.popt');if(!b)return;
    const ci=+b.dataset.ci,ri=+b.dataset.ri,n=cols().length;
    const mv={ArrowDown:[ci,ri+1],ArrowUp:[ci,ri-1],ArrowRight:[ci+1,ri],ArrowLeft:[ci-1,ri],Home:[ci,0],End:[ci,99]}[e.key];
    if(mv){e.preventDefault();if(mv[0]<0||mv[0]>=n)return;const os=el.querySelectorAll('.field')[mv[0]].querySelectorAll('.popt');os[Math.max(0,Math.min(mv[1],os.length-1))].focus();return}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(ci,ri)}
  });
}
// re-render keeps keyboard focus on the same option
function refocus(el,ci,ri){const b=el.querySelector(`.popt[data-ci="${ci}"][data-ri="${ri}"]`);if(b)b.focus()}
let lastFlight='';
function renderPass(changed){
  const night=redEye();
  $('passLabel').textContent=night?'BOARDING PASS · RED-EYE':'BOARDING PASS';
  $('gate').textContent=night?'RED-EYE':'GATE OPEN';
  $('passFields').innerHTML=passHTML(passCols(),k=>cfg[k],'pass');
  if(changed){const v=$('passFields').querySelector(`.fval[data-k="${changed}"]`);if(v)v.classList.add('flap')}
  const code=flightCode();
  if(code!==lastFlight){lastFlight=code;$('flight').setAttribute('aria-label','Flight '+code);
    $('flight').innerHTML=code.split('').map((c,i)=>`<span class="tile" style="animation-delay:${i*45}ms">${c===' '?'&nbsp;':c}</span>`).join('')}
  $('charterStamp').hidden=cfg.dest!=='Antarctica';
}
function pickPass(ci,ri){
  const c=passCols()[ci],v=c.opts[ri][0];
  if(cfg[c.k]!==v){cfg[c.k]=v;if(c.k==='dest')cfg.regs=destRegs(v);save();renderPass(c.k)}
  refocus($('passFields'),ci,ri);
}
bindPass($('passFields'),passCols,pickPass);
// typing "south" on the Play page opens the charter to Antarctica
let typed='';
document.addEventListener('keydown',e=>{
  if($('setup').hidden||/^(INPUT|TEXTAREA)$/.test(e.target.tagName)||e.metaKey||e.ctrlKey||!/^[a-z]$/i.test(e.key))return;
  typed=(typed+e.key.toLowerCase()).slice(-5);
  if(typed==='south'){typed='';store.set('charter',true);cfg.dest='Antarctica';cfg.regs=destRegs('Antarctica');save();renderPass('dest')}
});
function updCount(){
  const n=buildPool().length;
  $('count').textContent=n?`${n} flags`:(cfg.pool==='weak'?'No weak flags here yet':cfg.pool==='marked'?'No marked flags here yet':'No flags here');
  $('start').disabled=!n;
}

function fit(){
  const vv=window.visualViewport,h=vv?vv.height:innerHeight;
  document.documentElement.style.setProperty('--vvh',h+'px');
  document.documentElement.style.setProperty('--chrome',(G&&G.mc?330:230)+'px');
  if(G&&!$('game').hidden&&innerWidth<=820)window.scrollTo(0,0);
}
let G=null;
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
function start(pool,label){
  G={pool,recent:[],due:[],shown:0,rv:false,learn:cfg.pace==='learn',cur:null,score:0,miss:[],times:[],t0:0,end:cfg.dur?performance.now()+cfg.dur*1000:Infinity,began:performance.now(),seen:new Set(),dur:cfg.dur,label,timer:null};
  G.mode=cfg.mode;G.mc=false;G.lock=false;$('bar').parentElement.hidden=!G.dur;$('score').textContent=0;
  show('game');next();$('last').textContent='';
  $('answer').value='';if(!G.mc)$('answer').focus();
  tick();G.timer=setInterval(tick,100);
}
// weighted pick by priority; the last few flags shown sit out so nothing repeats back to back
function next(){
  G.shown++;
  const d=G.due.findIndex(x=>x.at<=G.shown&&x.f!==G.cur);
  if(d>=0){G.cur=G.due.splice(d,1)[0].f;G.recent.push(G.cur);G.seen.add(G.cur);$('flag').src=G.cur.f;starBtn($('flagstar'),G.cur);G.t0=performance.now();applyMode();return}
  const cool=Math.min(5,G.pool.length-1),recent=G.recent.slice(-cool);
  const cand=G.pool.filter(f=>!recent.includes(f)),ws=cand.map(prio);
  let r=Math.random()*ws.reduce((a,b)=>a+b,0),i=0;
  while(i<ws.length-1&&(r-=ws[i])>0)i++;
  G.cur=cand[i];G.recent.push(G.cur);G.seen.add(G.cur);$('flag').src=G.cur.f;starBtn($('flagstar'),G.cur);G.t0=performance.now();
  applyMode();
}
// show the current flag as multiple choice or typing, per run mode (or per flag in Adaptive)
function applyMode(){
  const e=(hist[G.cur.n]||[])[4]||0;
  G.mc=G.mode==='mc'||(G.mode==='adaptive'&&e<MC_DONE);
  $('choices').hidden=!G.mc;$('answer').parentElement.hidden=G.mc;
  if(G.mc)renderChoices();else $('answer').focus();
  fit();
}
// distractors: same subregion first, then same region, then anywhere; drawn from the chosen flag set so they look plausible
function renderChoices(){
  const c=G.cur,base=FLAGS.filter(f=>f!==c&&(cfg.pool!=='un'||f.k==='un')),opts=[c];
  for(const tier of [f=>f.s===c.s,f=>f.r===c.r,()=>true]){
    for(const f of shuffle(base.filter(tier)))if(opts.length<4&&!opts.includes(f))opts.push(f);
  }
  G.opts=shuffle(opts);
  $('choices').innerHTML=G.opts.map((f,i)=>`<button type="button" data-i="${i}"><kbd>${i+1}</kbd><span></span></button>`).join('');
  $('choices').querySelectorAll('span').forEach((s,i)=>s.textContent=G.opts[i].n);
}
function pick(i){
  if(!G||G.lock||G.rv||!G.opts[i])return;
  const f=G.opts[i],btns=$('choices').children;
  if(f===G.cur){
    G.score++;const ms=performance.now()-G.t0;G.times.push([G.cur,ms]);rec(G.cur,false,ms);
    $('score').textContent=G.score;
    fx(true);advance();
  }else{
    G.miss.push(G.cur);rec(G.cur,true);noteConf(G.cur,f);fx(false);
    if(G.learn){review(f);return}
    G.lock=true;
    btns[i].classList.add('wrong');btns[G.opts.indexOf(G.cur)].classList.add('right');
    $('last').innerHTML='That was <span class="miss"></span>';$('last').querySelector('.miss').textContent=G.cur.n;
    setTimeout(()=>{if(G&&G.lock){G.lock=false;next()}},700);
  }
}
$('choices').addEventListener('click',e=>{const b=e.target.closest('button');if(b)pick(+b.dataset.i)});
document.addEventListener('keydown',e=>{
  if(!G||$('game').hidden)return;
  if(G.mc&&G.rv&&(e.key==='Enter'||e.key===' ')){e.preventDefault();endReview();return}
  if(G.mc&&e.key>='1'&&e.key<='4'){e.preventDefault();pick(+e.key-1)}
  if(G.mc&&e.key==='Escape')finish();
  if(e.key==='/'){e.preventDefault();toggleMark(G.cur);starBtn($('flagstar'),G.cur)}
});
$('flagstar').onclick=()=>{if(G){toggleMark(G.cur);starBtn($('flagstar'),G.cur);if(!G.mc)$('answer').focus()}};
function toggleMark(f){marks.has(f.n)?marks.delete(f.n):marks.add(f.n);persist();if(!$('setup').hidden)updCount()}
function starBtn(b,f){const on=marks.has(f.n);b.textContent=on?'★':'☆';b.setAttribute('aria-pressed',on);b.setAttribute('aria-label',(on?'Unmark ':'Mark ')+f.n)}
// any .star with data-n toggles that flag, wherever it is rendered
document.addEventListener('click',e=>{const b=e.target.closest('.star[data-n]');if(!b)return;const f=FLAGS.find(x=>x.n===b.dataset.n);toggleMark(f);starBtn(b,f);if(!$('library').hidden&&(lib.show==='marked'||lib.view==='passport'))renderLib()});
// Learn pace: show the answer, pause the clock, require one correct entry, then bring the flag back ~3 flags later
function review(picked){
  G.rv=true;G.pausedAt=performance.now();
  const f=G.cur;
  $('rvWhere').textContent=f.s||f.r;$('rvName').textContent=f.n;
  if(picked&&picked!==f){$('rvCmp').hidden=false;$('rvCmp').innerHTML='<span>You picked <b></b></span><img alt="">';$('rvCmp').querySelector('b').textContent=picked.n;$('rvCmp').querySelector('img').src=picked.f}
  else $('rvCmp').hidden=true;
  $('review').hidden=false;$('choices').hidden=true;
  if(G.mc){$('rvDo').textContent='';$('rvGo').hidden=false;$('rvGo').focus()}
  else{$('rvGo').hidden=true;$('rvDo').textContent='Type the name to continue';$('answer').value='';$('answer').placeholder=f.n;$('answer').focus()}
  if(G.pool.length>1&&!G.due.some(x=>x.f===f))G.due.push({f,at:G.shown+3+(Math.random()*2|0)});
}
function endReview(){
  if(!G||!G.rv)return;
  const paused=performance.now()-G.pausedAt;
  if(G.dur)G.end+=paused;G.began+=paused;
  G.rv=false;$('review').hidden=true;$('answer').placeholder='';$('answer').value='';$('last').textContent='';
  next();
}
$('rvGo').onclick=endReview;
$('skip').onclick=()=>{if(!G)return;$('answer').focus();$('answer').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))};
// correct answer: Learn holds the flag with its name for a beat; Sprint moves on at once
function advance(){
  if(!G.learn){$('last').textContent='';next();return}
  G.lock=true;$('last').innerHTML='<span class="gotit"></span>';$('last').firstChild.textContent='✓ '+G.cur.n;
  setTimeout(()=>{if(!G)return;G.lock=false;next();const v=$('answer').value;if(v&&!G.mc)$('answer').dispatchEvent(new Event('input'))},550);
}
function rec(f,miss,ms){
  const h=hist[f.n]||[0,0,0,0,0];h[0]++;
  if(miss){h[1]++;h[3]=1;h[4]=0}
  else{h[3]=0;const e=h[4]||0;h[4]=Math.round((G&&G.mc?(e>=MC_CAP?e:Math.min(MC_CAP,e+.4)):e+1)*10)/10;h[2]=h[2]?Math.round(h[2]*.6+Math.min(ms,15000)*.4):Math.round(Math.min(ms,15000))}
  if((h[4]||0)>=KNOWN&&!kat[f.n])kat[f.n]=Date.now();
  hist[f.n]=h;
}
function noteConf(f,other){if(!other||other===f)return;const c=conf[f.n]||(conf[f.n]={});c[other.n]=(c[other.n]||0)+1}
const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
function tick(){
  if(G.rv)return;
  if(!G.dur){$('tleft').innerHTML=`Time: <b>${clock((performance.now()-G.began)/1000)}</b> · Seen <b>${G.seen.size}/${G.pool.length}</b>`;return}
  const left=Math.max(0,(G.end-performance.now())/1000);
  $('tleft').innerHTML=`Seconds left: <b>${Math.ceil(left)}</b>`;
  $('tleft').classList.toggle('low',left<=10);
  $('bar').style.transform=`scaleX(${left/G.dur})`;
  if(left<=0)finish();
}
$('answer').addEventListener('input',e=>{
  if(!G||G.lock)return;
  if(G.rv){if(G.cur.a.has(norm(e.target.value)))endReview();return}
  if(G.cur.a.has(norm(e.target.value))){
    G.score++;const ms=performance.now()-G.t0;G.times.push([G.cur,ms]);rec(G.cur,false,ms);
    e.target.value='';$('score').textContent=G.score;
    fx(true);advance();
  }
});
$('answer').addEventListener('keydown',e=>{
  if(!G)return;
  if(e.key==='Enter'&&(G.rv||G.lock)){e.preventDefault&&e.preventDefault();return}
  if(e.key==='Enter'&&G.learn){e.preventDefault();const v=norm(e.target.value),other=v&&FLAGS.find(f=>f!==G.cur&&f.a.has(v));
    G.miss.push(G.cur);rec(G.cur,true);noteConf(G.cur,other);fx(false);review(other);return}
  if(e.key==='Enter'){e.preventDefault();const v=norm(e.target.value);noteConf(G.cur,v&&FLAGS.find(f=>f!==G.cur&&f.a.has(v)));G.miss.push(G.cur);rec(G.cur,true);fx(false);
    $('last').innerHTML=`Skipped: <span class="miss"></span>`;$('last').querySelector('.miss').textContent=G.cur.n;
    e.target.value='';next();}
  if(e.key==='Escape')finish();
});
function finish(){
  clearInterval(G.timer);G.lock=false;G.rv=false;$('review').hidden=true;$('answer').placeholder='';
  // the flag on screen at the buzzer is not a miss
  const key=`${G.mode}.${G.label}.${G.dur}`,best=S.best[key]||0,pb=G.score>best&&G.label!=='drill'&&G.dur>0;
  if(pb)S.best[key]=G.score;
  persist();
  $('rscore').textContent=G.score;
  const att=G.score+G.miss.length,avg=G.times.length?(G.times.reduce((s,t)=>s+t[1],0)/G.times.length/1000).toFixed(2):'–';
  $('rstats').innerHTML=`<div>Accuracy<b>${att?Math.round(G.score/att*100):0}%</b></div><div>Avg time<b>${avg}s</b></div>${G.dur&&G.label!=='drill'?`<div>Best<b class="${pb?'pb':''}">${Math.max(best,G.score)}${pb?' new':''}</b></div>`:`<div>Time<b>${clock((performance.now()-G.began)/1000)}</b></div>`}`;
  const item=(f,extra)=>`<div class="item"><img src="${f.f}" alt=""><span>${f.n}${extra?`<br><small>${extra}</small>`:''}</span><button class="star" data-n="${f.n}" aria-pressed="${marks.has(f.n)}" aria-label="Mark ${f.n}">${marks.has(f.n)?'★':'☆'}</button></div>`;
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
function buzz(ok){
  if(!cfg.hap)return;
  try{if(navigator.vibrate){navigator.vibrate(ok?18:[35,45,35]);return}}catch{}
  // iOS has no vibrate(); tapping a native switch gives a system haptic tick in iOS 18+ Safari
  const l=$('haplbl'),a=document.activeElement;
  try{l.click();if(a&&a!==document.body)a.focus({preventScroll:true})}catch{}
}
function fx(ok){
  buzz(ok);
  const b=$('flagbox'),m=$('mark'),c=ok?'ok':'no';
  for(const el of [b,m]){el.classList.remove('ok','no');void el.offsetWidth;el.classList.add(c)}
  $('sr').textContent=ok?'Correct':'Wrong';
  if(ok){const p=document.createElement('span');p.className='pop';p.textContent='+1';p.style.right='-22px';p.style.top='0';$('scorebox').append(p);setTimeout(()=>p.remove(),550)}
}
function show(id){document.body.classList.toggle('playing',id==='game');setTimeout(fit,0);['setup','game','result','library','prefs'].forEach(s=>$(s).hidden=s!==id);const tab=id==='library'?'tabLib':id==='prefs'?'tabSet':'tabPlay';['tabPlay','tabLib','tabSet'].forEach(t=>$(t).setAttribute('aria-current',t===tab?'page':'false'))}
let lib=Object.assign({reg:'all',show:'all',sort:'region',view:'tickets'},store.get('lib',{}));
const REG_ORDER=[...REGS,'Antarctic'];
const INK={Africa:'#9a4b2f',Asia:'#8a2f45',Europe:'#2f4b8a','North America':'#2f6b5a','South America':'#6b4a8a',Oceania:'#2f6f86',Antarctic:'#4a6b7a'};
const libCols=()=>[
  {k:'reg',label:'Region',big:false,opts:[['all','All regions',FLAGS.length],...['Africa','Asia','Europe','Americas','Oceania'].map(r=>[r,r,FLAGS.filter(f=>destRegs(r).includes(f.reg)).length])]},
  {k:'show',label:'Show',big:false,opts:[['all','All'],['marked','Marked'],['work','Needs work'],['new','Not seen']]},
  {k:'sort',label:'Sort',big:false,opts:[['region','By region'],['az','A–Z']]},
  {k:'view',label:'View',big:false,opts:[['tickets','Tickets'],['passport','Passport']]}
];
bindPass($('libFields'),libCols,(ci,ri)=>{const c=libCols()[ci];lib[c.k]=c.opts[ri][0];store.set('lib',lib);renderLib();refocus($('libFields'),ci,ri)});
const isKnown=f=>{const h=hist[f.n];return h&&(h[4]||0)>=KNOWN&&prio(f)<1};
const needsWork=f=>hist[f.n]&&prio(f)>=1;
// a flight number typed into search decodes back into the run it stands for
function parseFlight(q){
  const m=q.trim().match(/^fs\s*(\d)(\d)(\d)(\d)$/i);if(!m)return null;
  if(m[0].replace(/\D/g,'')==='0000')return {code:'FS 0000',dest:'Antarctica',pool:'all',text:'Charter · Antarctica'};
  const cols=passCols(),o=[cols[0].opts[m[1]-1],cols[1].opts[+m[2]],cols[2].opts[m[3]-1],cols[3].opts[m[4]-1]];
  if(o.some(x=>!x)||o[1][0]==='Antarctica')return null;
  return {code:`FS ${m[1]}${m[2]}${m[3]}${m[4]}`,pool:o[0][0],dest:o[1][0],text:o.map(x=>x[1]).join(' · ')};
}
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const stampDate=t=>{if(!t)return '';const d=new Date(t);return `${d.getDate()} ${'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[d.getMonth()]} ${d.getFullYear()}`};
const hash=t=>[...t].reduce((a,c)=>(a*31+c.charCodeAt(0))|0,7);
function ticket(f){
  const h=hist[f.n],st=isKnown(f)?['known','KNOWN']:needsWork(f)?['work','NEEDS WORK']:h?['learn','LEARNING']:['new','NOT SEEN'];
  const top=Object.entries(conf[f.n]||{}).sort((a,b)=>b[1]-a[1])[0];
  return `<div class="tkt"><button type="button" class="turn" aria-pressed="false" aria-label="Turn over ${esc(f.n)}"><span class="flipper">`+
    `<span class="face front"><span class="plate"><img src="${f.f}" alt="" loading="lazy" decoding="async"></span><span class="tear"></span><span class="tinfo"><b>${esc(f.n)}</b><small class="tstat s-${st[0]}">${st[1]}</small></span></span>`+
    `<span class="face back"><span class="tag">LUGGAGE TAG<i></i></span><b>${esc(f.n)}</b><span class="rows"><span>Seen</span><span>${h?h[0]:0}</span><span>Missed</span><span>${h?h[1]:0}</span><span>Avg time</span><span>${h&&h[2]?(h[2]/1000).toFixed(1)+' s':'—'}</span><span>Mixed up with</span><span>${top?esc(top[0]):'—'}</span></span><span class="hint2">${esc(f.s||f.reg)} · TAP TO TURN BACK</span></span>`+
    `</span></button><button class="star" data-n="${esc(f.n)}" aria-pressed="${marks.has(f.n)}" aria-label="${marks.has(f.n)?'Unmark':'Mark'} ${esc(f.n)}">${marks.has(f.n)?'★':'☆'}</button></div>`;
}
function visa(f){
  if(!isKnown(f))return `<div class="visa"><span class="vempty">${esc(f.n)}<small>NO VISA YET</small></span></div>`;
  const hv=hash(f.n),rot=(Math.abs(hv)%17)-8;
  return `<div class="visa"><span class="vstamp ${hv&1?'round':'rect'}" style="color:${INK[f.reg]||'#2f4b8a'};transform:rotate(${rot}deg)"><small>Admitted</small><b>${esc(f.n)}</b><small>${stampDate(kat[f.n])}</small></span></div>`;
}
function renderLib(){
  const route=parseFlight($('q').value),q=route?'':norm($('q').value);
  const regs=route?destRegs(route.dest):lib.reg==='all'?null:destRegs(lib.reg);
  let L=FLAGS.filter(f=>(!regs||regs.includes(f.reg))&&(!q||[...f.a,...f.tags].some(a=>a.includes(q))));
  if(route){if(route.pool==='un')L=L.filter(f=>f.k==='un');if(route.pool==='weak')L=L.filter(needsWork);if(route.pool==='marked')L=L.filter(f=>marks.has(f.n))}
  if(lib.show==='marked')L=L.filter(f=>marks.has(f.n));
  if(lib.show==='work')L=L.filter(needsWork);
  if(lib.show==='new')L=L.filter(f=>!hist[f.n]);
  const passport=lib.view==='passport',stamped=FLAGS.filter(isKnown).length;
  $('libFields').innerHTML=passHTML(libCols(),k=>lib[k],'lib');
  $('route').hidden=!route;if(route)$('route').innerHTML=`<b>ROUTE ${route.code}</b><span>${esc(route.text)}</span>`;
  $('libLabel').textContent=passport?'PASSPORT · VISAS':'FLAG LIBRARY';
  $('libnote').textContent=passport?`${L.filter(isKnown).length} OF ${L.length} STAMPED`:`${L.length} OF ${FLAGS.length} SHOWN`;
  $('stSeen').textContent=Object.keys(hist).length;$('stStamp').textContent=stamped;$('stMark').textContent=marks.size;
  const item=passport?visa:ticket,wrap=h=>passport?`<div class="ppage">${h}</div>`:`<div class="tgrid">${h}</div>`;
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
$('libgrid').addEventListener('click',e=>{const t=e.target.closest('.turn');if(t)t.setAttribute('aria-pressed',t.getAttribute('aria-pressed')!=='true')});
$('q').addEventListener('input',renderLib);
$('logo').onclick=e=>{e.preventDefault();$('tabPlay').click()};
const SUN='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
const MOON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
// no saved choice = follow the device; the button always flips whatever is showing now
function applyTheme(t){
  if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;
  const dark=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
  $('mode-t').innerHTML=dark?SUN:MOON;$('mode-t').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
}
applyTheme(store.get('theme',null)||(redEye()?'dark':null));
$('mode-t').onclick=()=>{const t=$('mode-t').getAttribute('aria-label').includes('dark')?'dark':'light';store.set('theme',t);applyTheme(t)};
$('tabLib').onclick=()=>{if(G&&!$('game').hidden)finish();renderLib();show('library')};
$('tabPlay').onclick=()=>{G=null;renderSetup();show('setup')};
$('tabSet').onclick=()=>{if(G&&!$('game').hidden)finish();G=null;renderSetup();show('prefs')};
let lastDrill=null;
const go=()=>start(buildPool(),cfg.pool+'.'+cfg.regs.join(','));
$('start').onclick=()=>{
  const b=$('start');if(b.classList.contains('torn'))return;
  if(matchMedia('(prefers-reduced-motion:reduce)').matches)return go();
  b.classList.add('torn');$('boardFlight').textContent=flightCode();$('boarding').hidden=false;
  setTimeout(()=>{b.classList.remove('torn');$('boarding').hidden=true;go()},650);
};
$('again').onclick=()=>G.label==='drill'?start(lastDrill,'drill'):go();
$('endbtn').onclick=()=>G&&finish();
$('drill').onclick=()=>{lastDrill=[...new Set(G.lastMiss)];start(lastDrill,'drill')};
$('back').onclick=()=>{G=null;show('setup');renderSetup()};
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('result').hidden&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();$('again').click()}});
(window.visualViewport||window).addEventListener('resize',fit);addEventListener('orientationchange',fit);fit();
renderSetup();
// account storage: one Supabase row per player (RLS: own row only); falls back to this browser when signed out
const SB_URL='https://poemkxmxbmstigpcwyas.supabase.co',SB_KEY='sb_publishable_6VF4jt4SEN3k8wze05e7Dg_4i1XFRk7'; // project URL + publishable key; safe in the page because RLS guards the table
let sb=null;
let uid=null;
// Decide what to keep when this browser and the account both have progress.
function mergeStates(local,remote){
  // TODO(Wil): newest-wins drops the older side entirely. See the chat for the tradeoffs.
  return (remote.t||0)>=(local.t||0)?remote:local;
}
async function connect(user){
  if((user&&user.id)===uid)return; // token refreshes re-fire auth events; only act when the player changes
  uid=user?user.id:null;cloud=null;
  $('acctIn').hidden=!!user;$('acctOut').hidden=!user;$('acctWho').textContent=user?user.email:'';
  if(!user){sync(false);return}
  const {data,error}=await sb.from('flag_sprint_state').select('state').eq('user_id',uid).maybeSingle();
  if(error){sync(false,'Account load failed, kept in this browser');return}
  cloud={set:st=>sb.from('flag_sprint_state').upsert({user_id:uid,state:st,updated_at:new Date().toISOString()}).then(r=>{if(r.error)throw r.error})};
  const remote=data&&data.state;
  if(remote)S=JSON.parse(JSON.stringify(mergeStates(S,remote)));
  cfg=Object.assign({},DEF,S.cfg);cfg.regs=destRegs(cfg.dest);hist=S.hist||{};marks=new Set(S.marks||[]);S.best=S.best||{};conf=S.conf||{};kat=S.kat||{};
  if(!G){renderSetup();renderLib()}
  persist(); // writes the merged state to this browser and the account
}
function wireAccount(){
  $('acct').hidden=false;
  $('acctForm').onsubmit=async e=>{
    e.preventDefault();
    const {error}=await sb.auth.signInWithOtp({email:$('email').value,options:{emailRedirectTo:location.origin+location.pathname}});
    sync(false,error?'Could not send the link: '+error.message:'Check your email for the sign-in link');
  };
  // signing out also wipes this browser's copy, so the next person on a shared device sees nothing
  const forget=async()=>{
    cloud=null;clearTimeout(saveTimer);
    await sb.auth.signOut({scope:'local'});
    ['state','hist','cfg'].forEach(k=>{try{localStorage.removeItem('fs.'+k)}catch{}});
    S={hist:{},marks:[],best:{},cfg:{},conf:{},kat:{},t:0};cfg=Object.assign({},DEF);cfg.regs=destRegs(cfg.dest);hist=S.hist;marks=new Set();conf={};kat={};
    if(!G){renderSetup();renderLib()}
  };
  $('signout').onclick=forget;
  $('delacct').onclick=async()=>{
    if(!confirm('Delete your account, email address and all saved progress? This cannot be undone.'))return;
    const {error}=await sb.rpc('delete_my_account');
    if(error){sync(true,'Could not delete: '+error.message);return}
    await forget();setTimeout(()=>sync(false,'Account deleted')); // after the auth listener's own status update
  };
  // supabase-js holds a lock during this callback; defer queries out of it to avoid a deadlock
  sb.auth.onAuthStateChange((_e,session)=>setTimeout(()=>connect(session?session.user:null)));
}
// supabase-js loads after the page is up, so a slow CDN never holds up the game
addEventListener('load',()=>{
  if(!SB_URL)return;
  const t=document.createElement('script');
  t.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';t.integrity='sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug';t.crossOrigin='anonymous';
  t.onload=()=>{sb=supabase.createClient(SB_URL,SB_KEY);wireAccount()};
  t.onerror=()=>sync(false);
  document.head.appendChild(t);
});
