import {parseDesign} from './model.mjs';
import {FORCE_UNITS} from './loads.mjs';

export function parseBudget(value) {
  const input=String(value??'').trim();
  if(!input)return null;
  if(!/^\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input))
    throw Error('Enter an amount such as $12,000 or 12000, or leave blank.');
  const amount=Number(input.replace(/[$,\s]/g,''));
  if(!Number.isFinite(amount)||amount<=0||amount>1e9)
    throw Error('Budget must be greater than $0 and no more than $1,000,000,000.');
  return amount;
}

export function createChallenge({title,instructions='',maxCost=null,frontKn=40,rearKn=120,starter,span=starter?.span,loadType='moving',truckCount=1,truckSpacing=10,centerKn=160,forceUnit='kN',analysisModel=starter?.analysisModel||'frame',roadKnPerM=(starter?.deckLineLoad??((starter?.deckDeadLoad||0)*((starter?.deckNodeIds?.length||2)-1)/(starter?.span||30)))/1000}) {
  if(typeof title!=='string'||!title.trim()||title.trim().length>80)throw Error('Give the challenge a title under 80 characters.');
  if(typeof instructions!=='string'||instructions.length>600)throw Error('Instructions must be under 600 characters.');
  if(maxCost!==null&&(!Number.isFinite(maxCost)||maxCost<=0||maxCost>1e9))throw Error('Budget must be a positive amount or left blank.');
  if(!Number.isFinite(frontKn)||!Number.isFinite(rearKn)||frontKn<=0||rearKn<=0||frontKn>500||rearKn>500)
    throw Error('Each axle load must be greater than 0 and no more than 500 kN (or equivalent).');
  if(!Number.isFinite(span)||span<5||span>100)throw Error('Span must be between 5 and 100 metres.');
  if(!['moving','static','combined'].includes(loadType))throw Error('Choose a valid load type.');
  if(!Number.isInteger(truckCount)||truckCount<1||truckCount>5)throw Error('Choose between 1 and 5 trucks.');
  if(!Number.isFinite(truckSpacing)||truckSpacing<8||truckSpacing>100)throw Error('Truck spacing must be between 8 and 100 metres, front-to-front.');
  if(!Number.isFinite(centerKn)||centerKn<=0||centerKn>5000)throw Error('Center load must be greater than 0 and no more than 5,000 kN (or equivalent).');
  if(!FORCE_UNITS[forceUnit])throw Error('Choose a valid force unit.');
  if(!['frame','truss'].includes(analysisModel))throw Error('Choose a valid structural model.');
  if(!Number.isFinite(roadKnPerM)||roadKnPerM<0||roadKnPerM>10000)throw Error('Road weight must be between 0 and 10,000 kN/m.');
  let bridge;
  try {bridge=parseDesign(JSON.stringify(starter));}
  catch {throw Error('The starter bridge is invalid.');}
  bridge.analysisModel=analysisModel;bridge.deckLineLoad=roadKnPerM*1000;
  const ratio=span/bridge.span;
  bridge.nodes=bridge.nodes.map(n=>({...n,x:Math.min(span,n.x*ratio)}));bridge.span=span;
  bridge.axleLoads=loadType==='static'?[]:Array.from({length:truckCount},(_,i)=>[{offset:i*truckSpacing,force:frontKn*1000},{offset:i*truckSpacing+4,force:rearKn*1000}]).flat();
  bridge.staticLoads=loadType==='moving'?[]:[{x:span/2,force:centerKn*1000}];
  bridge.loadCase={type:loadType,truckCount,truckSpacing};bridge.forceUnit=forceUnit;
  return {type:'bridge-lab-challenge',version:1,title:title.trim(),instructions:instructions.trim(),maxCost,
    frontKn,rearKn,span,loadType,truckCount,truckSpacing,centerKn,forceUnit,analysisModel,roadKnPerM,starter:bridge};
}

export function parseChallenge(raw) {
  let data;
  try {data=JSON.parse(raw);}catch{throw Error('Invalid challenge JSON file.');}
  if(data?.type!=='bridge-lab-challenge'||data.version!==1)throw Error('Unsupported challenge file.');
  return createChallenge(data);
}

export function challengeOutcome(challenge,sweep,cost,completed) {
  if(!sweep)return {status:'not_tested',message:'Build a bridge and run the load test.'};
  if(!completed)return {status:'testing',message:'Load test in progress…'};
  if(sweep.firstFailure){const check=sweep.frames?.[sweep.firstFailure.frame]?.failureCheck;return {status:'failed',message:check?.status==='flexible'?'The bridge remained standing, but exceeded the deflection limit. Stiffen it and retest.':check?.status==='unresolved'?'The solver could not resolve this structure reliably. Revise it and retest.':['held','yielded'].includes(check?.status)?'Still standing, but a member exceeded capacity. Repair the damage to pass.':'The design exceeded capacity or has an unstable load path. Revise it and test again.'};}
  if(challenge.maxCost!==null&&cost>challenge.maxCost)
    return {status:'over_budget',message:`The bridge held, but it is $${Math.round(cost-challenge.maxCost).toLocaleString()} over budget.`};
  return {status:'passed',message:challenge.maxCost===null?'Challenge complete! The bridge held.':'Challenge complete! The bridge held and met the budget.'};
}
