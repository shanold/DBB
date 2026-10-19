// SI units: m, N, Pa, kg. Positive axial force means tension.
import {analyzeFrame} from './frame.mjs';
import {findPassThroughs} from './model.mjs';
const GRAVITY=9.81;

function solve(A,b) {
  const n=b.length, rows=A.map((row,i)=>[...row,b[i]]);
  const scale=Math.max(1,...A.map(row=>Math.max(...row.map(Math.abs))));
  for(let col=0;col<n;col++) {
    let pivot=col;
    for(let r=col+1;r<n;r++) if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col])) pivot=r;
    if(Math.abs(rows[pivot][col])<scale*1e-12) return {x:null,singularColumn:col};
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const p=rows[col][col];
    for(let r=col+1;r<n;r++) {
      const factor=rows[r][col]/p;
      for(let c=col;c<=n;c++) rows[r][c]-=factor*rows[col][c];
    }
  }
  const x=Array(n).fill(0);
  for(let r=n-1;r>=0;r--) {
    let value=rows[r][n];
    for(let c=r+1;c<n;c++) value-=rows[r][c]*x[c];
    x[r]=value/rows[r][r];
  }
  return {x,singularColumn:null};
}

// A free pin-jointed motion is a null vector of the member-length constraints.
// Finding it separately from the stiffness solve avoids mistaking a pivot
// column for the location of a hinge.
function findFreeModes(design) {
  const nodes=design.nodes||[],index=new Map(nodes.map((n,i)=>[n.id,i]));
  const fixed=new Set();
  for(const support of design.supports||[]) {
    const i=index.get(support.node);
    if(i===undefined)continue;
    if(support.x)fixed.add(2*i);
    if(support.y)fixed.add(2*i+1);
  }
  const free=Array.from({length:2*nodes.length},(_,i)=>i).filter(i=>!fixed.has(i));
  const columns=new Map(free.map((dof,i)=>[dof,i]));
  const rows=(design.members||[]).map(member=>{
    const ia=index.get(member.a),ib=index.get(member.b),a=nodes[ia],b=nodes[ib];
    const length=Math.hypot(b.x-a.x,b.y-a.y),c=(b.x-a.x)/length,s=(b.y-a.y)/length;
    const row=Array(free.length).fill(0);
    for(const [dof,value] of [[2*ia,-c],[2*ia+1,-s],[2*ib,c],[2*ib+1,s]]) {
      const col=columns.get(dof);if(col!==undefined)row[col]+=value;
    }
    return row;
  });
  const pivots=[];
  for(let col=0;col<free.length&&pivots.length<rows.length;col++) {
    const start=pivots.length;
    let pivot=start;
    for(let r=start+1;r<rows.length;r++)if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
    if(Math.abs(rows[pivot][col])<1e-10)continue;
    [rows[start],rows[pivot]]=[rows[pivot],rows[start]];
    const divisor=rows[start][col];
    for(let j=col;j<free.length;j++)rows[start][j]/=divisor;
    for(let r=start+1;r<rows.length;r++) {
      const factor=rows[r][col];
      for(let j=col;j<free.length;j++)rows[r][j]-=factor*rows[start][j];
    }
    pivots.push(col);
  }
  const pivotSet=new Set(pivots);
  return free.flatMap((_,freeColumn)=>{
    if(pivotSet.has(freeColumn))return [];
    const motion=Array(free.length).fill(0);motion[freeColumn]=1;
    for(let r=pivots.length-1;r>=0;r--)
      motion[pivots[r]]=-rows[r].slice(pivots[r]+1).reduce((sum,value,i)=>sum+value*motion[pivots[r]+1+i],0);
    const byNode=nodes.map((node,i)=>({node:node.id,x:motion[columns.get(2*i)]||0,y:motion[columns.get(2*i+1)]||0}));
    const largest=Math.max(...byNode.map(d=>Math.hypot(d.x,d.y)));
    return largest<1e-8?[]:[byNode.map(d=>({node:d.node,x:d.x/largest,y:d.y/largest}))];
  });
}

function findFreeMode(design) { return findFreeModes(design)[0]||null; }

