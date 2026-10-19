import {classPath,parseClassRoute} from './classRoutes.mjs';
import {api,esc} from './http.mjs';
const root=document.getElementById('class-main');
try{
 const slug=parseClassRoute(location.pathname)?.classSlug;
 const data=await api('/api/public/classes/'+encodeURIComponent(slug));
 document.title=data.className+' · Bridge Lab';
 root.innerHTML=`<span class="eyebrow">YOUR CLASS</span><h1>${esc(data.className)}</h1><p>Choose a challenge and build a bridge that holds. No sign-in needed.</p><div class="class-grid">${data.assignments.length?data.assignments.map(a=>`<a class="room-card" href="${classPath(data.classSlug,a.slug)}"><span class="eyebrow">BRIDGE CHALLENGE</span><h2>${esc(a.title)}</h2><span>Open challenge</span></a>`).join(''):'<p>No challenges have been assigned yet. Check back with your teacher.</p>'}</div>`;
}catch(error){root.innerHTML=`<h1>Unable to open this class</h1><p>${esc(error.message)}</p><a href="/">Open free build</a>`;}
