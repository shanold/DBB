// 2D Euler–Bernoulli frame elements. SI units; rotations and moments are CCW.
// Connections are rigid unless an endpoint joint explicitly releases rotation.
const zeros=n=>Array.from({length:n},()=>Array(n).fill(0));
const mul=(A,x)=>A.map(row=>row.reduce((s,v,i)=>s+v*x[i],0));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const G=9.81;

// Diagonal equilibration prevents force/rotation units from setting the rank tolerance.
function linearSolve(K,F) {
  const n=F.length,scale=K.map((r,i)=>1/Math.sqrt(Math.max(Math.abs(r[i]),1e-30)));
  const A=K.map((row,i)=>row.map((v,j)=>v*scale[i]*scale[j]).concat(F[i]*scale[i]));
  const pivots=[];
  for(let c=0;c<n;c++) {
    const r=pivots.length;let p=r;
    for(let j=r+1;j<n;j++)if(Math.abs(A[j][c])>Math.abs(A[p][c]))p=j;
    if(Math.abs(A[p][c])<1e-10)continue;
    [A[r],A[p]]=[A[p],A[r]];
    const div=A[r][c];for(let j=c;j<=n;j++)A[r][j]/=div;
    for(let i=r+1;i<n;i++){const f=A[i][c];for(let j=c;j<=n;j++)A[i][j]-=f*A[r][j];}
    pivots.push(c);if(pivots.length===n)break;
  }
  const back=x=>{for(let r=pivots.length-1;r>=0;r--)x[pivots[r]]-=A[r].slice(pivots[r]+1,n).reduce((s,v,j)=>s+v*x[pivots[r]+1+j],0);return x.map((v,i)=>v*scale[i]);};
  if(pivots.length<n){const set=new Set(pivots);return {modes:Array.from({length:n},(_,i)=>i).filter(i=>!set.has(i)).map(i=>{const x=Array(n).fill(0);x[i]=1;return back(x);})};}
  const x=Array(n).fill(0);pivots.forEach((p,i)=>x[p]=A[i][n]);return {x:back(x)};
}
function stiffness(E,A,I,L) {
 const a=E*A/L,b=12*E*I/L**3,c=6*E*I/L**2,d=4*E*I/L,e=2*E*I/L;
 return [[a,0,0,-a,0,0],[0,b,c,0,-b,c],[0,c,d,0,-c,e],[-a,0,0,a,0,0],[0,-b,-c,0,b,-c],[0,c,e,0,-c,d]];
}
function release(k,p,released) {
 const keep=[0,1,2,3,4,5].filter(i=>!released.includes(i));
 if(!released.length)return {k,p,recover:u=>u};
 const inv=released.length===1?[[1/k[released[0]][released[0]]]]:(()=>{
  const [a,b]=released,det=k[a][a]*k[b][b]-k[a][b]*k[b][a];return [[k[b][b]/det,-k[a][b]/det],[-k[b][a]/det,k[a][a]/det]];
 })();
 const ke=zeros(6),pe=Array(6).fill(0);
 for(const i of keep){const row=mul(inv,released.map(r=>k[r][i]));
  pe[i]=p[i]-dot(row,released.map(r=>p[r]));
  for(const j of keep)ke[i][j]=k[i][j]-dot(row,released.map(r=>k[r][j]));
 }
 return {k:ke,p:pe,recover:u=>{const v=[...u],vR=mul(inv,released.map(r=>p[r]-keep.reduce((s,j)=>s+k[r][j]*u[j],0)));released.forEach((r,i)=>v[r]=vR[i]);return v;}};
}
// A new unbraced joint must not shorten the ideal buckling length.
function bucklingGroups(pieces,nodes,supports) {
 const active=pieces.filter(e=>!e.removed),at=new Map(),groups=new Map();
 for(const e of active)for(const id of [e.m.a,e.m.b]){if(!at.has(id))at.set(id,[]);at.get(id).push(e);}
 const transverse=(id,e)=>supports.some(s=>s.node===id&&((s.x&&Math.abs(e.s)>1e-8)||(s.y&&Math.abs(e.c)>1e-8)));
 for(const start of active){
  if(groups.has(start.m.id))continue;
  const chain=new Set([start]),ends=[];
  for(const initial of [start.m.a,start.m.b]){
   let id=initial,e=start;
   while(true){
    const incident=at.get(id)||[],node=nodes.find(n=>n.id===id);
    const next=incident.find(other=>other!==e);
    if(transverse(id,e)||node.connection==='hinge'||incident.length!==2||!next||Math.abs(e.c*next.s-e.s*next.c)>1e-8||chain.has(next)){
     ends.push({id,e,free:incident.length===1&&!transverse(id,e)});break;
    }
    chain.add(next);id=next.m.a===id?next.m.b:next.m.a;e=next;
   }
  }
  const length=[...chain].reduce((sum,e)=>sum+e.L,0),factor=ends.some(end=>end.free)?2:1;
  const capacity=Math.PI**2*Math.min(...[...chain].map(e=>e.EI))/(factor*length)**2;
  const group={capacity,length:factor*length,ids:[...chain].map(e=>e.m.id)};
  for(const e of chain)groups.set(e.m.id,group);
 }
 return groups;
}
export function analyzeFrame(design,externalLoads={}, {disabledMemberIds=[]}={}) {
 const nodes=design.nodes||[],index=new Map(nodes.map((n,i)=>[n.id,i])),n=3*nodes.length;
 const bad=error=>({ok:false,error,collapseNodeIds:[]});
 if(!n||index.size!==nodes.length)return bad('Joint geometry is missing or duplicated.');
 const disabled=new Set(disabledMemberIds),K=zeros(n),F=Array(n).fill(0),pieces=[];
 const deck=(design.deckNodeIds||[]).map(id=>nodes[index.get(id)]).sort((a,b)=>(a?.x||0)-(b?.x||0));
 if(deck.some(d=>!d)||new Set(deck.map(d=>d.x)).size!==deck.length)return bad('Deck joints must have distinct horizontal positions.');
 const roadByMember=new Map();
 const road=Number.isFinite(design.deckLineLoad)?design.deckLineLoad:null;
 if(road!==null&&road<0)return bad('Road weight cannot be negative.');
 if(road!==null){for(let i=1;i<deck.length;i++){
   const a=deck[i-1],b=deck[i],member=design.members.find(m=>m.a===a.id&&m.b===b.id||m.a===b.id&&m.b===a.id);
   if(member)roadByMember.set(member.id,road*(b.x-a.x));
   else {F[3*index.get(a.id)+1]-=road*(b.x-a.x)/2;F[3*index.get(b.id)+1]-=road*(b.x-a.x)/2;}
 }}else for(const d of deck)F[3*index.get(d.id)+1]-=design.deckDeadLoad||0;
 for(const [id,load] of Object.entries(externalLoads)){
  const i=index.get(+id);if(i===undefined||['fx','fy','moment'].some(k=>!Number.isFinite(load[k]??0)))return bad('Loads must refer to valid joints and be finite.');
  F[3*i]+=load.fx||0;F[3*i+1]+=load.fy||0;F[3*i+2]+=load.moment||0;
 }
 let weight=0,cost=0;
 for(const m of design.members||[]) {
  const ia=index.get(m.a),ib=index.get(m.b),a=nodes[ia],b=nodes[ib],sec=design.sections[m.section];
  if(!a||!b||!sec||['area','inertia','E','yield'].some(k=>!Number.isFinite(sec[k])||sec[k]<=0))return bad('A member has invalid geometry or material properties.');
  const L=Math.hypot(b.x-a.x,b.y-a.y);if(!Number.isFinite(L)||L<.01)return bad('A member has zero or invalid length.');
  const c=(b.x-a.x)/L,s=(b.y-a.y)/L,EA=sec.E*sec.area,EI=sec.E*sec.inertia;
  const mass=L*sec.area*(sec.density||0);weight+=mass;cost+=mass*(sec.cost||0);
  const dead=mass*G+(roadByMember.get(m.id)||0),qy=-dead/L*c,qx=-dead/L*s;
  const dofs=[3*ia,3*ia+1,3*ia+2,3*ib,3*ib+1,3*ib+2];
  const T=[[c,s,0,0,0,0],[-s,c,0,0,0,0],[0,0,1,0,0,0],[0,0,0,c,s,0],[0,0,0,-s,c,0],[0,0,0,0,0,1]];
  const points=(externalLoads.memberPoints||[]).filter(p=>p.memberId===m.id).map(p=>({x:p.t*L,px:p.fy*s,py:p.fy*c,fy:p.fy,t:p.t}));
  if(disabled.has(m.id)) {F[3*ia+1]-=dead/2;F[3*ib+1]-=dead/2;pieces.push({m,L,sec,removed:true});continue;}
  const k=stiffness(sec.E,sec.area,sec.inertia,L),p=[qx*L/2,qy*L/2,qy*L*L/12,qx*L/2,qy*L/2,-qy*L*L/12];
  for(const pt of points){const t=pt.t;
   // Replace the road distributor's linear nodal shares with this beam's consistent load.
   F[3*ia+1]-=pt.fy*(1-t);F[3*ib+1]-=pt.fy*t;
   p[0]+=pt.px*(1-t);p[3]+=pt.px*t;
   p[1]+=pt.py*(1-3*t*t+2*t**3);p[2]+=pt.py*L*(t-2*t*t+t**3);
   p[4]+=pt.py*(3*t*t-2*t**3);p[5]+=pt.py*L*(-t*t+t**3);
  }
  const released=[];if(a.connection==='hinge')released.push(2);if(b.connection==='hinge')released.push(5);
  const condensed=release(k,p,released);
  for(let i=0;i<6;i++){
   F[dofs[i]]+=T.reduce((sum,row,r)=>sum+row[i]*condensed.p[r],0);
   for(let j=0;j<6;j++)for(let r=0;r<6;r++)if(T[r][i])for(let t=0;t<6;t++)if(T[t][j])K[dofs[i]][dofs[j]]+=T[r][i]*condensed.k[r][t]*T[t][j];
  }
  pieces.push({m,ia,ib,L,c,s,sec,EA,EI,k,p,T,dofs,qx,qy,points,condensed});
 }
 if(!F.every(Number.isFinite)||!K.every(row=>row.every(Number.isFinite)))return bad('The geometry or loads exceed the numeric range.');
 const fixed=new Set();
 for(const support of design.supports||[]){const i=index.get(support.node);if(i===undefined)return bad('A support refers to a missing joint.');if(support.x)fixed.add(3*i);if(support.y)fixed.add(3*i+1);if(support.rotation)fixed.add(3*i+2);}
 const connected=new Set(pieces.filter(p=>!p.removed).flatMap(p=>[p.m.a,p.m.b]));
 const ignoredNodeIds=nodes.filter((node,i)=>!connected.has(node.id)&&!design.deckNodeIds?.includes(node.id)&&!F[3*i]&&!F[3*i+1]&&!F[3*i+2]&&!design.supports?.some(s=>s.node===node.id)).map(n=>n.id);
 nodes.forEach((node,i)=>{if(ignoredNodeIds.includes(node.id)){fixed.add(3*i);fixed.add(3*i+1);}if(Math.abs(K[3*i+2][3*i+2])<1e-15&&!F[3*i+2])fixed.add(3*i+2);});
 const free=Array.from({length:n},(_,i)=>i).filter(i=>!fixed.has(i));
 const solution=linearSolve(free.map(i=>free.map(j=>K[i][j])),free.map(i=>F[i]));
 if(!solution.x){
  const modes=solution.modes.map(v=>{const full=Array(n).fill(0);free.forEach((d,i)=>full[d]=v[i]);const norm=Math.max(1e-30,...nodes.map((_,i)=>Math.hypot(full[3*i],full[3*i+1])));return nodes.map((node,i)=>({node:node.id,x:full[3*i]/norm,y:full[3*i+1]/norm}));});
  const ids=[...new Set(modes.flatMap(v=>v.filter(d=>Math.hypot(d.x,d.y)>1e-7).map(d=>d.node)))].filter(id=>!design.supports?.some(s=>s.node===id));
  const unsupported=nodes.filter(node=>ids.includes(node.id)&&!connected.has(node.id));
  const empty=!design.members.length;
  const diagnosis={kind:empty?'empty':unsupported.length?'isolated_joint':'frame_mechanism',nodeId:unsupported[0]?.id??null,affectedNodeIds:ids,mode:modes[0],
   message:empty?'There are no structural members to support the road.':unsupported.length?`Joint ${unsupported[0].id+1} carries load but has no connected member.`:'These joints can move even after beam bending and joint connections are included.',
   advice:empty?'Add structural members connecting the road to both supports.':unsupported.length?'End a member at this joint to carry its load. A line passing through is not connected.':'Check hinges and supports, or brace the highlighted part.'};
  return {ok:false,error:diagnosis.message,diagnosis,collapseNodeIds:ids.filter(id=>!design.supports?.some(s=>s.node===id&&s.y)),ignoredNodeIds};
 }
 const u=Array(n).fill(0);free.forEach((d,i)=>u[d]=solution.x[i]);
 const buckling=bucklingGroups(pieces,nodes,design.supports||[]);
 const members=pieces.map(e=>{
  const {m,L,sec}=e,depth=sec.depth||Math.sqrt((12*sec.inertia/sec.area+sec.area)/2),Z=sec.inertia/(depth/2),yieldCapacity=sec.area*sec.yield,eulerCapacity=buckling.get(m.id)?.capacity??Math.PI**2*sec.E*sec.inertia/L**2;
  if(e.removed)return {id:m.id,a:m.a,b:m.b,section:m.section,length:L,force:0,stress:0,capacity:yieldCapacity,yieldCapacity,eulerCapacity,compressionCapacity:Math.min(yieldCapacity,eulerCapacity),utilization:0,failure:null,removed:true};
  const local=e.condensed.recover(mul(e.T,e.dofs.map(i=>u[i]))),ends=mul(e.k,local).map((v,i)=>v-e.p[i]);
  const values=x=>({N:-ends[0]-e.qx*x-e.points.filter(p=>x>=p.x).reduce((v,p)=>v+p.px,0),V:ends[1]+e.qy*x+e.points.filter(p=>x>=p.x).reduce((v,p)=>v+p.py,0),M:-ends[2]+ends[1]*x+e.qy*x*x/2+e.points.filter(p=>x>=p.x).reduce((v,p)=>v+p.py*(x-p.x),0)});
  const samples=Array.from({length:17},(_,i)=>L*i/16).concat(e.points.flatMap(p=>[Math.max(0,p.x-L*1e-10),p.x]));
  const bounds=[0,...e.points.map(p=>p.x),L].sort((a,b)=>a-b);
  if(Math.abs(e.qy)>1e-14)for(let i=1;i<bounds.length;i++){
   const lo=bounds[i-1],hi=bounds[i],v=values((lo+hi)/2).V-e.qy*(lo+hi)/2;
   for(const target of [0,e.qx*Z/sec.area,-e.qx*Z/sec.area]){const x=(target-v)/e.qy;if(x>lo&&x<hi)samples.push(x);}
  }
  let maxMoment=0,maxShear=0,maxStress=0,maxCompression=0,maxAxial=0;
  for(const x of samples){const v=values(x);maxMoment=Math.max(maxMoment,Math.abs(v.M));maxShear=Math.max(maxShear,Math.abs(v.V));maxStress=Math.max(maxStress,Math.abs(v.N)/sec.area+Math.abs(v.M)/Z);maxCompression=Math.max(maxCompression,-v.N);maxAxial=Math.max(maxAxial,Math.abs(v.N));}
  const bendingRatio=maxMoment/(Z*sec.yield),shearStress=2*maxShear/sec.area;
  // Conservative envelope: peak normal stress combined with average web shear.
  const yieldRatio=Math.hypot(maxStress,Math.sqrt(3)*shearStress)/sec.yield;
  const buckleRatio=maxCompression>1e-6?maxCompression/eulerCapacity+bendingRatio:0;
  const utilization=Math.max(yieldRatio,buckleRatio),force=values(L/2).N;
  const failure=utilization>1?(buckleRatio>yieldRatio&&eulerCapacity<yieldCapacity?'buckling':'yield'):null;
  const governing=failure==='buckling'?'compression':bendingRatio>=maxAxial/yieldCapacity&&bendingRatio>=Math.sqrt(3)*shearStress/sec.yield?'bending':Math.sqrt(3)*shearStress>maxStress?'shear':force<0?'compression':'tension';
  const curve=Array.from({length:17},(_,i)=>{const t=i/16,x=t*L;
   const axial=local[0]+(-ends[0]*x-e.qx*x*x/2-e.points.filter(p=>x>=p.x).reduce((v,p)=>v+p.px*(x-p.x),0))/e.EA;
   const transverse=local[1]+local[2]*x+(-ends[2]*x*x/2+ends[1]*x**3/6+e.qy*x**4/24+e.points.filter(p=>x>=p.x).reduce((v,p)=>v+p.py*(x-p.x)**3/6,0))/e.EI;
   return {t,dx:e.c*axial-e.s*transverse,dy:e.s*axial+e.c*transverse};
  });
  return {id:m.id,a:m.a,b:m.b,section:m.section,length:L,force,stress:force/sec.area,maxStress,maxMoment,maxShear,governing,bendingRatio,yieldRatio,buckleRatio,
   maxCompression,bucklingLength:buckling.get(m.id)?.length,yieldCapacity,eulerCapacity,compressionCapacity:Math.min(yieldCapacity,eulerCapacity),capacity:force<0?Math.min(yieldCapacity,eulerCapacity):yieldCapacity,
   utilization,failure,curve,removed:false};
 });
 // A stepped unbraced chain uses its weakest EI and greatest compression.
 for(const group of new Set(buckling.values())){
  const chain=members.filter(m=>group.ids.includes(m.id));
  const compression=Math.max(0,...chain.map(m=>m.maxCompression||0));
  for(const m of chain){
   m.buckleRatio=compression>1e-6?compression/group.capacity+m.bendingRatio:0;
   m.utilization=Math.max(m.yieldRatio,m.buckleRatio);
   m.failure=m.utilization>1?(m.buckleRatio>m.yieldRatio&&m.eulerCapacity<m.yieldCapacity?'buckling':'yield'):null;
   if(m.failure==='buckling')m.governing='compression';
  }
 }
 const reactions=(design.supports||[]).map(s=>{const i=index.get(s.node),reaction=axis=>dot(K[3*i+axis],u)-F[3*i+axis];return {node:s.node,fx:s.x?reaction(0):0,fy:s.y?reaction(1):0,moment:s.rotation?reaction(2):0};});
 const displacements=nodes.map((node,i)=>({node:node.id,x:u[3*i],y:u[3*i+1],rotation:u[3*i+2]}));
 const largeDisplacement=members.some(m=>m.curve?.some(p=>Math.hypot(p.dx,p.dy)>m.length*.05))||displacements.some(d=>Math.abs(d.rotation)>.1);
 return {ok:true,members,reactions,displacements,weight,cost,ignoredNodeIds,maxUtilization:Math.max(0,...members.map(m=>m.utilization)),passed:members.every(m=>!m.failure)&&!largeDisplacement,largeDisplacement,model:'frame'};
}