function diagnoseInstability(design) {
  const nodes=design.nodes||[],members=design.members||[];
  // A crossing is a cause only if connecting it removes at least one free mode.
  // This is a diagnostic experiment, never an edit to the student's design.
  const modes=findFreeModes(design);
  const pass=findPassThroughs({...design,nodes,members}).find(p=>{
    const member=members.find(m=>m.id===p.memberId);
    const repaired={...design,members:members.filter(m=>m!==member).concat(
      {...member,b:p.nodeId},{...member,a:p.nodeId})};
    return findFreeModes(repaired).length<modes.length;
  });
  if(pass) return {kind:'pass_through',memberId:pass.memberId,nodeId:pass.nodeId,affectedNodeIds:[pass.nodeId],
    message:`Member ${pass.memberId+1} passes through Joint ${pass.nodeId+1} without connecting.`,
    advice:'A line touching a joint is not a connection. Replace the long member with two members that end at this joint.'};
  if(!members.length) return {kind:'empty',nodeId:null,affectedNodeIds:(design.deckNodeIds||[]).slice(1,-1),
    message:'The deck has no truss members to carry the truck.',
    advice:'Add members between deck joints, then build triangles to carry the load to both supports.'};
  const degree=new Map(nodes.map(n=>[n.id,0])),graph=new Map(nodes.map(n=>[n.id,[]]));
  for(const m of members) {
    degree.set(m.a,(degree.get(m.a)||0)+1);degree.set(m.b,(degree.get(m.b)||0)+1);
    graph.get(m.a)?.push(m.b);graph.get(m.b)?.push(m.a);
  }
  const isolated=nodes.find(n=>degree.get(n.id)===0);
  if(isolated)return {kind:'isolated_joint',nodeId:isolated.id,affectedNodeIds:[isolated.id],
    message:`Joint ${isolated.id+1} has no connected members.`,
    advice:'Connect this joint to the truss, or remove it if it is not part of the design.'};
  const reached=new Set((design.supports||[]).map(s=>s.node)),queue=[...reached];
  for(let i=0;i<queue.length;i++)for(const next of graph.get(queue[i])||[])if(!reached.has(next)){reached.add(next);queue.push(next);}
  const disconnected=nodes.filter(n=>!reached.has(n.id));
  if(disconnected.length)return {kind:'disconnected',nodeId:disconnected[0].id,affectedNodeIds:disconnected.map(n=>n.id),
    message:`${disconnected.length} joint${disconnected.length===1?' has':'s have'} no member path to a support.`,
    advice:'Connect the highlighted part of the truss to the supported span.'};
  const deck=(design.deckNodeIds||[]).map(id=>nodes.find(n=>n.id===id)).filter(Boolean).sort((a,b)=>a.x-b.x);
  const hasMember=(a,b)=>members.some(m=>m.a===a&&m.b===b||m.a===b&&m.b===a);
  const missingPairs=[];
  for(let i=1;i<deck.length;i++)if(!hasMember(deck[i-1].id,deck[i].id))missingPairs.push([deck[i-1].id,deck[i].id]);
  if(missingPairs.length) {
    const braced={...design,members:[...members,...missingPairs.map(([a,b])=>({a,b}))]};
    if(!findFreeMode(braced))return {kind:'missing_deck_chord',nodeId:null,missingPairs,
      affectedNodeIds:[...new Set(missingPairs.flat())],
      message:'The road deck is drawn, but it is not a structural bottom chord.',
      advice:'Draw separate members between the marked neighboring deck joints.'};
  }
  const mode=findFreeMode(design);
  if(!mode)return {kind:'unresolved',nodeId:null,affectedNodeIds:[],
    message:'The force solver could not resolve this geometry reliably.',
    advice:'Check overlapping or nearly aligned members and try moving a joint.'};
  const affectedNodeIds=mode.filter(d=>Math.hypot(d.x,d.y)>0.18).map(d=>d.node);
  return {kind:'mechanism',nodeId:null,affectedNodeIds,mode,
    message:'These joints can move without stretching the connected members.',
    advice:'Add a diagonal that braces the moving section against the supports.'};
}

