import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter,parseDesign} from '../public/src/model.mjs';
import {createChallenge,parseChallenge} from '../public/src/challenge.mjs';
import {axleJointLoads,runSweep} from '../public/src/solver.mjs';
import {toNewtons,fromNewtons} from '../public/src/loads.mjs';
const input=()=>({title:'Load lab',starter:createStarter()});
const total=loads=>-Object.values(loads).reduce((sum,l)=>sum+l.fy,0);
test('span changes stretch joint coordinates and preserve connections through save/import',()=>{
 const original=createStarter(),challenge=createChallenge({...input(),starter:original,span:60});
 assert.equal(challenge.starter.span,60);assert.equal(challenge.starter.nodes[3].x,30);
 assert.deepEqual(challenge.starter.members,original.members);assert.deepEqual(challenge.starter.supports,original.supports);
 assert.equal(original.span,30);assert.deepEqual(parseChallenge(JSON.stringify(challenge)).starter,challenge.starter);
});
test('convoy loads include every truck and spacing survives import',()=>{
 const c=createChallenge({...input(),span:100,truckCount:5,truckSpacing:12});
 assert.deepEqual(c.starter.axleLoads.map(a=>a.offset),[0,4,12,16,24,28,36,40,48,52]);
 assert.equal(total(axleJointLoads(c.starter,70)),800000);
 assert.equal(parseDesign(JSON.stringify(c.starter)).axleLoads.length,10);
 // This fixture tests convoy sampling across the whole span, so keep it below capacity.
 for(const section of Object.values(c.starter.sections)){section.yield=1e12;section.inertia=1;}
 const sweep=runSweep(c.starter,5);
 assert.equal(sweep.frames.at(-1).position,152);
 for(const axle of c.starter.axleLoads)assert.ok(sweep.frames.some(f=>f.position===50+axle.offset));
});
test('static center load is stationary and uses a single solved frame',()=>{
 const c=createChallenge({...input(),loadType:'static',centerKn:100});
 assert.equal(c.starter.axleLoads.length,0);assert.equal(axleJointLoads(c.starter,0)[3].fy,-100000);
 assert.deepEqual(axleJointLoads(c.starter,0),axleJointLoads(c.starter,30));
 const sweep=runSweep(c.starter);assert.equal(sweep.frames.length,1);assert.equal(sweep.frames[0].position,15);assert.equal(sweep.frames[0].analysis.ok,true);
 const overloaded=createChallenge({...input(),loadType:'static',centerKn:5000});
 assert.equal(runSweep(overloaded.starter).firstFailure.frame,0);
});
test('combined load sums the stationary force and moving axles',()=>{
 const c=createChallenge({...input(),span:60,loadType:'combined',truckCount:2,truckSpacing:10,centerKn:100});
 assert.equal(total(axleJointLoads(c.starter,35)),420000);
 assert.equal(total(axleJointLoads(c.starter,-1)),100000);
 assert.equal(parseChallenge(JSON.stringify(c)).loadType,'combined');
});
test('force units convert equivalent physical loads and invalid settings are rejected',()=>{
 assert.equal(toNewtons(1,'kN'),1000);assert.equal(toNewtons(1,'kgf'),9.80665);
 assert.equal(toNewtons(1,'kip'),toNewtons(1000,'lbf'));
 for(const unit of ['N','kN','lbf','kip','kgf'])assert.ok(Math.abs(toNewtons(fromNewtons(120000,unit),unit)-120000)<1e-8);
 for(const options of [{span:0},{truckCount:6},{truckSpacing:3},{centerKn:-1},{forceUnit:'kg'},{loadType:'bad'}])assert.throws(()=>createChallenge({...input(),...options}));
});
