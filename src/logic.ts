import type {Cfg,Dest,Duration,FlightRoute,HistEntry,Mode,Option,Pool,Region,SaveState} from './types';

export const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/\bsaint\b/g,'st').replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|of|and)\b/g,' ').replace(/\s+/g,'');
export const DURS:readonly Duration[]=[30,60,120,180,0]; // 0 = unlimited
export const POOLS:readonly Option<Pool>[]=[['un','UN members'],['all','Everything'],['weak','Weak'],['marked','Marked']];
export const REGS:readonly Region[]=['Africa','Asia','Europe','North America','South America','Oceania'];
// a destination stands for a set of regions; the charter flies to the Antarctic territories
export const DEST_REGS:Partial<Record<string,readonly string[]>>={world:REGS.slice(),Americas:['North America','South America'],Antarctica:['Antarctic']};
export const destRegs=(d:string):string[]=>DEST_REGS[d]?.slice()||[d];
export const DESTS:readonly Option<Dest>[]=[['world','The world'],['Africa','Africa'],['Asia','Asia'],['Europe','Europe'],['Americas','Americas'],['Oceania','Oceania']];
export const MODES:readonly Option<Mode>[]=[['adaptive','Adaptive'],['type','Type'],['mc','Multiple choice']];
export const TIMES:readonly Option<Duration>[]=DURS.map((d,i)=>[d,['30 s','1 min','2 min','3 min','Unlimited'][i]]);
export const destinationOptions=(charterUnlocked:boolean):readonly Option<Dest>[]=>charterUnlocked?[...DESTS,['Antarctica','Antarctica']]:DESTS;

// hist[name] = [seen, missed, avg ms on correct answers (moving average), last answer wrong 0/1, evidence since last miss]
// evidence: a typed correct answer counts 1, a multiple-choice correct counts 0.4 (a 1-in-4 guess is easy).
// A flag needs KNOWN=3 evidence in a row before it is treated as learned, so one lucky answer cannot bury it.
export const KNOWN=3;
// Adaptive mode: a flag is shown as multiple choice until it has MC_DONE evidence (3 correct picks), then as typing.
// Multiple-choice answers alone can lift evidence to MC_CAP at most, so "known" always takes typed recall.
export const MC_DONE=1.2,MC_CAP=2;
export function prio(h:HistEntry|undefined){
  if(!h)return 2;
  const miss=(h[1]+.5)/(h[0]+1),slow=h[2]?Math.min(1.5,Math.max(0,(h[2]-1500)/3000)):0;
  const unsure=1.2*Math.max(0,1-(h[4]||0)/KNOWN);
  return .15+3*miss+slow+(h[3]?1.5:0)+unsure;
}
export function applyAnswer(entry:HistEntry|undefined,miss:boolean,ms:number,mc:boolean):HistEntry{
  const h:HistEntry=entry?[...entry]:[0,0,0,0,0];h[0]++;
  if(miss){h[1]++;h[3]=1;h[4]=0}
  else{h[3]=0;const e=h[4]||0;h[4]=Math.round((mc?(e>=MC_CAP?e:Math.min(MC_CAP,e+.4)):e+1)*10)/10;h[2]=h[2]?Math.round(h[2]*.6+Math.min(ms,15000)*.4):Math.round(Math.min(ms,15000))}
  return h;
}
// the last few flags sit out so nothing repeats back to back; a one-flag pool keeps its only flag
export function candidates<T>(pool:readonly T[],recent:readonly T[],cooldown=5):T[]{
  const cool=Math.min(cooldown,pool.length-1),out=cool>0?recent.slice(-cool):[];
  const cand=pool.filter(f=>!out.includes(f));
  return cand.length?cand:pool.slice();
}
export const isKnown=(h:HistEntry|undefined)=>!!h&&(h[4]||0)>=KNOWN&&prio(h)<1;
export const needsWork=(h:HistEntry|undefined)=>!!h&&prio(h)>=1;
// one digit per field, so every combination of choices flies its own number; the charter is FS 0000
export function flightCode(cfg:Pick<Cfg,'pool'|'dest'|'mode'|'dur'>,charterUnlocked=false){
  if(cfg.dest==='Antarctica')return 'FS 0000';
  const at=<T extends string|number>(opts:readonly Option<T>[],v:T)=>Math.max(0,opts.findIndex(o=>o[0]===v));
  const p=at(POOLS,cfg.pool),d=at(destinationOptions(charterUnlocked),cfg.dest),m=at(MODES,cfg.mode),t=at(TIMES,cfg.dur);
  return `FS ${p+1}${d}${m+1}${t+1}`;
}
// a flight number typed into search decodes back into the run it stands for
export function parseFlight(q:string,charterUnlocked=false):FlightRoute|null{
  const m=q.trim().match(/^fs\s*(\d)(\d)(\d)(\d)$/i);if(!m)return null;
  if(m[0].replace(/\D/g,'')==='0000')return {code:'FS 0000',dest:'Antarctica',pool:'all',text:'Charter · Antarctica'};
  const p=POOLS[+m[1]-1],d=destinationOptions(charterUnlocked)[+m[2]],a=MODES[+m[3]-1],t=TIMES[+m[4]-1];
  if(!p||!d||!a||!t||d[0]==='Antarctica')return null;
  return {code:`FS ${m[1]}${m[2]}${m[3]}${m[4]}`,pool:p[0],dest:d[0],mode:a[0],dur:t[0],text:[p,d,a,t].map(x=>x[1]).join(' · ')};
}

// Combine two saves of the same player (e.g. Safari and the home-screen app) without losing either side.
// Idempotent: merging a save with itself, or syncing twice, changes nothing, so counts take the max, never the sum.
export function mergeSaves(a:SaveState,b:SaveState):SaveState{
  const [older,newer]=(a.t||0)<=(b.t||0)?[a,b]:[b,a];
  const keys=<T>(x:Record<string,T>|undefined,y:Record<string,T>|undefined)=>[...new Set([...Object.keys(x||{}),...Object.keys(y||{})])];
  const hist:Record<string,HistEntry>={};
  for(const k of keys(older.hist,newer.hist)){const o=older.hist?.[k],n=newer.hist?.[k];hist[k]=!o?n!:!n?o:o[0]>n[0]?o:n} // the side that played the flag more
  const best:Record<string,number>={};
  for(const k of keys(older.best,newer.best))best[k]=Math.max(older.best?.[k]??0,newer.best?.[k]??0);
  const conf:Record<string,Record<string,number>>={};
  for(const k of keys(older.conf,newer.conf)){const o=older.conf?.[k],n=newer.conf?.[k],c:Record<string,number>={};for(const j of keys(o,n))c[j]=Math.max(o?.[j]??0,n?.[j]??0);conf[k]=c}
  const kat:Record<string,number>={};
  for(const k of keys(older.kat,newer.kat)){const o=older.kat?.[k],n=newer.kat?.[k];kat[k]=o&&n?Math.min(o,n):(o||n)!} // first time it was known, on either device
  return {hist,marks:[...new Set([...(older.marks||[]),...(newer.marks||[])])].sort(),best,cfg:{...older.cfg,...newer.cfg},conf,kat,t:Math.max(older.t||0,newer.t||0)};
}