export function analyzeBridge(design, externalLoads={}, {disabledMemberIds=[]}={}) {
  if(design.analysisModel==='frame')return analyzeFrame(design,externalLoads,{disabledMemberIds});
  const disabled=new Set(disabledMemberIds);
  const nodes=design.nodes;
  if(!nodes?.length || !design.members?.length) {
    const diagnosis=diagnoseInstability(design);
    return {ok:false,error:diagnosis.message,diagnosis};
  }
  const index=new Map(nodes.map((n,i)=>[n.id,i]));
  if(index.size!==nodes.length) return {ok:false,error:'Joint IDs must be unique.'};
  const count=nodes.length*2, K=Array.from({length:count},()=>Array(count).fill(0)), F=Array(count).fill(0);
  const pieces=[];
  let cost=0,weight=0;
  for(const m of design.members) {
    const ia=index.get(m.a),ib=index.get(m.b),section=design.sections[m.section];
    if(ia===undefined || ib===undefined || !section) return {ok:false,error:'A member refers to a missing joint or section.'};
    const dx=nodes[ib].x-nodes[ia].x,dy=nodes[ib].y-nodes[ia].y,length=Math.hypot(dx,dy);
    if(!Number.isFinite(length) || length<0.01 || ['area','E','inertia','yield'].some(k=>!Number.isFinite(section[k])||section[k]<=0)) return {ok:false,error:'A member has invalid geometry or dimensions.'};
    const c=dx/length,s=dy/length,k=section.E*section.area/length;
    const direction=[c,s,-c,-s],dof=[2*ia,2*ia+1,2*ib,2*ib+1];
    if(!disabled.has(m.id))for(let i=0;i<4;i++) for(let j=0;j<4;j++) K[dof[i]][dof[j]]+=k*direction[i]*direction[j];
    const mass=length*section.area*(section.density||0);
    F[2*ia+1]-=mass*GRAVITY/2;
    F[2*ib+1]-=mass*GRAVITY/2;
    weight+=mass;
    cost+=mass*(section.cost||0);
    pieces.push({m,ia,ib,length,c,s,section});
  }
  if(new Set(design.deckNodeIds).size!==design.deckNodeIds?.length)return {ok:false,error:'Deck joints must be unique.'};
  for(const id of design.deckNodeIds||[]) {
    if(!index.has(id)) return {ok:false,error:'The deck refers to a missing joint.'};
    if(design.deckLineLoad===undefined)F[2*index.get(id)+1]-=design.deckDeadLoad||0;
  }
  if(design.deckLineLoad!==undefined){
    if(!Number.isFinite(design.deckLineLoad)||design.deckLineLoad<0)return {ok:false,error:'Invalid road weight per metre.'};
    const roadNodes=design.deckNodeIds.map(id=>nodes[index.get(id)]).sort((a,b)=>a.x-b.x);
    for(let i=1;i<roadNodes.length;i++){
      const a=roadNodes[i-1],b=roadNodes[i],half=design.deckLineLoad*(b.x-a.x)/2;
      F[2*index.get(a.id)+1]-=half;F[2*index.get(b.id)+1]-=half;
    }
  }
  for(const [id,load] of Object.entries(externalLoads)) {
    if(!index.has(Number(id))) return {ok:false,error:'A load refers to a missing joint.'};
    if(!Number.isFinite(load.fx??0)||!Number.isFinite(load.fy??0))return {ok:false,error:'Loads must be finite numbers.'};
    F[2*index.get(Number(id))]+=(load.fx||0);
    F[2*index.get(Number(id))+1]+=(load.fy||0);
  }
  const fixed=new Set();
  for(const support of design.supports||[]) {
    const i=index.get(support.node);
    if(i===undefined) return {ok:false,error:'A support refers to a missing joint.'};
    if(support.x) fixed.add(2*i);
    if(support.y) fixed.add(2*i+1);
  }
  // Ignore only unused, unloaded, non-deck joints. Loaded/deck joints still
  // require a load path, including joints attached to members lost in this check.
  const activeMembers=design.members.filter(m=>!disabled.has(m.id));
  const connected=new Set(activeMembers.flatMap(m=>[m.a,m.b]));
  const ignoredNodeIds=nodes.filter((n,i)=>!connected.has(n.id)&&!design.deckNodeIds?.includes(n.id)&&
    !F[2*i]&&!F[2*i+1]&&!design.supports?.some(s=>s.node===n.id)).map(n=>n.id);
  const ignored=new Set(ignoredNodeIds);
  nodes.forEach((n,i)=>{if(ignored.has(n.id)){fixed.add(2*i);fixed.add(2*i+1);}});
  const diagnosticDesign={...design,nodes:nodes.filter(n=>!ignored.has(n.id)),members:activeMembers};
  const free=Array.from({length:count},(_,i)=>i).filter(i=>!fixed.has(i));
  if(!design.supports?.some(s=>s.x||s.y)) return {ok:false,error:'The bridge needs valid supports.'};
  const solved=solve(free.map(i=>free.map(j=>K[i][j])),free.map(i=>F[i]));
  if(!solved.x) {
    const diagnosis=diagnoseInstability(diagnosticDesign);
    const modes=findFreeModes(diagnosticDesign);
    const movable=new Set(modes.flatMap(mode=>mode.filter(d=>Math.hypot(d.x,d.y)>1e-7).map(d=>d.node)));
    const collapseNodeIds=[...movable].filter(id=>!design.supports.some(s=>s.node===id&&s.y));
    return {ok:false,error:diagnosis.message,diagnosis,collapseNodeIds,ignoredNodeIds};
  }
  const u=Array(count).fill(0);
  free.forEach((dof,i)=>u[dof]=solved.x[i]);
  const members=pieces.map(({m,ia,ib,length,c,s,section})=>{
    const force=disabled.has(m.id)?0:section.E*section.area/length*(c*(u[2*ib]-u[2*ia])+s*(u[2*ib+1]-u[2*ia+1]));
    const yieldCapacity=section.area*section.yield;
    const eulerCapacity=Math.PI**2*section.E*section.inertia/length**2;
    const compressionCapacity=Math.min(yieldCapacity,eulerCapacity);
    const capacity=force<0?compressionCapacity:yieldCapacity;
    const utilization=Math.abs(force)/capacity;
    return {id:m.id,a:m.a,b:m.b,section:m.section,length,force,removed:disabled.has(m.id),stress:force/section.area,
      yieldCapacity,eulerCapacity,compressionCapacity,capacity,utilization,
      failure:utilization>1?(force<0 && eulerCapacity<yieldCapacity?'buckling':'yield'):null};
  });
  const reactions=(design.supports||[]).map(s=>{
    const i=index.get(s.node),component=axis=>K[2*i+axis].reduce((acc,v,j)=>acc+v*u[j],0)-F[2*i+axis];
    return {node:s.node,fx:s.x?component(0):0,fy:s.y?component(1):0};
  });
  return {ok:true,members,reactions,displacements:nodes.map((node,i)=>({node:node.id,x:u[2*i],y:u[2*i+1]})),
    weight,cost,ignoredNodeIds,passed:members.every(m=>!m.failure),maxUtilization:Math.max(...members.map(m=>m.utilization))};
}

