import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter,addJoint,addMember,clearDesign,deleteSelected,selectInBox,moveNodes,parseDesign,findPassThroughs} from '../public/src/model.mjs';
import {analyzeBridge,runSweep} from '../public/src/solver.mjs';

function lineDesign() {
  const d=createStarter();
  return {...d,span:10,nodes:[{id:0,x:0,y:0},{id:1,x:5,y:0},{id:2,x:10,y:0}],
    deckNodeIds:[0,2],supports:[{node:0,x:true,y:true},{node:2,x:false,y:true}],members:[]};
}

test('linking A to C through B leaves B unconnected',()=>{
  const d=addMember(lineDesign(),0,2);
  assert.deepEqual(d.members.map(m=>[m.a,m.b]),[[0,2]]);
  assert.deepEqual(findPassThroughs(d).map(x=>[x.memberId,x.nodeId]),[[0,1]]);
});

test('placing B onto an existing A-C member keeps the pass-through mistake',()=>{
  const d=lineDesign();
  d.nodes=d.nodes.filter(n=>n.id!==1);
  const long=addMember(d,0,2);
  const split=addJoint(long,5,0).design;
  assert.deepEqual(split.members.map(m=>[m.a,m.b]),[[0,2]]);
  assert.deepEqual(findPassThroughs(split).map(x=>x.nodeId),[3]);
});

test('older imported bridges retain intentionally unconnected joints',()=>{
  const d=lineDesign();
  d.members=[{id:42,a:0,b:2,section:'standard'}];
  const loaded=parseDesign(JSON.stringify(d));
  assert.deepEqual(loaded.members.map(m=>[m.a,m.b]),[[0,2]]);
});

test('a load at the middle joint exposes the pass-through as unstable',()=>{
  const d=lineDesign();d.analysisModel='truss';
  d.nodes.push({id:3,x:5,y:5});
  d.members=[
    {id:0,a:0,b:2,section:'standard'},
    {id:1,a:0,b:3,section:'standard'},
    {id:2,a:2,b:3,section:'standard'},
    {id:3,a:1,b:3,section:'standard'}
  ];
  const connected=parseDesign(JSON.stringify(d));
  const result=analyzeBridge(connected,{1:{fy:-10000}});
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'pass_through');
  assert.equal(result.diagnosis.memberId,0);
  assert.equal(result.diagnosis.nodeId,1);
});

test('an empty design explains why the truck cannot be supported',()=>{
  const result=analyzeBridge(clearDesign(createStarter()));
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'empty');
  assert.match(result.diagnosis.advice,/members|triangles/i);
  const sweep=runSweep(clearDesign(createStarter()),10);
  assert.equal(sweep.firstFailure.frame,0);
  assert.equal(sweep.frames[0].analysis.diagnosis.kind,'empty');
});

test('a loaded loose joint is named when there is no pass-through',()=>{
  const d=lineDesign();
  d.nodes[1].y=2;
  d.members=[{id:0,a:0,b:2,section:'standard'}];
  const result=analyzeBridge(d,{1:{fy:-1000}});
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'isolated_joint');
  assert.equal(result.diagnosis.nodeId,1);
});

test('moving a free joint onto a member still needs a deliberate connection',()=>{
  const d=lineDesign();
  d.nodes[1].y=2;
  d.members=[{id:42,a:0,b:2,section:'standard'}];
  const moved=moveNodes(d,[1],0,-2);
  assert.deepEqual(moved.members.map(m=>[m.a,m.b]),[[0,2]]);
  assert.deepEqual(findPassThroughs(moved).map(x=>x.nodeId),[1]);
});

test('moving several selected joints preserves their spacing and fixed supports',()=>{
  const d=createStarter();
  const moved=moveNodes(d,[7,8,0],0,2);
  assert.equal(moved.nodes.find(n=>n.id===7).y,7);
  assert.equal(moved.nodes.find(n=>n.id===8).y,7);
  assert.equal(moved.nodes.find(n=>n.id===0).y,0);
});

test('clear keeps the challenge supports and deck joints',()=>{
  const d=clearDesign(createStarter());
  assert.equal(d.members.length,0);
  assert.deepEqual(d.nodes.map(n=>n.id),[0,1,2,3,4,5,6]);
  assert.equal(d.supports.length,2);
});

test('box selection contains joints and complete members, then bulk delete protects deck joints',()=>{
  const d=addMember(lineDesign(),0,1);
  const selection=selectInBox(d,{x1:-1,y1:-1,x2:5.1,y2:1});
  assert.deepEqual([...selection].sort(),['member:0','node:0','node:1']);
  const cleared=deleteSelected(d,selection);
  assert.equal(cleared.members.length,0);
  assert.deepEqual(cleared.nodes.map(n=>n.id),[0,2]);
});
