import {FORCE_UNITS} from './loads.mjs';
const tube=(name,b,t,cost,density=7850,E=200e9,yieldStress=250e6)=>({
  name,area:b*b-(b-2*t)**2,inertia:(b**4-(b-2*t)**4)/12,
  E,yield:yieldStress,density,cost,depth:b,wall:t
});

export const SECTIONS={
  light:tube('Light steel · 100 mm',0.1,0.005,3.2),
  standard:tube('Standard steel · 150 mm',0.15,0.008,3.2),
  heavy:tube('Heavy steel · 200 mm',0.2,0.01,3.2),
  aluminum:tube('Aluminum · 180 mm',0.18,0.01,7.5,2700,69e9,240e6)
};

export function createStarter() {
  const nodes=[];
  for(let i=0;i<=6;i++) nodes.push({id:i,x:i*5,y:0});
  for(let i=1;i<=5;i++) nodes.push({id:6+i,x:i*5,y:5});
  const members=[];
  const link=(a,b)=>members.push({id:members.length,a,b,section:'heavy'});
  for(let i=0;i<6;i++) link(i,i+1);
  for(let i=7;i<11;i++) link(i,i+1);
  link(0,7);link(11,6);
  for(let i=1;i<=5;i++) link(i,6+i);
  for(let i=1;i<=4;i++) link(i,7+i);
  return {version:1,name:'First crossing',analysisModel:'frame',span:30,nodes,members,
    supports:[{node:0,x:true,y:true},{node:6,x:false,y:true}],
    deckNodeIds:[0,1,2,3,4,5,6],deckDeadLoad:8000,deckLineLoad:1600,
    axleLoads:[{offset:0,force:40000},{offset:4,force:120000}],
    sections:structuredClone(SECTIONS)};
}

export function addJoint(design,x,y) {
  const nx=Math.max(0,Math.min(design.span,Math.round(x))),ny=Math.max(0,Math.min(12,Math.round(y)));
  const existing=design.nodes.find(n=>n.x===nx && n.y===ny);
  if(existing) return {design,node:existing};
  const node={id:Math.max(-1,...design.nodes.map(n=>n.id))+1,x:nx,y:ny};
  return {design:{...design,nodes:[...design.nodes,node]},node};
}

export function addMember(design,a,b,section='standard') {
  if(a===b || !design.nodes.some(n=>n.id===a) || !design.nodes.some(n=>n.id===b) ||
    design.members.some(m=>m.a===a&&m.b===b || m.a===b&&m.b===a)) return design;
  const id=Math.max(-1,...design.members.map(m=>m.id))+1;
  return {...design,members:[...design.members,{id,a,b,section}]};
}

export function parseDesign(raw) {
  let d;
  try { d=JSON.parse(raw); } catch { throw Error('Invalid bridge JSON file.'); }
  const valid=d?.version===1 && typeof d.name==='string' && d.name.length<=100 &&
    Number.isFinite(d.span) && d.span>=5 && d.span<=100 &&
    Array.isArray(d.nodes) && d.nodes.length>=2 && d.nodes.length<=100 &&
    Array.isArray(d.members) && d.members.length>0 && d.members.length<=250 &&
    Array.isArray(d.supports) && d.supports.length===2 &&
    Array.isArray(d.deckNodeIds) && d.deckNodeIds.length>=2 &&
    Array.isArray(d.axleLoads) && d.axleLoads.length<=10 &&
    d.sections && typeof d.sections==='object';
  if(!valid) throw Error('Invalid bridge file or unsupported format.');
  if(d.staticLoads!==undefined&&(!Array.isArray(d.staticLoads)||d.staticLoads.length>20||d.staticLoads.some(l=>!Number.isFinite(l.x)||l.x<0||l.x>d.span||!Number.isFinite(l.force)||l.force<0||l.force>1e7)))throw Error('Invalid stationary load data.');
  if(d.forceUnit!==undefined&&!FORCE_UNITS[d.forceUnit])throw Error('Invalid force unit.');
  if(d.loadCase!==undefined&&(!['moving','static','combined'].includes(d.loadCase.type)||!Number.isInteger(d.loadCase.truckCount)||d.loadCase.truckCount<1||d.loadCase.truckCount>5||!Number.isFinite(d.loadCase.truckSpacing)||d.loadCase.truckSpacing<8||d.loadCase.truckSpacing>100))throw Error('Invalid truck configuration.');
  if(d.analysisModel!==undefined&&!['frame','truss'].includes(d.analysisModel))throw Error('Invalid structural model.');
  if(d.deckLineLoad!==undefined&&(!Number.isFinite(d.deckLineLoad)||d.deckLineLoad<0||d.deckLineLoad>1e7))throw Error('Invalid road weight per metre.');
  if(d.nodes.some(n=>n.connection!==undefined&&!['rigid','hinge'].includes(n.connection)))throw Error('Invalid joint connection.');
  const ids=new Set(d.nodes.map(n=>n.id));
  if(ids.size!==d.nodes.length || d.nodes.some(n=>!Number.isSafeInteger(n.id)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<0||n.x>d.span||n.y<0||n.y>12) ||
    d.members.some(m=>!Number.isSafeInteger(m.id)||!ids.has(m.a)||!ids.has(m.b)||m.a===m.b||!d.sections[m.section]) ||
    new Set(d.members.map(m=>m.id)).size!==d.members.length ||
    d.supports.some(s=>!ids.has(s.node)||typeof s.x!=='boolean'||typeof s.y!=='boolean'||(s.rotation!==undefined&&typeof s.rotation!=='boolean')) ||
    new Set(d.deckNodeIds).size!==d.deckNodeIds.length ||
    new Set(d.deckNodeIds.map(id=>d.nodes.find(n=>n.id===id)?.x)).size!==d.deckNodeIds.length ||
    d.deckNodeIds.some(id=>!ids.has(id)) ||
    d.axleLoads.some(a=>!Number.isFinite(a.force)||a.force<0||a.force>1e7||!Number.isFinite(a.offset)) ||
    !Number.isFinite(d.deckDeadLoad)||d.deckDeadLoad<0||d.deckDeadLoad>1e7 ||
    Object.values(d.sections).some(s=>!s ||
      ['area','inertia','E','yield'].some(k=>!Number.isFinite(s[k])||s[k]<=0) ||
      (s.depth!==undefined&&(!Number.isFinite(s.depth)||s.depth<=0)) ||
      ['density','cost'].some(k=>!Number.isFinite(s[k])||s[k]<0)))
    throw Error('Invalid bridge geometry or member data.');
  d.analysisModel??='truss';
  if(d.deckLineLoad===undefined&&d.analysisModel==='frame')d.deckLineLoad=d.deckDeadLoad*(d.deckNodeIds.length-1)/d.span;
  return d;
}

