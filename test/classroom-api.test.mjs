import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../server/api.mjs';
import {openDatabase} from '../server/sqlite.mjs';
import {createChallenge} from '../public/src/challenge.mjs';
import {createStarter} from '../public/src/model.mjs';
const origin='https://bridge.test';
function client(db){let cookie='',csrf='';return {async call(path,{method='GET',data,headers={}}={}){const response=await handleApi(new Request(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},...(data?{body:JSON.stringify(data)}:{})}),{DB:db,SETUP_TOKEN:'test-setup-key'});const result=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(result.csrf)csrf=result.csrf;return {status:response.status,...result};}};}

test('admin creates teachers; classes expose snapshots by URL while management stays private',async()=>{
 const db=openDatabase(),admin=client(db),teacher=client(db),other=client(db),student=client(db);
 try{
  assert.equal((await admin.call('/api/setup',{method:'POST',data:{setupToken:'wrong',username:'admin',name:'Admin',password:'secure-admin-pass'}})).status,403);
  assert.equal((await admin.call('/api/setup',{method:'POST',data:{setupToken:'test-setup-key',username:'admin',name:'Admin',password:'secure-admin-pass'}})).user.role,'admin');
  assert.equal((await other.call('/api/setup',{method:'POST',data:{setupToken:'test-setup-key',username:'admin2',name:'Other',password:'secure-admin-pass'}})).status,409);
  const teacherId=(await admin.call('/api/teachers',{method:'POST',data:{username:'teacher',name:'Teacher',password:'teacher-pass-1'}})).id;
  await admin.call('/api/teachers',{method:'POST',data:{username:'teacher2',name:'Teacher 2',password:'teacher-pass-2'}});
  assert.equal((await teacher.call('/api/login',{method:'POST',data:{username:'teacher',password:'incorrect-pass'}})).status,401);
  assert.equal((await teacher.call('/api/login',{method:'POST',data:{username:'teacher',password:'teacher-pass-1'}})).user.role,'teacher');
  await other.call('/api/login',{method:'POST',data:{username:'teacher2',password:'teacher-pass-2'}});
  assert.equal((await teacher.call('/api/teachers')).status,403);
  const room=await teacher.call('/api/classes',{method:'POST',data:{name:'Design 7A'}});
  assert.equal((await other.call('/api/classes',{method:'POST',data:{name:'Design 7A'}})).status,409);
  assert.equal((await teacher.call('/api/classes',{method:'POST',data:{name:'Classroom'}})).status,400);
  const challenge=createChallenge({title:'Challenge 1',instructions:'Carry the truck.',maxCost:50000,starter:createStarter()});
  const goal=await teacher.call('/api/challenges',{method:'POST',data:{challenge}});
  assert.equal((await other.call('/api/challenges/'+goal.id,{method:'PUT',data:{challenge}})).status,403);
  assert.equal((await other.call('/api/classes/'+room.id+'/assign',{method:'POST',data:{challengeId:goal.id}})).status,403);
  assert.equal((await student.call('/api/dashboard')).status,401);
  assert.equal((await teacher.call('/api/classes',{method:'POST',data:{name:'Forged'},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await teacher.call('/api/classes',{method:'POST',data:{name:'Foreign'},headers:{Origin:'https://foreign.test'}})).status,403);
  const assignment=await teacher.call('/api/classes/'+room.id+'/assign',{method:'POST',data:{challengeId:goal.id}});
  const path='/api/public/classes/'+room.slug+'/'+assignment.slug;
  assert.equal((await student.call(path)).challenge.title,'Challenge 1');
  assert.equal((await student.call('/api/public/classes/design-7a/challenge-1')).challenge.title,'Challenge 1');
  assert.equal((await student.call('/api/public/classes/design-7a')).assignments.length,1);
  const duplicate=await teacher.call('/api/challenges',{method:'POST',data:{challenge}});
  assert.equal((await teacher.call('/api/classes/'+room.id+'/assign',{method:'POST',data:{challengeId:duplicate.id}})).status,409);
  assert.equal((await student.call('/api/public/classes/'+room.slug)).assignments.length,1);
  await teacher.call('/api/challenges/'+goal.id,{method:'PUT',data:{challenge:{...challenge,title:'Updated title',rearKn:200}}});
  assert.equal((await student.call(path)).challenge.title,'Challenge 1','draft changes do not mutate an assigned snapshot');
  assert.equal((await teacher.call('/api/classes/'+room.id+'/assign',{method:'POST',data:{challengeId:goal.id}})).slug,assignment.slug,'reassignment keeps the URL');
  assert.equal((await student.call(path)).challenge.rearKn,200);
  assert.equal((await other.call('/api/dashboard')).challenges.length,0);
  await admin.call('/api/teachers/'+teacherId,{method:'PATCH',data:{active:false}});
  assert.equal((await teacher.call('/api/dashboard')).status,401);
  assert.equal((await student.call(path)).status,404);
  await admin.call('/api/teachers/'+teacherId,{method:'PATCH',data:{active:true,password:'new-teacher-pass'}});
  assert.equal((await teacher.call('/api/login',{method:'POST',data:{username:'teacher',password:'teacher-pass-1'}})).status,401);
  assert.equal((await teacher.call('/api/login',{method:'POST',data:{username:'teacher',password:'new-teacher-pass'}})).status,200);
  const assigned=(await teacher.call('/api/dashboard')).assignments[0];
  await teacher.call('/api/classes/'+room.id+'/assignments/'+assigned.id,{method:'DELETE',data:{}});
  assert.equal((await student.call(path)).status,404);
 }finally{db.close();}
});

test('login rate limiting prevents repeated guesses and invalid challenge goals are rejected',async()=>{
 const db=openDatabase(),admin=client(db);
 try{
  await admin.call('/api/setup',{method:'POST',data:{setupToken:'test-setup-key',username:'admin',name:'Admin',password:'secure-admin-pass'}});
  assert.equal((await admin.call('/api/challenges',{method:'POST',data:{challenge:{type:'bridge-lab-challenge',version:1,title:'Bad',starter:{}}}})).status,400);
  const attacker=client(db);
  for(let i=0;i<10;i++)assert.equal((await attacker.call('/api/login',{method:'POST',data:{username:'admin',password:'incorrect-pass'}})).status,401);
  assert.equal((await attacker.call('/api/login',{method:'POST',data:{username:'admin',password:'incorrect-pass'}})).status,429);
 }finally{db.close();}
});
