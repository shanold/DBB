import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter,clearDesign,addMember} from '../public/src/model.mjs';
import {analyzeBridge} from '../public/src/solver.mjs';
import {instabilityStory} from '../public/src/instabilityVisual.mjs';

function fourBar(braced=false) {
  const base=createStarter();
  const pairs=[[0,1],[1,2],[2,3],[3,0],...(braced?[[0,2]]:[])];
  return {...base,analysisModel:'truss',span:5,nodes:[{id:0,x:0,y:0},{id:1,x:0,y:2},{id:2,x:4,y:2},{id:3,x:4,y:0}],
    members:pairs.map(([a,b],id)=>({id,a,b,section:'standard'})),
    supports:[{node:0,x:true,y:true},{node:3,x:false,y:true}],deckNodeIds:[0,3],deckDeadLoad:8000,axleLoads:[]};
}

test('an empty bridge points to the unsupported deck and tells how to add a load path',()=>{
  const design=clearDesign(createStarter());
  const story=instabilityStory(analyzeBridge(design).diagnosis);
  assert.match(story.title,/NO LOAD PATH/);
  assert.match(story.cause,/deck.*no structural members/i);
  assert.match(story.fix,/triangles/i);
  assert.deepEqual(story.nodeIds,design.deckNodeIds.slice(1,-1));
});

test('a member crossing a joint identifies the exact missing connection',()=>{
  const design=createStarter();
  const story=instabilityStory({kind:'pass_through',memberId:12,nodeId:3,affectedNodeIds:[3]});
  assert.match(story.title,/JOINT 4/);
  assert.match(story.cause,/member 13.*does not connect/i);
  assert.match(story.fix,/two members/i);
  assert.deepEqual(story.nodeIds,[3]);
  assert.equal(story.memberId,12);
  assert.ok(design.nodes.length>3);
});

test('a mechanism names free motion rather than guessing at a hinge',()=>{
  const story=instabilityStory({kind:'mechanism',nodeId:null,affectedNodeIds:[7]});
  assert.match(story.title,/MOVING JOINTS/);
  assert.match(story.cause,/move without stretching/i);
  assert.match(story.fix,/diagonal/i);
  assert.deepEqual(story.nodeIds,[7]);
});

test('a four-bar mechanism highlights its actual moving joints, not an elimination pivot',()=>{
  const design=fourBar();
  const result=analyzeBridge(design);
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'mechanism');
  assert.deepEqual(result.diagnosis.affectedNodeIds.sort((a,b)=>a-b),[1,2]);
  const motion=new Map(result.diagnosis.mode.map(d=>[d.node,d]));
  for(const member of design.members) {
    const a=design.nodes[member.a],b=design.nodes[member.b],va=motion.get(a.id),vb=motion.get(b.id);
    const stretch=(b.x-a.x)*(vb.x-va.x)+(b.y-a.y)*(vb.y-va.y);
    assert.ok(Math.abs(stretch)<1e-7,`member ${member.id} must not stretch in the free mode`);
  }
  assert.equal(analyzeBridge(fourBar(true)).ok,true);
});

test('a drawn road without bottom-chord members names the missing structural links',()=>{
  let design=createStarter();
  design={...design,analysisModel:'truss',members:design.members.filter(m=>m.id>=6)};
  for(let i=1;i<=5;i++)design=addMember(design,6+i,i+1);
  const result=analyzeBridge(design);
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'missing_deck_chord');
  assert.deepEqual(result.diagnosis.missingPairs,[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]);
  const story=instabilityStory(result.diagnosis);
  assert.match(story.title,/BOTTOM CHORD/);
  assert.match(story.cause,/road.*not.*member|road.*bottom.*missing/i);
  for(let i=0;i<6;i++)design=addMember(design,i,i+1);
  assert.equal(analyzeBridge(design).ok,true);
});

test('a disconnected group names the unsupported joints',()=>{
  const story=instabilityStory({kind:'disconnected',nodeId:5,affectedNodeIds:[5,6]});
  assert.match(story.cause,/no path to either support/i);
  assert.deepEqual(story.nodeIds,[5,6]);
});
