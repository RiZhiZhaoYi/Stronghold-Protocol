import * as addon0 from '../arturia/index.js';
import * as addon1 from '../lavinia/index.js';
import * as addon2 from './zumama/index.js';
import { COMPUTATION_OWNER } from '../aiCompute/identity.js';
const views = new WeakMap();
export function policyMatch(m, ps) {
  if (!m.poolGroups || m.poolGroups.length < 2) return m;
  if (!views.has(ps)) views.set(ps,new Proxy(m,{
    get(target,key) {
      if (key === 'pool') return ps.pool;
      if (key === 'itemPool') return target.itemPoolFor(ps.playerId);
      if (key === COMPUTATION_OWNER) return target;
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },set:(target,key,value)=>Reflect.set(target,key,value,target),
  }));
  return views.get(ps);
}
const entries = new Map([["arturia", Object.freeze({...addon0, PRIORITY:0, PREPARE_LAST:false,
    pickCard:(m,ps,...args)=>addon0.pickCard(policyMatch(m,ps),ps,...args),
    prepBegin:(m,ps)=>addon0.prepBegin(policyMatch(m,ps),ps),
    prepEnd:(m,ps,job)=>addon0.prepEnd(policyMatch(m,ps),ps,job)})],["lavinia", Object.freeze({...addon1, PRIORITY:1, PREPARE_LAST:false,
    pickCard:(m,ps,...args)=>addon1.pickCard(policyMatch(m,ps),ps,...args),
    prepBegin:(m,ps)=>addon1.prepBegin(policyMatch(m,ps),ps),
    prepEnd:(m,ps,job)=>addon1.prepEnd(policyMatch(m,ps),ps,job)})],["zumama", Object.freeze({...addon2, PRIORITY:2, PREPARE_LAST:true,
    pickCard:(m,ps,...args)=>addon2.pickCard(policyMatch(m,ps),ps,...args),
    prepBegin:(m,ps)=>addon2.prepBegin(policyMatch(m,ps),ps),
    prepEnd:(m,ps,job)=>addon2.prepEnd(policyMatch(m,ps),ps,job)})]]);
export function aiAddon(m, ps) {
  if (!ps?.isBot) return null;
  const seat = m.opts?.seats?.find(s => s.playerId === ps.playerId && s.isBot);
  const addon = entries.get(seat?.botPersona);
  if (addon && !m[COMPUTATION_OWNER]) Object.defineProperty(m, COMPUTATION_OWNER, { value: m });
  return addon || null;
}
// Modern hosts may select adaptive/custom adapters. Named seats always own their hooks;
// every ordinary seat retains the selected adapter and its exact arguments/RNG behavior.
export function withAIAddons(base) {
  return Object.freeze({ ...base,
    pickBand:(m,ps,...args)=>aiAddon(m,ps)?.BAND ?? base.pickBand(m,ps,...args),
    pickCard:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.pickCard(m,ps,...args):base.pickCard(m,ps,...args);},
    prepBegin:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.prepBegin(m,ps,...args):base.prepBegin(m,ps,...args);},
    prepEnd:(m,ps,...args)=>{const a=aiAddon(m,ps);return a?a.prepEnd(m,ps,...args):base.prepEnd(m,ps,...args);},
    decide:(m,ps,...args)=>aiAddon(m,ps)?false:(base.decide?.(m,ps,...args) ?? false),
  });
}
