import {parseDesign} from './model.mjs';

export function createChallenge({title,instructions='',maxCost=null,frontKn=40,rearKn=120,starter}) {
  if(typeof title!=='string'||!title.trim()||title.trim().length>80)throw Error('Give the challenge a title under 80 characters.');
  if(typeof instructions!=='string'||instructions.length>600)throw Error('Instructions must be under 600 characters.');
  if(maxCost!==null&&(!Number.isFinite(maxCost)||maxCost<=0||maxCost>1e9))throw Error('Budget must be a positive amount or left blank.');
  if(!Number.isFinite(frontKn)||!Number.isFinite(rearKn)||frontKn<=0||rearKn<=0||frontKn>500||rearKn>500)
    throw Error('Each axle load must be between 1 and 500 kN.');
  let bridge;
  try {bridge=parseDesign(JSON.stringify(starter));}
  catch {throw Error('The starter bridge is invalid.');}
  bridge.axleLoads=[{offset:0,force:frontKn*1000},{offset:4,force:rearKn*1000}];
  return {type:'bridge-lab-challenge',version:1,title:title.trim(),instructions:instructions.trim(),maxCost,
    frontKn,rearKn,starter:bridge};
}

export function parseChallenge(raw) {
  let data;
  try {data=JSON.parse(raw);}catch{throw Error('Invalid challenge JSON file.');}
  if(data?.type!=='bridge-lab-challenge'||data.version!==1)throw Error('Unsupported challenge file.');
  return createChallenge(data);
}

export function challengeOutcome(challenge,sweep,cost,completed) {
  if(!sweep)return {status:'not_tested',message:'Build a bridge and run the truck test.'};
  if(!completed)return {status:'testing',message:'Truck test in progress…'};
  if(sweep.firstFailure)return {status:'failed',message:'The bridge failed. Revise it and test again.'};
  if(challenge.maxCost!==null&&cost>challenge.maxCost)
    return {status:'over_budget',message:`The bridge held, but it is $${Math.round(cost-challenge.maxCost).toLocaleString()} over budget.`};
  return {status:'passed',message:challenge.maxCost===null?'Challenge complete! The bridge held.':'Challenge complete! The bridge held and met the budget.'};
}