// Conservative alternate-load-path check, not a plasticity/fracture model.
// All members over capacity in a stage lose stiffness together. Their weight
// stays on the original joints. Re-solve at the SAME load until stable or singular.
export function checkMemberLoss(design,loads,initial=analyzeBridge(design,loads)) {
  const disabledMemberIds=[],damagedMembers=[],stages=[];
  let analysis=initial;
  for(let step=0;step<=design.members.length;step++) {
    if(!analysis.ok)return {status:analysis.diagnosis&&analysis.diagnosis.kind!=='unresolved'?'unstable':'unresolved',stages,damagedMembers,
      residualAnalysis:analysis,collapseNodeIds:analysis.collapseNodeIds||analysis.diagnosis?.affectedNodeIds||[]};
    const overloaded=analysis.members.filter(m=>m.failure&&!disabledMemberIds.includes(m.id)).sort((a,b)=>a.id-b.id);
    if(!overloaded.length)return {status:analysis.largeDisplacement?'flexible':'held',stages,damagedMembers,residualAnalysis:analysis,collapseNodeIds:[]};
    stages.push({members:overloaded});damagedMembers.push(...overloaded);
    const buckled=overloaded.filter(m=>m.failure==='buckling');
    // First yield is damage onset, not rupture. The linear model stops here rather
    // than deleting an intact member and inventing an immediate collapse.
    if(!buckled.length)return {status:'yielded',stages,damagedMembers,residualAnalysis:analysis,collapseNodeIds:[]};
    disabledMemberIds.push(...buckled.map(m=>m.id));
    analysis=analyzeBridge(design,loads,{disabledMemberIds});
  }
  return {status:'unresolved',stages,damagedMembers,residualAnalysis:analysis,collapseNodeIds:[]};
}

