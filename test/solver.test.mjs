import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBridge, runSweep } from '../src/solver.mjs';

const triangle = {
  span: 2,
  nodes: [{id:0,x:0,y:0},{id:1,x:2,y:0},{id:2,x:1,y:1}],
  members: [{id:0,a:0,b:1,section:'bar'},{id:1,a:0,b:2,section:'bar'},{id:2,a:1,b:2,section:'bar'}],
  supports: [{node:0,x:true,y:true},{node:1,x:false,y:true}],
  sections: {bar:{area:0.01,inertia:0.0001,E:200e9,yield:250e6,density:0,cost:3}},
  deckNodeIds: [0,1], deckDeadLoad:0, axleLoads:[]
};

test('triangle gives known axial forces and reactions under a centered load', () => {
  const result = analyzeBridge(triangle, {2:{fy:-1000}});
  assert.equal(result.ok, true);
  const forces = Object.fromEntries(result.members.map(m => [m.id,m.force]));
  assert.ok(Math.abs(forces[0]-500)<0.001);
  assert.ok(Math.abs(forces[1]+Math.SQRT2*500)<0.001);
  assert.ok(Math.abs(forces[2]+Math.SQRT2*500)<0.001);
  assert.ok(Math.abs(result.reactions[0].fy-500)<0.001);
  assert.ok(Math.abs(result.reactions[1].fy-500)<0.001);
});

test('unsupported mechanism is reported without fabricated member forces', () => {
  const design = {...triangle,members: triangle.members.slice(0,2)};
  const result = analyzeBridge(design,{2:{fy:-1000}});
  assert.equal(result.ok,false);
  assert.equal(result.diagnosis.kind,'mechanism');
  assert.match(result.error,/move without stretching/i);
  assert.match(result.diagnosis.advice,/diagonal/i);
  assert.equal(result.members,undefined);
});

test('moving axle is split between deck joints and sweep records first failure', () => {
  const design={...triangle,deckNodeIds:[0,1],axleLoads:[{offset:0,force:1000}],deckDeadLoad:0};
  const sweep=runSweep(design,5);
  assert.equal(sweep.frames.length,5);
  assert.deepEqual(sweep.frames[2].loads.map(x=>Math.round(x.fy)),[-500,-500]);
  assert.equal(sweep.frames[0].position,0);
  assert.equal(sweep.frames[4].position,2);
});

test('compression capacity uses Euler buckling below yield when slender', () => {
  const slender={...triangle,sections:{bar:{...triangle.sections.bar,inertia:1e-10}}};
  const result=analyzeBridge(slender,{2:{fy:-1000}});
  const diagonal=result.members.find(m=>m.id===1);
  assert.ok(diagonal.compressionCapacity<diagonal.yieldCapacity);
  assert.ok(diagonal.utilization>1);
  assert.equal(diagonal.failure,'buckling');
});
