import {classPath,parseClassRoute} from '../public/src/classRoutes.mjs';
import {handleApi} from './api.mjs';
import assets from '../.sites-runtime/assets.mjs';
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'"};
export default {async fetch(request,env){
  const url=new URL(request.url);let path=url.pathname;
  if(path.startsWith('/api/'))return handleApi(request,env);
  const route=parseClassRoute(path);
  if(route?.legacy&&classPath(route.classSlug,route.challengeSlug)!==path.replace(/\/$/,''))return new Response(null,{status:302,headers:{...security,Location:classPath(route.classSlug,route.challengeSlug)+url.search}});
  if(path==='/')path='/index.html';else if(path==='/classroom')path='/classroom.html';else if(route)path=route.challengeSlug?'/index.html':'/class.html';
  const asset=assets[path];if(!asset)return new Response('Page not found',{status:404,headers:security});
  return new Response(Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{...security,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
}};
