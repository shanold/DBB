import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBridge,axleJointLoads,runSweep} from '../public/src/solver.mjs';
import {createStarter,parseDesign} from '../public/src/model.mjs';
import {createChallenge} from '../public/src/challenge.mjs';
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),`${a} vs ${b}`);
function beam(split=false){return {version:1,name:'Beam',analysisModel:'frame',span:10,
 nodes:split?[{id:0,x:0,y:0},{id:1,x:5,y:0},{id:2,x:10,y:0}]:[{id:0,x:0,y:0},{id:2,x:10,y:0}],
 members:split?[{id:0,a:0,b:1,section:'s'},{id:1,a:1,b:2,section:'s'}]:[{id:0,a:0,b:2,section:'s'}],
 sections:{s:{area:.01,inertia:.0001,depth:.2,E:200e9,yield:250e6,density:0,cost:1}},
 supports:[{node:0,x:true,y:true},{node:2,x:false,y:true}],deckNodeIds:split?[0,1,2]:[0,2],deckDeadLoad:0,deckLineLoad:0,axleLoads:[]};}

test('continuous lower beam supports a middle joint through bending',()=>{
 const d=beam(true),r=analyzeBridge(d,{1:{fy:-1000}});assert.equal(r.ok,true);assert.equal(r.passed,true);
 close(r.displacements.find(n=>n.node===1).y,-1000*1000/(48*200e9*.0001));
 close(r.reactions[0].fy,500);close(r.reactions[1].fy,500);close(r.members[0].maxMoment,2500);
});
test('a midspan truck load bends a single beam even without a center joint',()=>{
 const d=beam();d.axleLoads=[{offset:0,force:1000}];
 const r=analyzeBridge(d,axleJointLoads(d,5));assert.equal(r.ok,true);
 close(r.members[0].maxMoment,2500);close(r.members[0].curve.find(p=>p.t===.5).dy,-1000*1000/(48*200e9*.0001));
 close(r.reactions[0].fy,500);close(r.reactions[1].fy,500);
});
test('uniform road load matches exact beam moment and deflection and scales with span',()=>{
 const d=beam();d.deckLineLoad=1000;const r=analyzeBridge(d);assert.equal(r.ok,true);
 close(r.reactions[0].fy,5000);close(r.members[0].maxMoment,12500);
 close(r.members[0].curve.find(p=>p.t===.5).dy,-5*1000*10**4/(384*200e9*.0001));
 const longer=createChallenge({title:'Longer',starter:d,span:20}).starter;
 const r2=analyzeBridge(longer);close(r2.reactions.reduce((s,n)=>s+n.fy,0),20000);
});
test('member self-weight is distributed rather than only lumped at supports',()=>{
 const d=beam();d.sections.s.density=1000;const r=analyzeBridge(d);assert.equal(r.ok,true);
 close(r.members[0].maxMoment,1226.25);close(r.reactions[0].fy,490.5);
});
test('fixed cantilever gives exact tip deflection and support moment',()=>{
 const d=beam();d.supports=[{node:0,x:true,y:true,rotation:true}];
 const r=analyzeBridge(d,{2:{fy:-1000}});assert.equal(r.ok,true);
 close(r.displacements.find(n=>n.node===2).y,-1000*10**3/(3*200e9*.0001));
 close(r.reactions[0].moment,10000);close(r.members[0].maxMoment,10000);
});
test('explicit middle hinge removes beam continuity and exposes a mechanism',()=>{
 const d=beam(true);d.nodes[1].connection='hinge';const r=analyzeBridge(d,{1:{fy:-1000}});
 assert.equal(r.ok,false);assert.ok(r.collapseNodeIds.includes(1));
});
test('pinned ends still carry a transverse member load as a simply supported beam',()=>{
 const d=beam();d.nodes.forEach(n=>n.connection='hinge');d.axleLoads=[{offset:0,force:1000}];
 const r=analyzeBridge(d,axleJointLoads(d,5));assert.equal(r.ok,true);close(r.members[0].maxMoment,2500);
 close(r.members[0].curve.find(p=>p.t===.5).dy,-1000*1000/(48*200e9*.0001));
});
test('bending can cause yield with no axial tension',()=>{
 const d=beam(true);d.sections.s.yield=1e6;const r=analyzeBridge(d,{1:{fy:-1000}});
 assert.equal(r.ok,true);assert.equal(r.passed,false);assert.equal(r.members[0].failure,'yield');assert.equal(r.members[0].governing,'bending');
});
test('frame mode and individual hinges survive export and invalid connections are rejected',()=>{
 const d=beam(true);d.nodes[1].connection='hinge';assert.equal(parseDesign(JSON.stringify(d)).nodes[1].connection,'hinge');
 d.nodes[1].connection='rubber';assert.throws(()=>parseDesign(JSON.stringify(d)));
});
test('starter uses beam bending and a line load for the road',()=>{
 const d=createStarter();assert.equal(d.analysisModel,'frame');assert.equal(d.deckLineLoad,1600);
 const r=analyzeBridge(d);assert.equal(r.ok,true);assert.ok(r.members.some(m=>m.maxMoment>0));
});
test('long convoy gaps cannot skip beam bending failure between deck joints',()=>{
 const d=beam();d.span=5;d.nodes[1].x=5;d.sections.s={...createStarter().sections.standard,density:0};
 d.axleLoads=[{offset:0,force:100000},{offset:400,force:100000}];
 assert.ok(runSweep(d).firstFailure);
});
test('rotating a cantilever rotates its displacement and conserves moment',()=>{
 const d=beam();d.nodes[1]={id:2,x:0,y:10};d.deckNodeIds=[];
 d.supports=[{node:0,x:true,y:true,rotation:true}];
 const r=analyzeBridge(d,{2:{fx:1000}});assert.equal(r.ok,true);
 close(r.displacements.find(n=>n.node===2).x,1000*10**3/(3*200e9*.0001));
 close(r.reactions[0].fx,-1000);close(r.reactions[0].moment,10000);
});
test('reversing member endpoints preserves point load response and equilibrium',()=>{
 const d=beam();d.axleLoads=[{offset:0,force:1000}];
 const a=analyzeBridge(d,axleJointLoads(d,3));d.members[0]={...d.members[0],a:2,b:0};
 const b=analyzeBridge(d,axleJointLoads(d,3));assert.equal(b.ok,true);
 close(b.reactions[0].fy,700);close(b.reactions[1].fy,300);
 close(b.members[0].maxMoment,2100);close(a.members[0].curve[4].dy,b.members[0].curve[12].dy);
});
test('excessive elastic deflection is inconclusive, never a passing design',()=>{
 const d=beam(true);d.sections.s.E=1e6;d.sections.s.yield=1e12;
 const r=analyzeBridge(d,{1:{fy:-1000}});assert.equal(r.ok,true);
 assert.equal(r.largeDisplacement,true);assert.equal(r.passed,false);
});
test('section depth and rotation restraints reject invalid imported values',()=>{
 const d=beam();d.sections.s.depth=-1;assert.throws(()=>parseDesign(JSON.stringify(d)));
 d.sections.s.depth=.2;d.supports[0].rotation='yes';assert.throws(()=>parseDesign(JSON.stringify(d)));
});
test('splitting an unbraced compression column does not increase Euler capacity',()=>{
 const unsplit=beam(),split=beam(true);
 for(const d of [unsplit,split]){d.deckNodeIds=[];d.supports=[{node:0,x:true,y:true,rotation:true}];}
 const a=analyzeBridge(unsplit,{2:{fx:-1000}}),b=analyzeBridge(split,{2:{fx:-1000}});
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 close(a.members[0].eulerCapacity,Math.PI**2*200e9*.0001/20**2);
 for(const m of b.members){close(m.eulerCapacity,a.members[0].eulerCapacity);close(m.utilization,a.members[0].utilization);}
});
test('starter completes the truck crossing as a close but undamaged example',()=>{
 const sweep=runSweep(createStarter(),71);assert.equal(sweep.firstFailure,null);
 const peak=Math.max(...sweep.frames.map(f=>f.analysis.maxUtilization));assert.ok(peak>.8&&peak<1);
});

test('legacy saved bridges keep their original pin-truss behavior',()=>{const d=createStarter();delete d.analysisModel;assert.equal(parseDesign(JSON.stringify(d)).analysisModel,'truss');});
