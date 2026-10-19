import {classPath,parseClassRoute} from '../public/src/classRoutes.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {handleApi} from './api.mjs';
import {openDatabase} from './sqlite.mjs';
const db=openDatabase(process.env.DB_PATH||'data/bridge-lab.sqlite');
const root=resolve('public'),port=Number(process.env.PORT||8095);
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"};
createServer(async(req,res)=>{
 try{
  const host=req.headers.host||'localhost:'+port;
  const url=new URL(req.url,'http://'+host);
  if(url.pathname.startsWith('/api/')){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000){res.writeHead(413,security);res.end('Request too large');return;}chunks.push(chunk);}
    const headers=new Headers(req.headers);
    // Platform identity is only trusted on hosted Sites, never from Docker clients.
    for(const key of [...headers.keys()])if(key.startsWith('oai-'))headers.delete(key);
    const forwardedProto=process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https'?'https:':'http:';
    url.protocol=forwardedProto;
    const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    const response=await handleApi(request,{DB:db,SETUP_TOKEN:process.env.BRIDGE_SETUP_TOKEN,CLIENT_IP:req.socket.remoteAddress});
    res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  let path=url.pathname;
  const route=parseClassRoute(path);
  if(route?.legacy&&classPath(route.classSlug,route.challengeSlug)!==path.replace(/\/$/,'')){res.writeHead(302,{...security,Location:classPath(route.classSlug,route.challengeSlug)+url.search});res.end();return;}
  if(path==='/')path='/index.html';
  else if(path==='/classroom')path='/classroom.html';
  else if(route)path=route.challengeSlug?'/index.html':'/class.html';
  const target=resolve(root,'.'+decodeURIComponent(path));
  if(!target.startsWith(root+sep)){res.writeHead(404);res.end('Not found');return;}
  const content=await readFile(target);res.writeHead(200,{...security,'Content-Type':types[extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(content);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500,security);res.end(error.code==='ENOENT'?'Not found':'Unable to load Bridge Lab');}
}).listen(port,'0.0.0.0',()=>console.log(`Bridge Lab listening on port ${port}`));