export function axleJointLoads(design,position) {
  const deck=(design.deckNodeIds||[]).map(id=>design.nodes.find(n=>n.id===id)).filter(Boolean).sort((a,b)=>a.x-b.x);
  const loads=new Map(),memberPoints=[];
  const points=[...(design.axleLoads||[]).map(a=>({x:position-(a.offset||0),force:a.force})),...(design.staticLoads||[])];
  for(const point of points) {
    const x=point.x;
    if(deck.length<2 || x<deck[0].x || x>deck.at(-1).x) continue;
    let i=0;
    while(i<deck.length-2 && x>deck[i+1].x) i++;
    const ratio=(x-deck[i].x)/(deck[i+1].x-deck[i].x);
    if(design.analysisModel==='frame'){
      const a=deck[i].id,b=deck[i+1].id,m=design.members.find(m=>m.a===a&&m.b===b||m.a===b&&m.b===a);
      if(m)memberPoints.push({memberId:m.id,t:m.a===a?ratio:1-ratio,fy:-point.force});
    }
    for(const [id,share] of [[deck[i].id,1-ratio],[deck[i+1].id,ratio]]) loads.set(id,(loads.get(id)||0)-point.force*share);
  }
  const result=Object.fromEntries([...loads].map(([id,fy])=>[id,{fy}]));
  Object.defineProperty(result,'memberPoints',{value:memberPoints});return result;
}

export function runSweep(design,frameCount=61) {
  const deck=(design.deckNodeIds||[]).map(id=>design.nodes.find(n=>n.id===id)).filter(Boolean).sort((a,b)=>a.x-b.x);
  if(deck.length<2) return {frames:[],firstFailure:null,error:'The bridge needs at least two deck joints.'};
  const staticOnly=!design.axleLoads?.length;
  const count=staticOnly?1:Math.max(2,frameCount);
  const start=deck[0].x,end=deck.at(-1).x+Math.max(0,...(design.axleLoads||[]).map(a=>a.offset||0));
  // Include local axle positions in every beam span regardless of convoy gaps.
  // This is a sampled quasi-static envelope, not an exact influence-line maximum.
  const localPoints=deck.flatMap((n,i)=>i&&design.analysisModel==='frame'?Array.from({length:8},(_,j)=>deck[i-1].x+(n.x-deck[i-1].x)*(j+1)/8):[n.x]);
  const samples=staticOnly?[design.span/2]:[...Array.from({length:count},(_,i)=>start+(end-start)*i/(count-1)),...(design.axleLoads||[]).flatMap(a=>localPoints.map(x=>x+(a.offset||0)))];
  const positions=[...new Set(samples)].sort((a,b)=>a-b);
  const frames=[];
  let firstFailure=null;
  for(let i=0;i<positions.length;i++) {
    const position=positions[i];
    const jointLoads=axleJointLoads(design,position),analysis=analyzeBridge(design,jointLoads);
    const failureCheck=!analysis.ok||!analysis.passed?checkMemberLoss(design,jointLoads,analysis):null;
    frames.push({position,failureCheck,loads:deck.map(n=>({node:n.id,fy:jointLoads[n.id]?.fy||0})),analysis});
    if(!firstFailure && (!analysis.ok || !analysis.passed)) firstFailure={frame:i,member:analysis.members?.find(m=>m.failure)?.id??null};
    if(!analysis.ok||!analysis.passed) break;
  }
  return {frames,firstFailure};
}
