import {describe,expect,it} from 'vitest';
import type {Cfg,HistEntry,PassFields} from './types';
import {norm,flightCode,parseFlight,prio,applyAnswer,isKnown,needsWork,KNOWN,MC_CAP,POOLS,DESTS,MODES,DURS,destRegs} from './logic';

const cfg:Cfg={pace:'learn',hap:true,mode:'adaptive',dur:120,pool:'un',dest:'world',regs:destRegs('world')};
const combinations:PassFields[]=[];
for(const [pool] of POOLS)for(const [dest] of DESTS)for(const [mode] of MODES)for(const dur of DURS)combinations.push({pool,dest,mode,dur});

describe('norm',()=>{
  it.each([
    ['  THE République of Côte-d’Ivoire!  ','republiquecotedivoire'],
    ['Trinidad & Tobago','trinidadtobago'],
    ['Saint Vincent and the Grenadines','stvincentgrenadines'],
    ['SAINT-KITTS & NEVIS','stkittsnevis'],
    ['The United States of America','unitedstatesamerica'],
    ['Thailand / Andorra / Saintly 123','thailandandorrasaintly123'],
    ['',''],
  ])('%s → %s',(input,expected)=>expect(norm(input)).toBe(expected));
});
describe('flightCode',()=>{
  it('encodes the default and Europe typing flights',()=>{
    expect(flightCode(cfg)).toBe('FS 1013');
    expect(flightCode({...cfg,dest:'Europe',mode:'type'})).toBe('FS 1323');
  });
  it('encodes every charter as 0000',()=>{
    expect(flightCode({...cfg,dest:'Antarctica'})).toBe('FS 0000');
    expect(flightCode({...cfg,dest:'Antarctica',pool:'marked',mode:'mc',dur:0},true)).toBe('FS 0000');
  });
  it('gives all 360 non-charter combinations distinct codes',()=>{
    expect(combinations).toHaveLength(360);
    expect(new Set(combinations.map(c=>flightCode(c))).size).toBe(360);
    for(const c of combinations)expect(flightCode(c,true)).toBe(flightCode(c));
  });
});
describe('parseFlight',()=>{
  it.each(['fs 1323','FS1323','  Fs 1323  '])('decodes %s',q=>{
    expect(parseFlight(q)).toEqual({code:'FS 1323',pool:'un',dest:'Europe',mode:'type',dur:120,text:'UN members · Europe · Type · 2 min'});
  });
  it.each(['fs 9999','fs 132','hello','fs 10130','fs 1623','fs 0013','fs 1303','fs 1320'])('rejects %s',q=>{
    expect(parseFlight(q)).toBeNull();
    expect(parseFlight(q,true)).toBeNull();
  });
  it('decodes the charter while locked or unlocked',()=>{
    const charter={code:'FS 0000',dest:'Antarctica',pool:'all',text:'Charter · Antarctica'};
    expect(parseFlight('fs 0000')).toEqual(charter);
    expect(parseFlight('FS0000',true)).toEqual(charter);
  });
  it.each(combinations)('round-trips $pool / $dest / $mode / $dur',c=>{
    expect(parseFlight(flightCode(c))).toMatchObject(c);
    expect(parseFlight(flightCode(c,true),true)).toMatchObject(c);
  });
});
describe('prio',()=>{
  it('gives unseen flags priority 2',()=>expect(prio(undefined)).toBe(2));
  it('ranks a known flag below a missed slow flag',()=>{
    expect(prio([10,0,1200,0,3])).toBeCloseTo(.15+3*.5/11);
    expect(prio([10,5,4000,1,0])).toBeCloseTo(.15+3*5.5/11+2500/3000+1.5+1.2);
    expect(prio([10,0,1200,0,3])).toBeLessThan(prio([10,5,4000,1,0]));
  });
  it('keeps the known and needs-work conditions',()=>{
    expect(isKnown(undefined)).toBe(false);expect(needsWork(undefined)).toBe(false);
    expect(isKnown([10,0,1200,0,KNOWN])).toBe(true);
    expect(needsWork([10,5,4000,1,0])).toBe(true);
    expect(isKnown([10,5,4000,1,KNOWN])).toBe(false);
  });
});
describe('applyAnswer',()=>{
  it('initializes a typed correct answer',()=>expect(applyAnswer(undefined,false,1234.6,false)).toEqual([1,0,1235,0,1]));
  it('returns a new tuple and updates counters and the moving average',()=>{
    const h:HistEntry=[5,2,2000,1,0];
    expect(applyAnswer(h,false,1000,false)).toEqual([6,2,1600,0,1]);
    expect(h).toEqual([5,2,2000,1,0]);
    expect(applyAnswer(h,false,1000,false)).not.toBe(h);
  });
  it('adds .4 for multiple choice and caps its evidence',()=>{
    let h:HistEntry|undefined;
    for(let i=1;i<=6;i++){h=applyAnswer(h,false,1000,true);expect(h[4]).toBe(Math.min(MC_CAP,Math.round(i*.4*10)/10))}
    expect(h).toEqual([6,0,1000,0,MC_CAP]);
    expect(applyAnswer([10,0,1000,0,3],false,1000,true)[4]).toBe(3);
    expect(applyAnswer([10,0,1000,0,MC_CAP],false,1000,false)[4]).toBe(3);
  });
  it('resets evidence on a miss and preserves the average',()=>{
    expect(applyAnswer([5,2,2000,0,3],true,0,false)).toEqual([6,3,2000,1,0]);
    expect(applyAnswer(undefined,true,0,true)).toEqual([1,1,0,1,0]);
  });
  it('clamps answer times to 15000 before averaging and rounds',()=>{
    expect(applyAnswer(undefined,false,20000,false)).toEqual([1,0,15000,0,1]);
    expect(applyAnswer([3,0,1001,0,2],false,20000,false)).toEqual([4,0,6601,0,3]);
    expect(applyAnswer([1,0,0,0,1],false,999.5,false)[2]).toBe(1000);
  });
});
