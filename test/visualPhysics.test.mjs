import test from 'node:test';
import assert from 'node:assert/strict';
import {visualNodePositions,fractureSegments,failureGeometry,playbackDelay,chooseVisualScale,memberAppearance,collapseFraction,waterImpacts,COLLAPSE_DURATION_MS,WATER_LEVEL} from '../public/src/visualPhysics.mjs';
import {createStarter} from '../public/src/model.mjs';
import {runSweep} from '../public/src/solver.mjs';

const nodes=[{id:0,x:0,y:0},{id:1,x:5,y:4},{id:2,x:10,y:0}];
const displacements=[{node:0,x:0,y:0},{node:1,x:0.001,y:-0.01},{node:2,x:0,y:0}];

test('magnified deflection bends the middle while supports stay fixed',()=>{
  const positions=visualNodePositions(nodes,displacements,40,{span:10,supportIds:[0,2]});
  assert.deepEqual(positions.get(0),{x:0,y:0});
  assert.equal(positions.get(1).y,4-0.4);
  assert.deepEqual(positions.get(2),{x:10,y:0});
});

test('collapse drops joints near the break but leaves supports anchored',()=>{
  const positions=visualNodePositions(nodes,displacements,40,{span:10,supportIds:[0,2],breakX:5,collapse:1});
  assert.deepEqual(positions.get(0),{x:0,y:0});
  assert.ok(positions.get(1).y<1);
  assert.deepEqual(positions.get(2),{x:10,y:0});
});

test('an unstable frame without solved displacements can still show a fall',()=>{
  const positions=visualNodePositions(nodes,undefined,1,{span:10,supportIds:[0,2],breakX:5,collapse:1});
  assert.ok(positions.get(1).y<4);
  assert.deepEqual(positions.get(0),{x:0,y:0});
});

test('failure takes five seconds and ends below the waterline',()=>{
  assert.equal(COLLAPSE_DURATION_MS,5000);
  assert.equal(collapseFraction(0),0);
  assert.equal(collapseFraction(2500),0.5);
  assert.equal(collapseFraction(5000),1);
  assert.equal(collapseFraction(6000),1);
  const halfway=visualNodePositions(nodes,undefined,1,{span:10,supportIds:[0,2],breakX:5,collapse:0.5});
  const end=visualNodePositions(nodes,undefined,1,{span:10,supportIds:[0,2],breakX:5,collapse:1});
  assert.ok(halfway.get(1).y>WATER_LEVEL);
  assert.ok(end.get(1).y<WATER_LEVEL);
  assert.deepEqual(end.get(0),{x:0,y:0});
  assert.deepEqual(end.get(2),{x:10,y:0});
});

test('splash triggers only when a free joint crosses the surface',()=>{
  const previous=new Map([[0,{x:0,y:0}],[1,{x:5,y:WATER_LEVEL+0.1}]]);
  const current=new Map([[0,{x:0,y:-3}],[1,{x:5,y:WATER_LEVEL-0.1}]]);
  assert.deepEqual(waterImpacts(previous,current,[0,1],[0]),[{id:1,x:5}]);
  assert.deepEqual(waterImpacts(current,current,[0,1],[0]),[]);
});

test('a broken member opens a visible gap during collapse',()=>{
  const [left,right]=fractureSegments({x:0,y:0},{x:10,y:0},1);
  assert.ok(left.b.x<right.a.x);
  assert.deepEqual(left.a,{x:0,y:0});
  assert.deepEqual(right.b,{x:10,y:0});
});

test('compression failure bows the member continuously rather than splitting it',()=>{
  const a={x:0,y:0},b={x:10,y:0};
  const shape=failureGeometry(a,b,-120000,0.5);
  assert.equal(shape.kind,'buckling');
  assert.deepEqual(shape.a,a);
  assert.deepEqual(shape.b,b);
  assert.ok(shape.control.y<0);
  assert.equal(failureGeometry(a,b,-120000,0).control.y,0);
});

test('tensile yield remains continuous',()=>{
  const shape=failureGeometry({x:0,y:0},{x:10,y:0},120000,0.5);
  assert.equal(shape.kind,'yield');
  assert.deepEqual(shape.a,{x:0,y:0});
  assert.deepEqual(shape.b,{x:10,y:0});
});

test('the first predicted buckling failure selects the bending geometry',()=>{
  const starter=createStarter();
  const design={...starter,analysisModel:'truss',members:starter.members.map(m=>({...m,section:'light'}))};
  const sweep=runSweep(design,71);
  const failed=sweep.frames[sweep.firstFailure.frame].analysis.members.find(m=>m.id===sweep.firstFailure.member);
  assert.equal(failed.failure,'buckling');
  assert.equal(failureGeometry({x:0,y:0},{x:5,y:3},failed.force,0.4).kind,'buckling');
});

test('truck slows as the weakest member approaches capacity',()=>{
  assert.ok(playbackDelay(0.93)>playbackDelay(0.7));
  assert.ok(playbackDelay(0.7)>playbackDelay(0.2));
});

test('elastic deflection is displayed without amplification',()=>{
  assert.equal(chooseVisualScale([{analysis:{displacements}}]),1);
});
test('steel profile weights have unmistakably different drawing widths',()=>{
  const light=memberAppearance({depth:.1,density:7850});
  const standard=memberAppearance({depth:.15,density:7850});
  const heavy=memberAppearance({depth:.2,density:7850});
  const aluminum=memberAppearance({depth:.18,density:2700});
  assert.ok(light.width<=5);
  assert.ok(standard.width-light.width>=5);
  assert.ok(heavy.width-standard.width>=5);
  assert.ok(aluminum.width>standard.width&&aluminum.width<heavy.width);
  assert.equal(light.material,'steel');assert.equal(aluminum.material,'aluminum');
});
