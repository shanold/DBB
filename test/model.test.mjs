import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter,addJoint,addMember,parseDesign} from '../src/model.mjs';
import {runSweep} from '../src/solver.mjs';

test('starter truss is connected and has a complete truck sweep',()=>{
  const design=createStarter();design.analysisModel='truss';
  const sweep=runSweep(design,31);
  assert.ok(sweep.frames.length>=31);
  assert.ok(sweep.frames.every(f=>f.analysis.ok));
  assert.equal(design.deckNodeIds.length,7);
});

test('adding a joint snaps to the metre grid without duplicates',()=>{
  const design=createStarter();
  const a=addJoint(design,7.4,6.7);
  const b=addJoint(a.design,7.2,7.1);
  assert.equal(a.node.x,7);
  assert.equal(a.node.y,7);
  assert.equal(b.design.nodes.length,a.design.nodes.length);
});

test('member linking refuses duplicates and zero length',()=>{
  const design=createStarter();
  assert.equal(addMember(design,0,1).members.length,design.members.length);
  assert.equal(addMember(design,0,0).members.length,design.members.length);
});

test('import rejects malformed file and accepts exported design',()=>{
  const design=createStarter();
  assert.deepEqual(parseDesign(JSON.stringify(design)),design);
  assert.throws(()=>parseDesign('{"nodes":[]}'),/invalid/i);
});

test('import refuses a zero-strength section',()=>{
  const design=createStarter();
  design.sections.standard.E=0;
  assert.throws(()=>parseDesign(JSON.stringify(design)),/invalid/i);
});

test('lightweight profile gives an identifiable moving-load failure',()=>{
  const design=createStarter();design.analysisModel='truss';
  design.members=design.members.map(m=>({...m,section:'light'}));
  const sweep=runSweep(design,71);
  assert.ok(sweep.firstFailure);
  const frame=sweep.frames[sweep.firstFailure.frame];
  assert.equal(frame.analysis.members.find(m=>m.id===sweep.firstFailure.member).failure,'buckling');
});
