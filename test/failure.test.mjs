import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter,parseDesign} from '../public/src/model.mjs';
import {analyzeBridge,runSweep} from '../public/src/solver.mjs';
import {failureGeometry,visualNodePositions} from '../public/src/visualPhysics.mjs';

// Two parallel bottom ties share 500 N tension before the weak tie yields.
// After its capacity is removed, the other tie must carry all 500 N.
function redundantTriangle(otherCapacity=10000) {
 const section={area:.01,E:200e9,inertia:.0001,yield:1e6,density:0,cost:3};
 return {version:1,name:'Parallel ties',span:5,nodes:[{id:0,x:0,y:0},{id:1,x:2,y:0},{id:2,x:1,y:1}],
 members:[{id:0,a:0,b:1,section:'weak'},{id:1,a:0,b:1,section:'other'},{id:2,a:0,b:2,section:'bar'},{id:3,a:1,b:2,section:'bar'}],
 sections:{bar:section,weak:{...section,yield:10000},other:{...section,yield:otherCapacity/.01}},
 supports:[{node:0,x:true,y:true},{node:1,x:false,y:true}],deckNodeIds:[0,2,1],deckDeadLoad:0,
 axleLoads:[],staticLoads:[{x:1,force:1000}]};
}
test('unused joint leaves the load-bearing bridge and its forces intact',()=>{
 const d=createStarter(),before=analyzeBridge(d);d.nodes.push({id:99,x:2,y:9});
 const after=analyzeBridge(d);assert.equal(after.ok,true);
 assert.deepEqual(after.ignoredNodeIds,[99]);
 for(let i=0;i<before.members.length;i++)assert.ok(Math.abs(before.members[i].force-after.members[i].force)<1e-6);
 assert.equal(analyzeBridge(d,{99:{fy:-1000}}).ok,false);
});
test('an unrelated pass-through is not blamed for a loaded isolated joint',()=>{
 const d=createStarter();d.members.push({id:99,a:0,b:2,section:'heavy'});d.nodes.push({id:99,x:2,y:9});
 const r=analyzeBridge(d,{99:{fy:-1000}});assert.equal(r.ok,false);
 assert.equal(r.diagnosis.kind,'isolated_joint');assert.equal(r.diagnosis.nodeId,99);
});
test('first tension yield stays continuous and does not create an invented cascade',()=>{
 const sweep=runSweep(redundantTriangle(400)),check=sweep.frames[0].failureCheck;
 assert.ok(check);assert.equal(check.status,'yielded');assert.deepEqual(check.collapseNodeIds,[]);
 assert.deepEqual(check.stages.map(s=>s.members.map(m=>m.id)),[[0]]);
 assert.equal(check.residualAnalysis,sweep.frames[0].analysis);
 assert.ok(sweep.firstFailure,'permanent deformation still fails the no-damage challenge');
});
test('yielding retains the member and its self-weight',()=>{
 const d=redundantTriangle();d.sections.weak.density=1000;
 const frame=runSweep(d).frames[0],check=frame.failureCheck;assert.equal(check.status,'yielded');
 const total=check.residualAnalysis.reactions.reduce((sum,r)=>sum+r.fy,0);
 assert.ok(Math.abs(total-1196.2)<1e-6);assert.equal(check.residualAnalysis,frame.analysis);
});
test('yielded tension stays continuous instead of drawing a fracture',()=>{
 const shape=failureGeometry({x:0,y:0},{x:10,y:0},1000,1,'yield');
 assert.equal(shape.kind,'yield');assert.deepEqual(shape.a,{x:0,y:0});assert.deepEqual(shape.b,{x:10,y:0});
 assert.equal(shape.segments,undefined);
});
test('collapse illustration leaves unaffected joints standing',()=>{
 const positions=visualNodePositions([{id:0,x:0,y:0},{id:1,x:5,y:4},{id:2,x:10,y:4}],[],1,
 {span:10,supportIds:[0],breakX:5,collapse:1,collapseNodeIds:[1]});
 assert.ok(positions.get(1).y<0);assert.deepEqual(positions.get(2),{x:10,y:4});
});
test('invalid load values are rejected instead of silently treated as zero',()=>{
 assert.equal(analyzeBridge(createStarter(),{3:{fy:NaN}}).ok,false);
 const d=createStarter();d.deckNodeIds.unshift(0);assert.throws(()=>parseDesign(JSON.stringify(d)));
});
function flexibleCantilever(yieldStress){return {version:1,name:'Flexible beam',analysisModel:'frame',span:10,
 nodes:[{id:0,x:0,y:0},{id:1,x:10,y:0}],members:[{id:0,a:0,b:1,section:'s'}],
 sections:{s:{area:.01,inertia:.0001,depth:.2,E:1e6,yield:yieldStress,density:0,cost:1}},
 supports:[{node:0,x:true,y:true,rotation:true},{node:1,x:false,y:false}],deckNodeIds:[0,1],deckDeadLoad:0,deckLineLoad:0,
 axleLoads:[],staticLoads:[{x:10,force:1000}]};}
test('yield takes priority over the generic large-deflection limit',()=>{
 const frame=runSweep(flexibleCantilever(1e6)).frames[0];assert.equal(frame.analysis.largeDisplacement,true);
 assert.equal(frame.analysis.members[0].failure,'yield');assert.equal(frame.failureCheck.status,'yielded');
 assert.deepEqual(frame.failureCheck.collapseNodeIds,[]);
});
test('an intact but overly flexible bridge is a standing serviceability failure',()=>{
 const frame=runSweep(flexibleCantilever(1e12)).frames[0];assert.equal(frame.analysis.largeDisplacement,true);
 assert.equal(frame.analysis.members.some(m=>m.failure),false);
 assert.equal(frame.failureCheck.status,'flexible');assert.deepEqual(frame.failureCheck.collapseNodeIds,[]);
});