// A member drawn over a joint is not connected there: only its endpoints connect.
export function findPassThroughs(design) {
  const nodes=new Map(design.nodes.map(n=>[n.id,n]));
  const crossings=[];
  for(const member of design.members) {
    const a=nodes.get(member.a),b=nodes.get(member.b);
    if(!a||!b)continue;
    const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    if(length2<1e-12)continue;
    for(const n of design.nodes) {
      const t=((n.x-a.x)*dx+(n.y-a.y)*dy)/length2;
      const cross=(n.x-a.x)*dy-(n.y-a.y)*dx;
      if(n.id!==a.id&&n.id!==b.id&&t>1e-8&&t<1-1e-8&&Math.abs(cross)<1e-8*Math.sqrt(length2)) {
        crossings.push({memberId:member.id,nodeId:n.id,x:n.x,y:n.y});
      }
    }
  }
  return crossings;
}

export function clearDesign(design) {
  const fixed=new Set(design.deckNodeIds);
  return {...design,nodes:design.nodes.filter(n=>fixed.has(n.id)),members:[]};
}

export function deleteSelected(design,selection) {
  const fixed=new Set(design.deckNodeIds);
  const removedNodes=new Set(design.nodes.filter(n=>selection.has('node:'+n.id)&&!fixed.has(n.id)).map(n=>n.id));
  return {...design,nodes:design.nodes.filter(n=>!removedNodes.has(n.id)),
    members:design.members.filter(m=>!selection.has('member:'+m.id)&&!removedNodes.has(m.a)&&!removedNodes.has(m.b))};
}

export function selectInBox(design,{x1,y1,x2,y2}) {
  const minX=Math.min(x1,x2),maxX=Math.max(x1,x2),minY=Math.min(y1,y2),maxY=Math.max(y1,y2);
  const inside=n=>n.x>=minX&&n.x<=maxX&&n.y>=minY&&n.y<=maxY;
  const nodes=new Map(design.nodes.map(n=>[n.id,n]));
  const result=new Set();
  for(const n of design.nodes)if(inside(n))result.add('node:'+n.id);
  for(const m of design.members)if(inside(nodes.get(m.a))&&inside(nodes.get(m.b)))result.add('member:'+m.id);
  return result;
}

export function moveNodes(design,ids,dx,dy) {
  const moved=new Set(ids.filter(id=>!design.deckNodeIds.includes(id)));
  if(!moved.size)return design;
  const nodes=design.nodes.map(n=>moved.has(n.id)?{...n,x:Math.max(0,Math.min(design.span,Math.round(n.x+dx))),
    y:Math.max(0,Math.min(12,Math.round(n.y+dy)))}:n);
  if(new Set(nodes.map(n=>n.x+','+n.y)).size!==nodes.length)return design;
  if(nodes.every((n,i)=>n.x===design.nodes[i].x&&n.y===design.nodes[i].y))return design;
  return {...design,nodes};
}
