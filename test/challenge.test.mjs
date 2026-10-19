import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarter} from '../public/src/model.mjs';
import {createChallenge,parseChallenge,challengeOutcome,parseBudget} from '../public/src/challenge.mjs';

const input=()=>({title:'Lightweight crossing',instructions:'Carry the truck using less steel.',maxCost:12000,
  frontKn:50,rearKn:140,starter:createStarter()});

test('budget input accepts currency formatting and blanks without silently changing malformed amounts',()=>{
  for(const value of ['12000','12,000','$12,000',' $ 12,000 '])assert.equal(parseBudget(value),12000);
  assert.equal(parseBudget('$12,000.50'),12000.5);
  assert.equal(parseBudget(''),null);
  assert.equal(parseBudget('   '),null);
  for(const value of ['$','1,2,3','-100','0','12abc','1e4','1,000,000,001'])assert.throws(()=>parseBudget(value));
  const challenge=createChallenge({...input(),maxCost:parseBudget('$12,000')});
  assert.equal(parseChallenge(JSON.stringify(challenge)).maxCost,12000);
});

test('teacher challenge preserves a starter bridge and replaces its truck loads',()=>{
  const challenge=createChallenge(input());
  assert.equal(challenge.type,'bridge-lab-challenge');
  assert.equal(challenge.starter.axleLoads[0].force,50000);
  assert.equal(challenge.starter.axleLoads[1].force,140000);
  assert.deepEqual(challenge.starter.axleLoads.map(a=>a.offset),[0,4]);
  assert.equal(parseChallenge(JSON.stringify(challenge)).instructions,input().instructions);
});

test('challenge import rejects malformed goals and invalid starter designs',()=>{
  assert.throws(()=>createChallenge({...input(),maxCost:-1}),/budget/i);
  assert.throws(()=>createChallenge({...input(),rearKn:0}),/axle/i);
  assert.throws(()=>parseChallenge(JSON.stringify({...createChallenge(input()),starter:{}})),/bridge|starter/i);
});

test('passing the truck and meeting the budget are separate challenge goals',()=>{
  const challenge=createChallenge(input());
  assert.equal(challengeOutcome(challenge,null,9000,false).status,'not_tested');
  assert.equal(challengeOutcome(challenge,{firstFailure:null},9000,false).status,'testing');
  assert.equal(challengeOutcome(challenge,{firstFailure:{frame:4}},9000,true).status,'failed');
  assert.equal(challengeOutcome(challenge,{firstFailure:null},13000,true).status,'over_budget');
  assert.equal(challengeOutcome(challenge,{firstFailure:null},9000,true).status,'passed');
  assert.match(challengeOutcome(createChallenge({...input(),maxCost:null}),{firstFailure:null},9000,true).message,/bridge held\./i);
});
