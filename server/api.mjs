import {RESERVED_CLASS_NAMES} from '../public/src/classRoutes.mjs';
import {parseChallenge} from '../public/src/challenge.mjs';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/../g)||[],h=>parseInt(h,16));
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
export async function passwordHash(password,salt=random()) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256);
  return salt+':'+hex(new Uint8Array(bits));
}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const text=(value,label,max=80)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,`${label} is required (up to ${max} characters).`);return value.trim();};
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'challenge';
const publicUser=u=>({id:u.id,username:u.username,name:u.name,role:u.role,active:!!u.active});
const now=()=>Date.now();
function validPassword(value){if(typeof value!=='string'||value.length<10||value.length>200)fail(400,'Use a password between 10 and 200 characters.');return value;}
function username(value){const result=text(value,'Username',40).toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(result))fail(400,'Username must be 3–40 letters, numbers, dots, hyphens or underscores.');return result;}
async function body(request){if(Number(request.headers.get('content-length'))>1000000)fail(413,'This request is too large.');const raw=await request.text();if(raw.length>1000000)fail(413,'This request is too large.');try{return JSON.parse(raw);}catch{fail(400,'Invalid JSON.');}}
function originCheck(request){if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'Open the app directly before making changes.');}
const sessionCookie=(token,request)=>`bridge_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function session(request,db){const token=request.headers.get('cookie')?.match(/(?:^|;\s*)bridge_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;const hash=await digest(token);const row=await db.prepare('SELECT u.*, s.csrf, s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(hash,now()).first();return row||null;}
async function newSession(user,request,db){const token=random(),csrf=random();await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await digest(token),user.id,csrf,now()+43200000).run();return json({user:publicUser(user),csrf},200,{'Set-Cookie':sessionCookie(token,request)});}
async function owned(db,table,id,user){const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();if(!row)fail(404,'This item no longer exists.');if(user.role!=='admin'&&row.teacher_id!==user.id)fail(403,'This belongs to another teacher.');return row;}
export async function handleApi(request,env) {
 try {
  const db=env.DB;if(!db)fail(503,'Classroom storage is unavailable. Your bridge remains on the board.');
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const parts=path.split('/').filter(Boolean);
  if(method==='GET'&&path==='/api/status'){
    const admin=await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
    const setupAllowed=!!env.SETUP_OWNER_EMAIL&&request.headers.get('oai-authenticated-user-email')===env.SETUP_OWNER_EMAIL;
    return json({needsSetup:!admin,setupAllowed});
  }
  if(method==='GET'&&parts[1]==='public'&&parts[2]==='classes'){
    const className=parts[3]||'';
    const rooms=(await db.prepare('SELECT c.id,c.name,c.slug FROM classes c JOIN users u ON u.id=c.teacher_id WHERE (c.slug=? OR substr(c.slug,1,length(c.slug)-9)=?) AND u.active=1').bind(className,className).all()).results;
    const exact=rooms.find(c=>c.slug===className);
    if(!exact&&rooms.length>1)fail(409,'More than one class uses this name. Ask your teacher to use a distinct class name.');
    const room=exact||rooms[0];
    if(!room)fail(404,'Class not found. Check the link with your teacher.');
    if(parts[4]){const matches=(await db.prepare('SELECT data,title,slug FROM assignments WHERE class_id=? AND (slug=? OR substr(slug,1,length(slug)-7)=?)').bind(room.id,parts[4],parts[4]).all()).results;const exact=matches.find(a=>a.slug===parts[4]);if(!exact&&matches.length>1)fail(409,'More than one assigned challenge uses this name. Ask your teacher to use distinct challenge titles.');const assignment=exact||matches[0];if(!assignment)fail(404,'This challenge is no longer assigned.');return json({className:room.name,classSlug:room.slug,slug:assignment.slug,challenge:JSON.parse(assignment.data)});}
    const assignments=await db.prepare('SELECT title,slug FROM assignments WHERE class_id=? ORDER BY created_at DESC').bind(room.id).all();return json({className:room.name,classSlug:room.slug,assignments:assignments.results});
  }
  if(method!=='GET')originCheck(request);
  if(method==='POST'&&path==='/api/setup'){
    const input=await body(request);
    const platformOwner=!!env.SETUP_OWNER_EMAIL&&request.headers.get('oai-authenticated-user-email')===env.SETUP_OWNER_EMAIL;
    if(!platformOwner&&(!env.SETUP_TOKEN||!equal(String(input.setupToken||''),env.SETUP_TOKEN)))fail(403,'Enter the setup key configured by your server administrator.');
    const name=text(input.name,'Name'),login=username(input.username),hash=await passwordHash(validPassword(input.password)),id=crypto.randomUUID();
    const inserted=await db.prepare("INSERT INTO users(id,username,name,role,password_hash,active,created_at) SELECT ?,?,?,'admin',?,1,? WHERE NOT EXISTS (SELECT id FROM users WHERE role='admin') RETURNING id").bind(id,login,name,hash,now()).first();
    if(!inserted)fail(409,'An administrator already exists. Sign in instead.');
    return newSession({id,username:login,name,role:'admin',active:1},request,db);
  }
  if(method==='POST'&&path==='/api/login'){
    const input=await body(request),login=username(input.username),password=validPassword(input.password);
    const attemptKey=await digest((request.headers.get('cf-connecting-ip')||env.CLIENT_IP||'local')+':'+login),time=now(),windowStart=time-900000;
    const attempt=await db.prepare('SELECT count,window_start FROM login_attempts WHERE key=?').bind(attemptKey).first();
    if(attempt&&attempt.window_start>windowStart&&attempt.count>=10)fail(429,'Too many attempts. Try again in 15 minutes.');
    await db.prepare('INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start>? THEN count+1 ELSE 1 END,window_start=CASE WHEN window_start>? THEN window_start ELSE excluded.window_start END').bind(attemptKey,time,windowStart,windowStart).run();
    const user=await db.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(login).first();
    const stored=user?.password_hash||('0'.repeat(64)+':'+'0'.repeat(64));
    if(!equal(await passwordHash(password,stored.split(':')[0]),stored)||!user)fail(401,'Username or password is incorrect.');
    await db.prepare('DELETE FROM login_attempts WHERE key=?').bind(attemptKey).run();
    await db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(time).run();
    return newSession(user,request,db);
  }
  const user=await session(request,db);
  if(path==='/api/me'&&method==='GET')return json({user:user?publicUser(user):null,csrf:user?.csrf||null});
  if(!user)fail(401,'Sign in to manage your classroom.');
  if(method!=='GET'&&!equal(request.headers.get('x-csrf-token')||'',user.csrf))fail(403,'Your session changed. Reload and try again.');
  if(path==='/api/logout'&&method==='POST'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();return json({ok:true},200,{'Set-Cookie':'bridge_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  if(path==='/api/password'&&method==='POST'){
    const input=await body(request);
    if(!equal(await passwordHash(validPassword(input.currentPassword),user.password_hash.split(':')[0]),user.password_hash))fail(401,'Current password is incorrect.');
    const hash=await passwordHash(validPassword(input.password));
    await db.batch([db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash,user.id),db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(user.id,user.token_hash)]);return json({ok:true});
  }
  if(parts[1]==='teachers'){
    if(user.role!=='admin')fail(403,'Administrator access required.');
    if(method==='GET'){const rows=await db.prepare("SELECT id,username,name,role,active FROM users WHERE role='teacher' ORDER BY name").all();return json({teachers:rows.results.map(publicUser)});}
    const input=await body(request);
    if(method==='POST'&&!parts[2]){
      const id=crypto.randomUUID(),login=username(input.username),name=text(input.name,'Teacher name'),hash=await passwordHash(validPassword(input.password));
      if(await db.prepare('SELECT id FROM users WHERE username=?').bind(login).first())fail(409,'That username is already taken.');
      await db.prepare("INSERT INTO users(id,username,name,role,password_hash,active,created_at) VALUES(?,?,?,'teacher',?,1,?)").bind(id,login,name,hash,now()).run();return json({id},201);
    }
    if(method==='PATCH'&&parts[2]){
      const teacher=await db.prepare("SELECT id FROM users WHERE id=? AND role='teacher'").bind(parts[2]).first();if(!teacher)fail(404,'Teacher not found.');
      const statements=[];
      if(input.password)statements.push(db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await passwordHash(validPassword(input.password)),teacher.id));
      if(typeof input.active==='boolean')statements.push(db.prepare('UPDATE users SET active=? WHERE id=?').bind(input.active?1:0,teacher.id));
      statements.push(db.prepare('DELETE FROM sessions WHERE user_id=?').bind(teacher.id));await db.batch(statements);return json({ok:true});
    }
  }
  if(path==='/api/dashboard'&&method==='GET'){
    const filter=user.role==='admin'?'':' WHERE teacher_id=?';
    const statement=table=>{const q=db.prepare(`SELECT * FROM ${table}${filter} ORDER BY ${table==='challenges'?'updated_at':'created_at'} DESC`);return user.role==='admin'?q:q.bind(user.id);};
    const [rooms,goals]=await Promise.all([statement('classes').all(),statement('challenges').all()]);
    const assigned=await db.prepare(`SELECT a.id,a.class_id,a.challenge_id,a.slug,a.title FROM assignments a JOIN classes c ON c.id=a.class_id${user.role==='admin'?'':' WHERE c.teacher_id=?'}`).bind(...(user.role==='admin'?[]:[user.id])).all();
    return json({classes:rooms.results,challenges:goals.results.map(c=>({...c,data:JSON.parse(c.data)})),assignments:assigned.results});
  }
  if(path==='/api/classes'&&method==='POST'){
    const input=await body(request),name=text(input.name,'Class name'),id=crypto.randomUUID(),roomSlug=slug(name)+'-'+id.slice(0,8);
    const nameSlug=slug(name);if(RESERVED_CLASS_NAMES.has(nameSlug))fail(400,'Choose a more specific class name; this name is reserved.');
    const inserted=await db.prepare('INSERT INTO classes(id,teacher_id,name,slug,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT id FROM classes WHERE substr(slug,1,length(slug)-9)=?) RETURNING id').bind(id,user.id,name,roomSlug,now(),nameSlug).first();
    if(!inserted)fail(409,'That class URL is already taken. Choose a distinct name, such as MS Tech 7A.');return json({id,slug:roomSlug},201);
  }
  if(parts[1]==='classes'&&parts[2]){
    const room=await owned(db,'classes',parts[2],user);
    if(parts[3]==='assign'&&method==='POST'){
      const input=await body(request),challenge=await owned(db,'challenges',String(input.challengeId||''),user);
      if(user.role!=='admin'&&challenge.teacher_id!==room.teacher_id)fail(403,'Choose one of your own challenges.');
      const existing=await db.prepare('SELECT id,slug FROM assignments WHERE class_id=? AND challenge_id=?').bind(room.id,challenge.id).first();
      if(existing){await db.prepare('UPDATE assignments SET data=?,title=? WHERE id=?').bind(challenge.data,challenge.title,existing.id).run();return json({slug:existing.slug});}
      const id=crypto.randomUUID(),goalSlug=slug(challenge.title)+'-'+id.slice(0,6);
      const inserted=await db.prepare('INSERT INTO assignments(id,class_id,challenge_id,slug,title,data,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT id FROM assignments WHERE class_id=? AND substr(slug,1,length(slug)-7)=?) RETURNING id').bind(id,room.id,challenge.id,goalSlug,challenge.title,challenge.data,now(),room.id,slug(challenge.title)).first();
      if(!inserted)fail(409,'This class already has a challenge with that URL. Give the new challenge a distinct title.');return json({slug:goalSlug},201);
    }
    if(parts[3]==='assignments'&&parts[4]&&method==='DELETE'){await db.prepare('DELETE FROM assignments WHERE id=? AND class_id=?').bind(parts[4],room.id).run();return json({ok:true});}
  }
  if(parts[1]==='challenges'){
    if(method==='POST'||method==='PUT'){
      const input=await body(request);let challenge;try{challenge=parseChallenge(JSON.stringify(input.challenge));}catch(error){fail(400,error.message);}
      const data=JSON.stringify(challenge);if(data.length>500000)fail(413,'Challenge is too large.');
      if(method==='PUT'){await owned(db,'challenges',parts[2],user);await db.prepare('UPDATE challenges SET title=?,data=?,updated_at=? WHERE id=?').bind(challenge.title,data,now(),parts[2]).run();return json({id:parts[2]});}
      const id=crypto.randomUUID();await db.prepare('INSERT INTO challenges(id,teacher_id,title,data,updated_at) VALUES(?,?,?,?,?)').bind(id,user.id,challenge.title,data,now()).run();return json({id},201);
    }
  }
  fail(404,'Page not found.');
 }catch(error){if(!(error instanceof HttpError))console.error('Classroom API error:',error);return json({error:error instanceof HttpError?error.message:'Classroom storage is unavailable. Try again; your bridge is still on the board.'},error.status||503);}
}
