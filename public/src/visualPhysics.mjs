// Rendering only. These offsets never feed back into the structural solver.
export const COLLAPSE_DURATION_MS=5000;
export const WATER_LEVEL=(375-422)/27;
export const collapseFraction=elapsedMs=>Math.min(1,Math.max(0,elapsedMs/COLLAPSE_DURATION_MS));

export function visualNodePositions(nodes,displacements,scale,{span,supportIds=[],breakX=null,collapse=0,collapseNodeIds=null,supports=null}={}) {
  const shifts=new Map((displacements||[]).map(d=>[d.node,d]));
  const anchored=new Set(supportIds);
  const positions=new Map();
  for(const node of nodes) {
    const delta=shifts.get(node.id)||{x:0,y:0};
    if(anchored.has(node.id)) {const restraint=supports?.find(s=>s.node===node.id);positions.set(node.id,{x:node.x+(restraint&&!restraint.x?delta.x*scale:0),y:node.y+(restraint&&!restraint.y?delta.y*scale:0)});continue;}
    const influence=breakX===null?0:Math.max(0,1-Math.abs(node.x-breakX)/(span*0.72));
    const baseY=node.y+delta.y*scale;
    const start=Math.min(0.18,(1-influence)*0.14);
    const localCollapse=collapseNodeIds===null||collapseNodeIds.includes(node.id)?collapse:0;
    const t=Math.min(1,Math.max(0,(localCollapse-start)/(1-start)));
    const falling=t*t*(3-2*t);
    const bottom=WATER_LEVEL-0.75-0.3*influence;
    const sway=(node.x<breakX?-1:1)*falling*0.45*influence;
    positions.set(node.id,{x:node.x+delta.x*scale+sway,y:baseY+(bottom-baseY)*falling});
  }
  return positions;
}

export function waterImpacts(previous,current,ids,supportIds=[]) {
  const anchored=new Set(supportIds);
  return ids.filter(id=>!anchored.has(id)&&previous.get(id)?.y>WATER_LEVEL&&current.get(id)?.y<=WATER_LEVEL)
    .map(id=>({id,x:current.get(id).x}));
}

export function fractureSegments(a,b,progress) {
  const gap=Math.min(0.08,Math.max(0,progress)*0.08);
  const point=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const left=point(0.5-gap/2),right=point(0.5+gap/2);
  left.y-=0.24*progress;right.y-=0.24*progress;
  return [{a,b:left},{a:right,b}];
}

export function failureGeometry(a,b,force,progress,failure=force<0?'buckling':'yield') {
  if(failure==='yield')return {kind:'yield',a,b};
  if(failure==='fracture') return {kind:'fracture',segments:fractureSegments(a,b,progress)};
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
  let normalX=-dy/length,normalY=dx/length;
  if(normalY>0 || (normalY===0&&normalX<0)) {normalX=-normalX;normalY=-normalY;}
  const bow=length*0.24*Math.min(1,Math.max(0,progress)*2);
  return {kind:'buckling',a,b,control:{x:(a.x+b.x)/2+normalX*bow,y:(a.y+b.y)/2+normalY*bow}};
}

export function playbackDelay(utilization) {
  return utilization>=0.85?240:utilization>=0.65?155:95;
}

export function chooseVisualScale() {
  return 1;
}

export function memberAppearance(section={}) {
  const depth=Number.isFinite(section.depth)?section.depth:0.12;
  return {width:Math.max(5,Math.min(15,Math.round(100*depth-5))),material:(section.density||0)<5000?'aluminum':'steel'};
}

// Add the solved member curvature relative to its end chord. This also lets the
// illustrative fall move endpoints without drawing a spurious filled polygon.
export function memberCurvePoints(a,b,result,scale=1) {
  if(!result?.curve?.length)return [a,b];
  const first=result.curve[0],last=result.curve.at(-1);
  return result.curve.map(p=>({x:a.x+(b.x-a.x)*p.t+(p.dx-first.dx*(1-p.t)-last.dx*p.t)*scale,
    y:a.y+(b.y-a.y)*p.t+(p.dy-first.dy*(1-p.t)-last.dy*p.t)*scale}));
}
