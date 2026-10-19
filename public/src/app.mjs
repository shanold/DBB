import {FORCE_UNITS,toNewtons,fromNewtons,formatForce,loadDescription} from './loads.mjs';
import {classPath,parseClassRoute} from './classRoutes.mjs';
import {createStarter,addJoint,addMember,parseDesign,SECTIONS,findPassThroughs,clearDesign,deleteSelected,selectInBox,moveNodes} from './model.mjs';
import {analyzeBridge,runSweep} from './solver.mjs';
import {visualNodePositions,memberCurvePoints,memberAppearance,failureGeometry,playbackDelay,chooseVisualScale,collapseFraction,waterImpacts,COLLAPSE_DURATION_MS} from './visualPhysics.mjs';
import {instabilityStory} from './instabilityVisual.mjs';
import {createChallenge,parseChallenge,challengeOutcome,parseBudget} from './challenge.mjs';
import {api,setCsrf} from './http.mjs';

const $=id=>document.getElementById(id);
const svg=$('drawing');
const sectionSelect=$('section-select');
for(const [key,section] of Object.entries(SECTIONS)) sectionSelect.add(new Option(section.name,key));
let design;
try { design=parseDesign(localStorage.getItem('bridge-lab-current')||''); }
catch { design=createStarter(); }
let tool='select',selected=new Set(),pending=null,sweep=null,frameIndex=0,timer=null,collapseTimer=null,collapseProgress=0,splashes=[],visualScale=1,drag=null,marquee=null;
const undo=[],redo=[];
const STORAGE='bridge-lab-saves';
const CHALLENGES='bridge-lab-challenges',ACTIVE_CHALLENGE='bridge-lab-active-challenge';
let activeChallenge=null,challengeCompleted=false,currentCost=0,editingChallengeId=null,sharedClass=null,sharedAttemptKey=null;
try {activeChallenge=parseChallenge(localStorage.getItem(ACTIVE_CHALLENGE)||'');}catch{}
let showLoadLabels=localStorage.getItem('bridge-lab-show-loads')==='true';
$('show-load-labels').checked=showLoadLabels;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+Math.round(n).toLocaleString();
const kn=n=>formatForce(n,design.forceUnit||'kN');
const chart={
  left:100,right:900,deckY:375,scaleX:()=>800/design.span,
  x:x=>100+x*800/design.span,
  y:y=>375-y*27,
  pos(clientX,clientY) {
    const p=new DOMPoint(clientX,clientY).matrixTransform(svg.getScreenCTM().inverse());
    return {x:(p.x-100)*design.span/800,y:(375-p.y)/27};
  }
};

function toast(message) {
  const el=$('toast');el.textContent=message;el.classList.add('show');
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.classList.remove('show'),2600);
}
function persist() {
  try {
    localStorage.setItem('bridge-lab-current',JSON.stringify(design));
    if(sharedAttemptKey&&activeChallenge)localStorage.setItem(sharedAttemptKey,JSON.stringify({starter:JSON.stringify(activeChallenge.starter),design}));
  }
  catch { toast('Device storage is full. Export a copy of this bridge.'); }
}
function stopPlayback() { clearTimeout(timer);clearInterval(collapseTimer);timer=null;collapseTimer=null; }
function exitTest() {
  stopPlayback();sweep=null;frameIndex=0;collapseProgress=0;splashes=[];challengeCompleted=false;
  $('reset-test-btn').hidden=true;$('test-btn').innerHTML='<span>▶</span> Test bridge';
  $('timeline').disabled=true;$('position-label').textContent='—';
}
function change(next,{keepSelection=false}={}) {
  if(next===design) return;
  undo.push(structuredClone(design));if(undo.length>60)undo.shift();
  redo.length=0;design=next;pending=null;if(!keepSelection)selected.clear();exitTest();
  $('unsaved-dot').classList.add('visible');persist();render();
}
function setTool(next) {
  tool=next;pending=null;
  document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===next));
  render();
}
function removeTarget(kind,id) {
  if(kind==='node'&&design.deckNodeIds.includes(id)){toast('Deck joints are fixed for this challenge.');return;}
  const key=kind+':'+id;
  change(deleteSelected(design,selected.has(key)&&selected.size>1?selected:new Set([key])));
}
function selectPart(kind,id,additive=false) {
  const key=kind+':'+id;
  if(!additive)selected=new Set([key]);
  else if(selected.has(key))selected.delete(key);
  else selected.add(key);
  render();
}
function currentFrame() {return sweep?.frames[frameIndex];}
function memberData(id) {
  const frame=currentFrame(),check=collapseProgress>0?frame?.failureCheck:null;
  return check?.damagedMembers.find(m=>m.id===id)||
    (check?.residualAnalysis.ok?check.residualAnalysis:frame?.analysis)?.members?.find(m=>m.id===id);
}
function failureMessage(check) {
  if(!check)return '';
  if(check.status==='flexible')return 'The bridge is still standing, but it deflected beyond the classroom serviceability limit.';
  if(check.status==='yielded')return 'Yielding has started, but the member is still continuous and the bridge remains standing.';
  if(check.status==='held')return 'Damaged, but standing: the remaining members support this load in the conservative check.';
  if(check.status==='unstable')return 'The remaining structure has an unrestrained movement. The highlighted part cannot be verified as stable.';
  return 'The remaining structure could not be solved reliably. Collapse has not been inferred.';
}

function renderDrawing() {
  const base=chart.deckY;
  const now=performance.now();
  const surface=x=>422+2.5*Math.sin(x*0.027+now*0.0014)+1.4*Math.sin(x*0.058-now*0.0019);
  const waterPoints=Array.from({length:41},(_,i)=>({x:100+i*20,y:surface(100+i*20)}));
  const waterTop=waterPoints.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const waterShape=`${waterTop} L900 540 L100 540 Z`;
  const foam=waterPoints.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${(p.y+2).toFixed(1)}`).join(' ');
  const splashSvg=splashes.map(({x,at})=>{
    const age=(now-at)/1250;
    if(age<0||age>1)return '';
    const px=chart.x(x),py=surface(px),spread=5+age*37,high=8+14*Math.sin(Math.PI*age),opacity=(1-age).toFixed(2);
    const drops=[-1,0,1].map((side,i)=>`<circle cx="${px+side*(7+age*33)}" cy="${py-high*(1+Math.abs(side)*0.35)+age*age*17}" r="${Math.max(0.5,(2.8-i*0.4)*(1-age*0.65))}"/>`).join('');
    return `<g class="splash" opacity="${opacity}"><ellipse cx="${px}" cy="${py+1}" rx="${spread}" ry="${2+age*3}"/><path d="M${px-spread} ${py} Q${px-spread*.55} ${py-high} ${px} ${py-3} Q${px+spread*.55} ${py-high} ${px+spread} ${py}"/>${drops}</g>`;
  }).join('');
  const grid=[];
  for(let x=0;x<=design.span;x++) grid.push(`<line class="grid-line ${x%5===0?'major':''}" x1="${chart.x(x)}" y1="37" x2="${chart.x(x)}" y2="472"/>`);
  for(let y=-3;y<=12;y++) grid.push(`<line class="grid-line ${y%5===0?'major':''}" x1="65" y1="${chart.y(y)}" x2="935" y2="${chart.y(y)}"/>`);
  const data=currentFrame()?.analysis;
  const failureCheck=currentFrame()?.failureCheck;
  const diagnosis=data?.diagnosis||(collapseProgress>0?failureCheck?.residualAnalysis.diagnosis:null);
  const collapseNodeIds=failureCheck?.collapseNodeIds||[];
  const drawingDisplacements=collapseProgress&&failureCheck?.residualAnalysis.ok?failureCheck.residualAnalysis.displacements:data?.displacements;
  const unstableStory=sweep&&data&&(!data.ok||collapseProgress>0&&failureCheck?.status==='unstable')?instabilityStory(diagnosis||{message:data.error}):null;
  if(unstableStory&&collapseNodeIds.length)unstableStory.nodeIds=collapseNodeIds;
  const broken=design.members.find(m=>m.id===sweep?.firstFailure?.member);
  const failedResult=memberData(broken?.id);
  const brokenA=design.nodes.find(n=>n.id===broken?.a),brokenB=design.nodes.find(n=>n.id===broken?.b);
  const focusNode=design.nodes.find(n=>n.id===diagnosis?.nodeId);
  const breakX=collapseProgress?(brokenA&&brokenB?(brokenA.x+brokenB.x)/2:focusNode?.x??design.span/2):null;
  const positions=visualNodePositions(design.nodes,drawingDisplacements,visualScale,{
    span:design.span,supportIds:design.supports.map(s=>s.node),breakX,collapse:collapseProgress,collapseNodeIds,supports:design.supports
  });
  const screen=n=>({x:chart.x(n.x),y:chart.y(n.y)});
  const line=(a,b,classes)=>`<line class="${classes}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  const members=design.members.map(m=>{
    const a=positions.get(m.a),b=positions.get(m.b);
    if(!a||!b)return '';
    const result=memberData(m.id),appearance=memberAppearance(design.sections[m.section]);
    const category=result?(result.failure?(result.failure==='yield'?'failed yielded':'failed'):result.governing==='bending'?'bending':Math.abs(result.force)<1000?'':result.force<0?'compression':'tension'):'';
    const chosen=selected.has('member:'+m.id)?'selected':'';
    const critical=result?.utilization>=0.85&&!result.failure?'critical':'';
    const path=memberCurvePoints(a,b,result,visualScale).map((p,i)=>`${i?'L':'M'}${chart.x(p.x)} ${chart.y(p.y)}`).join(' ');
    let displayPath=path;
    if(result?.failure&&collapseProgress>0) {
      const shape=failureGeometry(a,b,result?.force??0,collapseProgress,result.failure);
      if(shape.kind==='buckling')displayPath=`M${chart.x(shape.a.x)} ${chart.y(shape.a.y)} Q${chart.x(shape.control.x)} ${chart.y(shape.control.y)} ${chart.x(shape.b.x)} ${chart.y(shape.b.y)}`;
    }
    const style=`--member-width:${appearance.width}px;--force-width:${Math.max(3,appearance.width*.46)}px`;
    const material=`<path class="member-material ${appearance.material} ${chosen}" style="${style}" d="${displayPath}"/>`;
    const force=result?`<path class="member-line ${category} ${critical}" style="${style}" d="${displayPath}"/>`:'';
    return `<g data-member="${m.id}">${material}${force}${line(screen(a),screen(b),'member-hit')}</g>`;
  }).join('');
  const nodes=design.nodes.map(n=>{
    const point=positions.get(n.id),x=chart.x(point.x),y=chart.y(point.y);
    return `<g data-node="${n.id}"><circle class="joint ${pending===n.id?'pending':''} ${design.deckNodeIds.includes(n.id)?'fixed':''} ${selected.has('node:'+n.id)?'selected':''}" cx="${x}" cy="${y}" r="6"/>${design.analysisModel==='frame'&&n.connection==='hinge'?`<circle class="hinge-ring" cx="${x}" cy="${y}" r="10"/>`: ""}<circle class="joint-hit" cx="${x}" cy="${y}" r="16"/></g>`;
  }).join('');
  const loadLabels=showLoadLabels&&data?.ok?design.members.map(m=>{
    const a=positions.get(m.a),b=positions.get(m.b),result=memberData(m.id);
    if(!a||!b||!result)return '';
    const p=screen(a),q=screen(b),dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy)||1;
    const x=(p.x+q.x)/2-dy/length*13,y=(p.y+q.y)/2+dx/length*13;
    return `<text class="member-load-label ${result.utilization>=1?'over':''}" x="${x}" y="${y}" text-anchor="middle">${result.failure&&collapseProgress>0?(result.failure==='yield'?'YIELD':'BUCKLED'):Math.round(result.utilization*100)+'%'}</text>`;
  }).join(''):'';
  const passMarkers=[...new Map(findPassThroughs(design).map(p=>[p.nodeId,p])).values()].map(p=>{
    const n=positions.get(p.nodeId),x=chart.x(n.x),y=chart.y(n.y);
    const active=diagnosis?.kind==='pass_through'&&diagnosis.nodeId===p.nodeId||selected.has('member:'+p.memberId);
    return `<g class="pass-marker ${active?'active':''}" pointer-events="none"><circle cx="${x}" cy="${y}" r="13"/><text x="${x+15}" y="${y-13}">!</text><title>Member ${p.memberId+1} crosses Joint ${p.nodeId+1} without connecting</title></g>`;
  }).join('');
  const affected=unstableStory?.nodeIds.map(id=>positions.get(id)).filter(Boolean)||[];
  const focus=affected.length?{x:affected.reduce((sum,n)=>sum+n.x,0)/affected.length,
    y:affected.reduce((sum,n)=>sum+n.y,0)/affected.length}:{x:design.span/2,y:0};
  const focusPoint=screen(focus);
  const calloutX=Math.min(540,Math.max(110,focusPoint.x-175));
  const motionArrows=['mechanism','frame_mechanism'].includes(diagnosis?.kind)?(diagnosis.mode||[]).filter(d=>Math.hypot(d.x,d.y)>0.18).map(d=>{
    const node=positions.get(d.node);if(!node)return '';
    const x=chart.x(node.x),y=chart.y(node.y);
    return `<path class="free-motion" d="M${x-17*d.x} ${y+17*d.y} L${x+17*d.x} ${y-17*d.y}"/>`;
  }).join(''):'';
  const missingChords=(diagnosis?.missingPairs||[]).map(([a,b])=>{
    const from=positions.get(a),to=positions.get(b);
    return from&&to?line(screen(from),screen(to),'missing-chord'):'';
  }).join('');
  const diagnosticSvg=unstableStory?`<g class="failure-diagnosis">
    ${missingChords}
    ${affected.map(n=>`<circle class="failure-halo" cx="${chart.x(n.x)}" cy="${chart.y(n.y)}" r="20"/>`).join('')}
    ${motionArrows}
    <path class="failure-leader" d="M${calloutX+175} 132 L${focusPoint.x} ${focusPoint.y}"/>
    <rect class="failure-callout" x="${calloutX}" y="57" width="350" height="75" rx="8"/>
    <text class="failure-title" x="${calloutX+15}" y="78">${esc(unstableStory.title)}</text>
    <text class="failure-cause" x="${calloutX+15}" y="99">${esc(unstableStory.cause)}</text>
    <text class="failure-fix" x="${calloutX+15}" y="119">${esc(unstableStory.fix)}</text>
  </g>`:'';
  const deckNodes=[];
  const deckIds=[...design.deckNodeIds].sort((a,b)=>design.nodes.find(n=>n.id===a).x-design.nodes.find(n=>n.id===b).x);
  for(let i=1;i<deckIds.length;i++){
    const a=deckIds[i-1],b=deckIds[i],m=design.members.find(m=>m.a===a&&m.b===b||m.a===b&&m.b===a);
    let points=m?memberCurvePoints(positions.get(m.a),positions.get(m.b),memberData(m.id),visualScale):[positions.get(a),positions.get(b)];
    if(m&&m.a!==a)points.reverse();deckNodes.push(...(i>1?points.slice(1):points));
  }
  const deckPath=deckNodes.map((n,i)=>`${i?'L':'M'}${chart.x(n.x)} ${chart.y(n.y)}`).join(' ');
  const deckTop=deckNodes.map((n,i)=>`${i?'L':'M'}${chart.x(n.x)} ${chart.y(n.y)-6}`).join(' ');
  const truck=currentFrame()&&design.axleLoads.length?Array.from({length:design.loadCase?.truckCount||1},(_,i)=>truckSvg(currentFrame().position-i*(design.loadCase?.truckSpacing||10),deckNodes)).join(''):'';
  const staticMarkers=(design.staticLoads||[]).map(load=>{const x=chart.x(load.x);const near=deckNodes.reduce((best,n)=>Math.abs(n.x-load.x)<Math.abs(best.x-load.x)?n:best,deckNodes[0]);const y=chart.y(near?.y||0)-12;return `<g class="static-load-marker"><path d="M${x} ${y-68} V${y-8} m-7 -10 l7 10 l7 -10"/><text x="${x+12}" y="${y-51}">${esc(kn(load.force))}</text></g>`;}).join('');
  const supportA=design.nodes.find(n=>n.id===design.supports[0]?.node);
  const supportB=design.nodes.find(n=>n.id===design.supports[1]?.node);
  const supports=[supportA,supportB].map((n,i)=>n?`<g transform="translate(${chart.x(n.x)},${chart.y(n.y)+8})"><path class="support" d="M0 0 L-12 17 L12 17 Z"/>${i?'<circle cx="-6" cy="21" r="3" fill="#8b714f"/><circle cx="6" cy="21" r="3" fill="#8b714f"/>':''}</g>`:'').join('');
  svg.innerHTML=`<defs><marker id="arrow" markerWidth="5" markerHeight="5" refX="2" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5" fill="#e8ab65"/></marker><marker id="motion-tip" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 Z" fill="#cf6448"/></marker><linearGradient id="river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8dc5ce"/><stop offset="0.26" stop-color="#5d9fab"/><stop offset="1" stop-color="#275d71"/></linearGradient><linearGradient id="water-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9faf4" stop-opacity=".45"/><stop offset="1" stop-color="#2e798b" stop-opacity=".05"/></linearGradient></defs>
    <rect width="1000" height="540" fill="#f8faf7"/><g pointer-events="none">${grid.join('')}
    <path class="terrain" d="M0 410 Q65 403 100 375 L100 540 L0 540Z M900 375 Q950 404 1000 410 L1000 540 L900 540Z"/>
    <path class="water" d="${waterShape}"/><path class="water-depth" d="M100 469 Q290 451 495 474 T900 457 L900 540 L100 540Z"/><path class="water-foam" d="${foam}"/><path class="water-glint" d="M160 441 q22 -4 46 0 m100 28 q32 -5 66 0 m218 -30 q24 -4 47 0 m75 32 q29 -5 58 0"/>
    <text class="svg-label" x="18" y="53">+12 m</text><text class="svg-label" x="26" y="${base-9}">0 m</text>
    <path class="deck" d="${deckPath}"/><path class="deck-top" d="${deckTop}"/>
    <text class="measurement" x="100" y="468">0 m</text><text class="measurement" x="875" y="468">${design.span} m</text>
    ${supports}</g><g>${members}</g><g>${nodes}</g><g>${passMarkers}</g>
    ${marquee?`<rect class="selection-box" x="${Math.min(chart.x(marquee.start.x),chart.x(marquee.now.x))}" y="${Math.min(chart.y(marquee.start.y),chart.y(marquee.now.y))}" width="${Math.abs(chart.x(marquee.now.x)-chart.x(marquee.start.x))}" height="${Math.abs(chart.y(marquee.now.y)-chart.y(marquee.start.y))}"/>`:''}
    <g pointer-events="none">${loadLabels}${truck}${staticMarkers}<path class="water-front" d="${waterShape}"/>${splashSvg}
    ${collapseProgress>0&&collapseProgress<0.33&&breakX!==null&&data?.ok?`<text class="impact-text" x="${chart.x(breakX)}" y="${chart.y(6)-collapseProgress*15}" text-anchor="middle">${failedResult?.failure==='buckling'?'BUCKLE!':'YIELD!'}</text>`:''}${diagnosticSvg}</g>`;
  const danger=sweep&&data?.ok&&data.maxUtilization>=0.85;
  $('board-status').textContent=collapseProgress&&failureCheck?.status==='flexible'?'TOO FLEXIBLE · BRIDGE STANDING':
    collapseProgress&&failureCheck?.status==='yielded'?'YIELDING · BRIDGE STANDING':
    collapseProgress&&failureCheck?.status==='held'?'DAMAGED · STILL STANDING':
    collapseProgress&&failureCheck?.status==='unresolved'?'CHECK INCONCLUSIVE':
    unstableStory?`${unstableStory.title} · ${collapseProgress?'ILLUSTRATED MOTION':'UNSTABLE'}`:
    collapseProgress?(collapseProgress<1?`ILLUSTRATED COLLAPSE · ${(collapseProgress*COLLAPSE_DURATION_MS/1000).toFixed(1)} / 5.0 S`:'MEMBER-LOSS CHECK · UNSTABLE'):
    danger?'CRITICAL LOAD':sweep?(design.axleLoads.length?'TRUCK CROSSING':'STATIC LOAD'):'EDIT MODE';
  document.querySelector('.board-led').classList.toggle('critical',!!danger);
  document.querySelector('.board-right').textContent=sweep?'DEFLECTION ×1 · UNMAGNIFIED':'SIDE ELEVATION · 1 m GRID';
  $('board-help').textContent=collapseProgress&&failureCheck?.damagedMembers.length?failureMessage(failureCheck):unstableStory?`No member snapped. ${unstableStory.cause} ${unstableStory.fix}`:
    sweep&&diagnosis?.kind==='pass_through'?diagnosis.message:
    sweep&&!data?.ok?'The truss has no stable load path. Check the analysis panel.':
    sweep?(data?.ok&&data.maxUtilization>=0.75?'High stress — will it hold?':design.axleLoads.length?'Watch the bridge flex as the trucks cross':'A stationary load is applied at the center'):(
    tool==='joint'?'Click anywhere on the grid to place a joint':
    tool==='member'?(pending===null?'Click the first joint, then the second':'Now click another joint to connect them'):
    tool==='erase'?'Click a member or free joint to remove it':'Shift-click or drag a box to select several parts');
  $('zoom-label').textContent=design.span+' m span';
}
function truckSvg(position,deckNodes) {
  const rear=chart.x(position-4),front=chart.x(position);
  const deckY=x=>{
    if(deckNodes.length<2)return chart.deckY;
    const clamped=Math.max(deckNodes[0].x,Math.min(deckNodes.at(-1).x,x));
    let i=0;while(i<deckNodes.length-2&&clamped>deckNodes[i+1].x)i++;
    const a=deckNodes[i],b=deckNodes[i+1],t=(clamped-a.x)/(b.x-a.x);
    return chart.y(a.y+(b.y-a.y)*t);
  };
  // Keep the illustration compact; its front wheel follows the truck position.
  const width=Math.min(195,chart.scaleX()*7.3),height=width/3;
  const angle=Math.atan2(deckY(position)-deckY(position-4),front-rear)*180/Math.PI;
  return `<g transform="translate(${front},${deckY(position)-6}) rotate(${angle})"><image href="/assets/tractor-trailer.png" x="${-width*0.946}" y="${-height*0.825}" width="${width}" height="${height}"/></g>`;
}
function renderStats() {
  let weight=0,cost=0;
  for(const m of design.members) {
    const a=design.nodes.find(n=>n.id===m.a),b=design.nodes.find(n=>n.id===m.b),s=design.sections[m.section];
    if(a&&b&&s) {const mass=Math.hypot(a.x-b.x,a.y-b.y)*s.area*s.density;weight+=mass;cost+=mass*s.cost;}
  }
  currentCost=cost;$('cost-stat').textContent=money(cost);$('weight-stat').textContent=Math.round(weight).toLocaleString()+' kg';
  $('joints-stat').textContent=design.nodes.length;$('members-stat').textContent=design.members.length;
}
function explanation(m) {
  if(!m) return '';
  if(m.failure==='buckling') return 'This long member buckled in compression. Try a heavier tube, a shorter member, or a new diagonal for bracing.';
  if(m.failure==='yield'&&m.governing==='bending')return 'Bending stress reached the yield limit. The beam begins permanent deformation; it has not snapped. Try a deeper profile, a shorter unsupported span, or triangulation.';
  if(m.failure==='yield') return `This member reached its ${m.force<0?'compressive':'tensile'} yield limit: permanent deformation begins. This does not mean it snapped. Try a larger profile or another load path.`;
  if(m.governing==='bending')return 'Bending governs this member. Its top and bottom carry different stresses; the capacity percentage includes bending, axial force and a conservative shear check.';
  if(m.force<0) return 'This member is in compression. Its capacity is limited by yielding or buckling, whichever happens first.';
  return 'This member is in tension. Compare its applied force with its material yield capacity.';
}
function renderInspector() {
  const holder=$('inspector');
  const passes=findPassThroughs(design);
  const memberIds=[...selected].filter(key=>key.startsWith('member:')).map(key=>Number(key.slice(7)));
  const jointIds=[...selected].filter(key=>key.startsWith('node:')).map(key=>Number(key.slice(5)));
  if(!selected.size) {
    holder.innerHTML='<div class="empty-inspector"><span>⌁</span><b>Select parts</b><p>Click a member to inspect it. Shift-click or drag a box to select several parts.</p></div>';
    return;
  }
  if(selected.size>1) {
    const count=memberIds.length+' members · '+jointIds.length+' joints';
    const missed=passes.filter(p=>memberIds.includes(p.memberId)||jointIds.includes(p.nodeId)).length;
    holder.innerHTML=`<h3 class="inspect-title">${selected.size} parts selected</h3><div class="inspect-sub">${count}</div><div class="inspect-explain">Choose a profile to update all selected members. Drag a selected free joint to move selected joints together, or use Delete selected.</div>${missed?`<div class="inspect-explain connection-warning">${missed} selected pass-through connection${missed===1?' is':'s are'} open. The line and joint do not transfer force.</div>`:''}`;
    if(memberIds.length)sectionSelect.value=design.members.find(m=>m.id===memberIds[0])?.section||'standard';
    return;
  }
  if(jointIds.length) {
    const node=design.nodes.find(n=>n.id===jointIds[0]);
    if(!node){selected.clear();renderInspector();return;}
    holder.innerHTML=`<h3 class="inspect-title">Joint ${node.id+1}</h3><div class="inspect-sub">${design.deckNodeIds.includes(node.id)?'Deck joint (position locked in editor)':'Free joint'}</div>
      <div class="inspect-row"><span>Connection</span><b>${design.analysisModel==='truss'||node.connection==='hinge'?'Hinge':'Rigid'}</b></div>
      <div class="inspect-row"><span>Position</span><b>${node.x} m, ${node.y} m</b></div>
      <div class="inspect-row"><span>Connected members</span><b>${design.members.filter(m=>m.a===node.id||m.b===node.id).length}</b></div>
      ${passes.some(p=>p.nodeId===node.id)?'<div class="inspect-explain connection-warning">A member passes through this joint without connecting. Only member endpoints transfer force.</div>':''}`;
    return;
  }
  const m=design.members.find(m=>m.id===memberIds[0]);
  if(!m){selected.clear();renderInspector();return;}
  sectionSelect.value=m.section;
  const r=memberData(m.id),section=design.sections[m.section];
  const a=design.nodes.find(n=>n.id===m.a),b=design.nodes.find(n=>n.id===m.b);
  const length=Math.hypot(a.x-b.x,a.y-b.y);
  const skipped=passes.filter(p=>p.memberId===m.id);
  holder.innerHTML=`<h3 class="inspect-title">Member ${m.id+1}</h3><div class="inspect-sub">${esc(section?.name||m.section)} · ${length.toFixed(2)} m</div>
    <div class="inspect-row"><span>Behavior</span><b>${r?(r.governing|| (r.force<0?'Compression':'Tension')):'Run test to see'}</b></div>
    <div class="inspect-row"><span>Axial force</span><b>${r?kn(Math.abs(r.force)):'—'}</b></div>
    <div class="inspect-row"><span>Axial-only capacity</span><b>${r?kn(r.capacity):'—'}</b></div>
    <div class="inspect-row"><span>Utilization</span><b class="${r?.failure?'danger':''}">${r?(r.utilization*100).toFixed(0)+'%':'—'}</b></div>
    <div class="inspect-row"><span>Capacity / demand</span><b>${r&&r.utilization>0?(1/r.utilization).toFixed(2):'—'}</b></div>
    <div class="inspect-row"><span>Axial stress</span><b>${r?(r.stress/1e6).toFixed(1)+' MPa':'—'}</b></div>
    ${r?.maxMoment!==undefined?`<div class="inspect-row"><span>Axial stress demand</span><b>${(Math.abs(r.force)/(section.area*section.yield)*100).toFixed(0)}%</b></div><div class="inspect-row"><span>Bending stress demand</span><b>${(r.bendingRatio*100).toFixed(0)}%</b></div><div class="inspect-row"><span>Shear stress demand</span><b>${(Math.sqrt(3)*2*r.maxShear/(section.area*section.yield)*100).toFixed(0)}%</b></div><div class="inspect-row"><span>Peak bending moment</span><b>${kn(r.maxMoment)}·m</b></div><div class="inspect-row"><span>Peak normal stress</span><b>${(r.maxStress/1e6).toFixed(1)} MPa</b></div><div class="inspect-row"><span>Peak shear force</span><b>${kn(r.maxShear)}</b></div>`:''}
    <div class="inspect-row"><span>Ideal Euler load</span><b>${r?kn(r.eulerCapacity):'—'}</b></div>
    ${skipped.length?`<div class="inspect-explain connection-warning">This member passes through Joint ${skipped.map(p=>p.nodeId+1).join(', ')} without connecting. Draw separate members ending at those joints if you want a connection.</div>`:''}
    ${r?`<div class="inspect-explain">${explanation(r)}${collapseProgress&&currentFrame()?.failureCheck?(r.failure==='buckling'?' Values shown are at the buckling event; its stiffness is removed only for the conservative alternate-path check.':r.failure==='yield'?' Values shown are at first yield; the member remains continuous.':currentFrame().failureCheck.residualAnalysis.ok?' Values shown are after redistribution.':' Values shown are before damage; no stable residual solution exists.'):''}</div>`:''}`;
}
function renderAnalysis() {
  const card=$('analysis-card'),heading=$('result-heading'),copy=$('result-copy'),sub=$('test-subtitle'),title=$('test-title');
  card.classList.remove('passed','failed');
  if(!sweep) {
    heading.textContent='Awaiting test';copy.textContent='Run the load test to see forces, weak points, and a pass or fail result.';
    $('analysis-caption').textContent='Your design at a glance';$('util-meter').style.width='0%';$('util-label').textContent='—';
    title.textContent='Ready when you are';sub.textContent=loadDescription(design)||'Run the load test.';
    $('explain-text').textContent='Yielded members turn amber; buckled members turn red. A dashed ring with ! means a member passes through a joint without connecting.';
    return;
  }
  const frame=currentFrame(),result=frame?.analysis;
  $('analysis-caption').textContent='Live force analysis';
  $('position-label').textContent=frame?(design.axleLoads.length?frame.position.toFixed(1)+' m':'CENTER'):'—';
  $('timeline-title').textContent=design.axleLoads.length?'LEAD TRUCK POSITION':'STATIONARY LOAD';
  if(!result?.ok) {
    const diagnosis=result?.diagnosis;
    const story=instabilityStory(diagnosis||{message:result?.error});
    card.classList.add('failed');heading.textContent=story.title;
    copy.textContent=`No member was identified as broken. ${diagnosis?`${diagnosis.message} ${diagnosis.advice}`:story.cause+' '+story.fix}`;
    title.textContent=design.axleLoads.length?'Failed before crossing':'Failed under stationary load';sub.textContent=story.cause;
    $('explain-text').textContent=(diagnosis?.advice||story.fix)+' Motion is illustrative, not a prediction of the fall.';
    $('util-meter').style.width='0%';$('util-label').textContent='—';return;
  }
  const check=frame.failureCheck,failed=result.members.find(m=>m.failure);
  if(result.largeDisplacement&&!failed){
    card.classList.add('failed');heading.textContent='Excessive deflection';
    title.textContent='Bridge standing · too flexible';sub.textContent='The bridge bent beyond the classroom serviceability limit.';
    copy.textContent='No member broke and no collapse is inferred. Use a stiffer profile, shorter spans, or more bracing to reduce movement.';
    $('explain-text').textContent='The test stopped because member displacement exceeded 5% of member length or a joint rotated more than 0.1 radian. These are model-validity limits, not fracture thresholds.';
    $('util-meter').style.width='0%';$('util-label').textContent='Deflection limit';return;
  }
  const pct=result.maxUtilization*100;
  $('util-meter').style.width=Math.min(100,pct)+'%';$('util-label').textContent=Math.round(pct)+'% at first damage';
  if(failed) {
    card.classList.add('failed');heading.textContent=check?.status==='yielded'?'Yielding started':check?.status==='held'?'Damaged, still standing':check?.status==='unstable'?'Load path lost':'Capacity exceeded';
    const chain=check?.stages.map((stage,i)=>`${i+1}. ${stage.members.map(m=>`Member ${m.id+1} ${m.failure==='buckling'?'reaches its buckling limit':m.governing==='bending'?'yields in bending':'yields'} (${Math.round(m.utilization*100)}%)`).join('; ')}`).join(' → ');
    copy.textContent=chain||`Member ${failed.id+1} exceeded its capacity.`;
    title.textContent=check?.status==='yielded'?'Bridge bent but remains standing':check?.status==='held'?'Alternate load path holds':'Capacity exceeded at '+(design.axleLoads.length?frame.position.toFixed(1)+' m':'the center load');
    sub.textContent=failureMessage(check)+' The test stops at first damage.';
    $('explain-text').textContent=(check?.status==='yielded'?
      'Yield is the start of permanent deformation, not a snap. The member stays continuous and the bridge remains standing, but damage still fails the challenge.':
      'Conservative buckling check: each buckled member loses its stiffness, then the same load is recalculated. Real buckled members may retain some capacity. '+(check?.status==='held'?'Damage still fails the challenge.':'Any fall shown is illustrative; the check does not predict collapse dynamics.'))+
      (check?.status==='unstable'?' '+(check.residualAnalysis.diagnosis?.message||''):'');
  } else {
    card.classList.add('passed');heading.textContent='Holding steady';
    $('util-label').textContent=Math.round(pct)+'% max';
    copy.textContent=`Peak member use here: ${Math.round(pct)}% of capacity.`;
    title.textContent=sweep.firstFailure?(pct>=65?'Holding... keep watching':'Load test in progress'):design.axleLoads.length?'Design passes the load test':'Stationary load supported';
    sub.textContent=sweep.firstFailure?'The weakest point may be farther along.':design.axleLoads.length?'All trucks can cross without exceeding member capacity.':'The bridge carries the stationary center load.';
    $('explain-text').textContent=result.ignoredNodeIds?.length?`Unused joints ${result.ignoredNodeIds.map(id=>id+1).join(', ')} carry no load and are ignored. Connect them if you want them to help support the bridge.`:(design.analysisModel==='frame'?'Road-bearing frame: axles load members between joints, so utilization combines axial, bending, and shear demand.':'Ideal truss: the roadway transfers loads to joints and members carry axial force only.')+' Moving loads are quasi-static.';
  }
}
function renderChallenge() {
  const banner=$('challenge-banner');
  if(!activeChallenge){banner.hidden=true;return;}
  banner.hidden=false;
  const outcome=challengeOutcome(activeChallenge,sweep,currentCost,challengeCompleted);
  banner.innerHTML=`<div><span class="eyebrow">ACTIVE CHALLENGE</span><h2>${esc(activeChallenge.title)}</h2><p>${esc(activeChallenge.instructions)||'Build a bridge that carries the truck.'}</p><small>${activeChallenge.starter.span} m span · ${esc(loadDescription(activeChallenge.starter))}${activeChallenge.maxCost===null?' · no budget':` · budget ${money(activeChallenge.maxCost)}`}</small><strong class="challenge-result ${outcome.status}" role="status">${esc(outcome.message)}</strong></div><button class="secondary" id="leave-challenge">Leave challenge</button>`;
  $('leave-challenge').onclick=()=>{if(sharedClass){location.href=classPath(sharedClass);return;}leaveChallenge();render();toast('Challenge closed. Your design remains on the board.');};
}
function render() {
  $('bridge-name').value=design.name;
  $('analysis-model').value=design.analysisModel||'truss';$('analysis-model').disabled=!!sweep;
  $('model-hint').textContent=design.analysisModel==='frame'?'Axles load deck members between joints. Utilization combines axial force, bending, and shear.':'The roadway transfers axle loads to neighboring joints. Members carry axial force only.';
  const chosenNodes=design.nodes.filter(n=>selected.has('node:'+n.id));
  $('joint-connection').disabled=!!sweep||design.analysisModel!=='frame'||!chosenNodes.length;
  const kinds=new Set(chosenNodes.map(n=>n.connection||'rigid'));
  $('joint-connection').value=kinds.size>1?'mixed':([...kinds][0]||'rigid');
  $('connection-hint').textContent=design.analysisModel==='truss'?'Truss mode treats every connection as a hinge.':'Select joints to change rigid connections to hinges. New joints are rigid.';
  renderDrawing();renderStats();renderAnalysis();renderInspector();renderChallenge();
  $('undo-btn').disabled=!undo.length;$('redo-btn').disabled=!redo.length;
  $('delete-selected-btn').disabled=!selected.size||!!sweep;
  $('selection-count').textContent=selected.size?'('+selected.size+')':'';
}

svg.addEventListener('pointerdown',event=>{
  const target=event.target.closest('[data-node],[data-member]');
  const nodeEl=target?.closest('[data-node]'),memberEl=target?.closest('[data-member]');
  const nodeId=nodeEl?Number(nodeEl.dataset.node):null,memberId=memberEl?Number(memberEl.dataset.member):null;
  if(sweep) {
    if(memberId!==null)selectPart('member',memberId,event.shiftKey);
    else if(nodeId!==null)selectPart('node',nodeId,event.shiftKey);
    return;
  }
  if(tool==='erase') {
    if(memberId!==null)removeTarget('member',memberId);else if(nodeId!==null)removeTarget('node',nodeId);
    return;
  }
  if(tool==='select') {
    if(memberId!==null){selectPart('member',memberId,event.shiftKey);return;}
    if(nodeId!==null) {
      if(event.shiftKey){selectPart('node',nodeId,true);return;}
      if(!selected.has('node:'+nodeId))selected=new Set(['node:'+nodeId]);
      const ids=[...selected].filter(key=>key.startsWith('node:')).map(key=>Number(key.slice(5))).filter(id=>!design.deckNodeIds.includes(id));
      if(ids.length) {
        drag={ids,baseDesign:design,startModel:chart.pos(event.clientX,event.clientY),startX:event.clientX,startY:event.clientY,moved:false};
        svg.setPointerCapture(event.pointerId);
      }
      render();return;
    }
    const start=chart.pos(event.clientX,event.clientY);
    marquee={start,now:start,startX:event.clientX,startY:event.clientY,additive:event.shiftKey,base:new Set(selected)};
    svg.setPointerCapture(event.pointerId);
    return;
  }
  let id=nodeId;
  if(id===null) {
    const p=chart.pos(event.clientX,event.clientY);
    if(p.x<0||p.x>design.span||p.y<0||p.y>12)return;
    const added=addJoint(design,p.x,p.y);
    if(added.design!==design) {
      const first=pending;
      change(added.design);
      if(tool==='member')pending=first;
    }
    id=added.node.id;
  }
  if(tool==='joint')return;
  if(tool==='member') {
    if(pending===null)pending=id;
    else if(pending===id)pending=null;
    else {
      const next=addMember(design,pending,id,sectionSelect.value);
      pending=null;change(next);
    }
    render();
  }
});
svg.addEventListener('pointermove',event=>{
  if(marquee){marquee.now=chart.pos(event.clientX,event.clientY);renderDrawing();return;}
  if(!drag)return;
  if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<4&&!drag.moved)return;
  const pos=chart.pos(event.clientX,event.clientY);
  const dx=Math.round(pos.x-drag.startModel.x),dy=Math.round(pos.y-drag.startModel.y);
  const next=moveNodes(drag.baseDesign,drag.ids,dx,dy);
  if(next===drag.baseDesign&&!drag.moved)return;
  if(!drag.moved) {undo.push(structuredClone(design));redo.length=0;drag.moved=true;}
  design=next;render();
});
svg.addEventListener('pointerup',event=>{
  if(marquee){
    const moved=Math.hypot(event.clientX-marquee.startX,event.clientY-marquee.startY)>5;
    if(moved){
      const hits=selectInBox(design,{x1:marquee.start.x,y1:marquee.start.y,x2:marquee.now.x,y2:marquee.now.y});
      selected=marquee.additive?new Set([...marquee.base,...hits]):hits;
    } else if(!marquee.additive)selected.clear();
    marquee=null;render();
  }
  if(drag?.moved){
    $('unsaved-dot').classList.add('visible');persist();render();
  }
  drag=null;
});
svg.addEventListener('pointercancel',()=>{drag=null;marquee=null;render();});

document.querySelectorAll('.tool').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
$('analysis-model').onchange=()=>{change({...design,analysisModel:$('analysis-model').value,deckLineLoad:design.deckLineLoad??design.deckDeadLoad*(design.deckNodeIds.length-1)/design.span});};
$('joint-connection').onchange=()=>{const connection=$('joint-connection').value;if(connection==='mixed')return;
  change({...design,nodes:design.nodes.map(n=>selected.has('node:'+n.id)?{...n,connection}:n)},{keepSelection:true});
};
sectionSelect.addEventListener('change',()=>{
  const ids=new Set([...selected].filter(key=>key.startsWith('member:')).map(key=>Number(key.slice(7))));
  if(!ids.size)return;
  change({...design,members:design.members.map(m=>ids.has(m.id)?{...m,section:sectionSelect.value}:m)},{keepSelection:true});
  render();
});
$('delete-selected-btn').addEventListener('click',()=>{
  if(selected.size&&!sweep)change(deleteSelected(design,selected));
});
$('clear-btn').addEventListener('click',()=>{
  change(clearDesign(design));
  setTool('joint');toast('Design cleared. Deck joints and supports remain.');
});
$('bridge-name').addEventListener('change',event=>change({...design,name:event.target.value.trim()||'Untitled bridge'}));
$('undo-btn').addEventListener('click',()=>historyStep(undo,redo));
$('redo-btn').addEventListener('click',()=>historyStep(redo,undo));
function historyStep(from,to) {
  if(!from.length)return;
  to.push(structuredClone(design));design=from.pop();selected.clear();pending=null;exitTest();persist();render();
}
document.addEventListener('keydown',event=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&tool==='select'&&!sweep){
    event.preventDefault();
    selected=new Set([...design.nodes.map(n=>'node:'+n.id),...design.members.map(m=>'member:'+m.id)]);
    render();return;
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z') {event.preventDefault();historyStep(event.shiftKey?redo:undo,event.shiftKey?undo:redo);return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y') {event.preventDefault();historyStep(redo,undo);return;}
  if(event.key==='Escape'){pending=null;selected.clear();render();return;}
  if((event.key==='Delete'||event.key==='Backspace')&&selected.size&&!sweep){change(deleteSelected(design,selected));return;}
  const key={v:'select',j:'joint',m:'member',e:'erase'}[event.key.toLowerCase()];
  if(key)setTool(key);
});
$('mirror-btn').addEventListener('click',()=>{
  const original=structuredClone(design);let result=design;
  const mapping=new Map();
  for(const node of original.nodes) {
    const added=addJoint(result,original.span-node.x,node.y);
    result=added.design;mapping.set(node.id,added.node.id);
    if(!original.nodes.some(n=>n.id===added.node.id)&&node.connection)result={...result,nodes:result.nodes.map(n=>n.id===added.node.id?{...n,connection:node.connection}:n)};
  }
  for(const member of original.members) result=addMember(result,mapping.get(member.a),mapping.get(member.b),member.section);
  if(result===design)toast('The design is already mirrored.');
  else change(result);
});

function showFrame(index) {
  frameIndex=Math.max(0,Math.min(sweep.frames.length-1,index));
  collapseProgress=0;splashes=[];
  $('timeline').value=frameIndex;render();
}
function beginFailure() {
  stopPlayback();
  challengeCompleted=true;renderChallenge();
  const check=currentFrame()?.failureCheck;
  const diagnosis=currentFrame()?.analysis?.diagnosis;
  selected=sweep.firstFailure.member!==null?new Set(['member:'+sweep.firstFailure.member]):
    diagnosis?.memberId!==undefined?new Set(['member:'+diagnosis.memberId]):
    diagnosis?.nodeId!==null&&diagnosis?.nodeId!==undefined?new Set(['node:'+diagnosis.nodeId]):new Set();
  if(check?.status!=='unstable'||!check.collapseNodeIds.length||window.matchMedia('(prefers-reduced-motion: reduce)').matches) {collapseProgress=1;render();return;}
  const started=performance.now();
  const supports=design.supports.map(s=>s.node);
  const broken=design.members.find(m=>m.id===sweep.firstFailure.member);
  const focusX=broken?(design.nodes.find(n=>n.id===broken.a).x+design.nodes.find(n=>n.id===broken.b).x)/2:
    design.nodes.find(n=>n.id===diagnosis?.nodeId)?.x??design.span/2;
  const positionsAt=progress=>visualNodePositions(design.nodes,currentFrame()?.analysis?.displacements,visualScale,{
    span:design.span,supportIds:supports,breakX:focusX,collapse:progress,collapseNodeIds:check.collapseNodeIds,supports:design.supports
  });
  collapseProgress=0.001;render();
  collapseTimer=setInterval(()=>{
    const previous=positionsAt(collapseProgress);
    collapseProgress=collapseFraction(performance.now()-started);
    const current=positionsAt(collapseProgress);
    const now=performance.now();
    for(const impact of waterImpacts(previous,current,design.nodes.map(n=>n.id),supports))
      if(!splashes.some(s=>Math.abs(chart.x(s.x)-chart.x(impact.x))<22&&now-s.at<180))splashes.push({x:impact.x,at:now});
    splashes=splashes.filter(s=>now-s.at<1250);
    renderDrawing();
    if(collapseProgress>=1){clearInterval(collapseTimer);collapseTimer=null;render();}
  },40);
}
function play() {
  if(!sweep?.frames.length)return;
  stopPlayback();challengeCompleted=false;frameIndex=0;showFrame(0);
  $('test-btn').innerHTML='<span>▶</span> Replay';
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showFrame(sweep.firstFailure?.frame??sweep.frames.length-1);challengeCompleted=true;if(sweep.firstFailure)beginFailure();else renderChallenge();return;
  }
  if(sweep.firstFailure?.frame===0){beginFailure();return;}
  const advance=()=>{
    const next=frameIndex+1;
    if(next>=sweep.frames.length){stopPlayback();challengeCompleted=true;renderChallenge();return;}
    showFrame(next);
    if(sweep.firstFailure?.frame===next){beginFailure();return;}
    timer=setTimeout(advance,playbackDelay(sweep.frames[next].analysis?.maxUtilization||0));
  };
  timer=setTimeout(advance,450);
}
$('test-btn').addEventListener('click',()=>{
  if(!sweep) {
    sweep=runSweep(design,71);
    if(!sweep.frames.length){toast(sweep.error);sweep=null;return;}
    visualScale=chooseVisualScale(sweep.frames);
    $('reset-test-btn').hidden=false;
    $('timeline').max=String(sweep.frames.length-1);
    $('timeline').disabled=sweep.frames.length===1;
    setTool('select');
  }
  play();
});
$('timeline').addEventListener('input',event=>{stopPlayback();showFrame(Number(event.target.value));});
$('reset-test-btn').addEventListener('click',()=>{exitTest();selected.clear();render();});

$('new-btn').addEventListener('click',()=>{
  leaveChallenge();
  const starter=createStarter();
  change({...starter,name:'Untitled bridge',nodes:starter.nodes.filter(n=>n.id<=6),members:starter.members.filter(m=>m.a<=6&&m.b<=6)});
  setTool('joint');toast('Blank challenge ready. Build above the fixed deck.');
});
$('save-btn').addEventListener('click',()=>{
  try {
    const saves=JSON.parse(localStorage.getItem(STORAGE)||'[]');
    const name=design.name.trim()||'Untitled bridge';
    const existing=saves.findIndex(s=>s.name===name);
    const item={name,updated:new Date().toISOString(),design:structuredClone(design)};
    if(existing>=0)saves.splice(existing,1);
    saves.unshift(item);localStorage.setItem(STORAGE,JSON.stringify(saves.slice(0,25)));
    $('unsaved-dot').classList.remove('visible');toast('Saved “'+name+'” on this device.');
  } catch {toast('Unable to save here. Export a JSON copy instead.');}
});
$('load-btn').addEventListener('click',()=>{
  let saves=[];
  try{saves=JSON.parse(localStorage.getItem(STORAGE)||'[]');}catch{}
  $('saved-list').innerHTML=saves.length?saves.map((s,i)=>`<button class="saved-item" data-save="${i}"><b>${esc(s.name)}</b><small>${new Date(s.updated).toLocaleString()} · ${s.design.members.length} members</small></button>`).join(''):'<p class="saved-empty">No saved bridges yet. Use Save to keep a design on this device, or Import a JSON file.</p>';
  $('open-dialog').showModal();
  $('saved-list').onclick=event=>{
    const button=event.target.closest('[data-save]');
    if(!button)return;
    try{leaveChallenge();change(parseDesign(JSON.stringify(saves[Number(button.dataset.save)].design)));$('open-dialog').close();toast('Bridge opened.');}
    catch{toast('This saved design could not be opened.');}
  };
});
$('close-dialog').addEventListener('click',()=>$('open-dialog').close());
$('export-btn').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(design,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=(design.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'bridge')+'.bridge.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import-btn').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>1000000)throw Error('Bridge file is too large.');
    const imported=parseDesign(await file.text());leaveChallenge();change(imported);toast('Bridge imported.');
  } catch(error){toast(error.message||'Could not import this bridge.');}
  event.target.value='';
});
function leaveChallenge() {
  activeChallenge=null;challengeCompleted=false;
  try{localStorage.removeItem(ACTIVE_CHALLENGE);}catch{}
  $('challenge-banner').hidden=true;
}
function savedChallenges() {
  try {
    const list=JSON.parse(localStorage.getItem(CHALLENGES)||'[]');
    return Array.isArray(list)?list.map(c=>{try{return parseChallenge(JSON.stringify(c));}catch{return null;}}).filter(Boolean):[];
  }catch{return [];}
}
function saveChallenge(challenge) {
  const list=savedChallenges().filter(c=>c.title!==challenge.title);
  list.unshift(challenge);
  localStorage.setItem(CHALLENGES,JSON.stringify(list.slice(0,25)));
}
function downloadChallenge(challenge) {
  const blob=new Blob([JSON.stringify(challenge,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=(challenge.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'challenge')+'.challenge.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function startChallenge(challenge) {
  activeChallenge=challenge;challengeCompleted=false;
  try{localStorage.setItem(ACTIVE_CHALLENGE,JSON.stringify(challenge));}catch{toast('Device storage is full. Export this challenge to keep it.');}
  change(structuredClone(challenge.starter));
  undo.length=0;redo.length=0;render();
  setTool('select');$('challenges-dialog').close();toast('Challenge started. Build and test your solution.');
}
function teacherChallenge() {
  const form=$('teacher-form');
  const budget=form.elements.maxCost;
  budget.setCustomValidity('');
  let maxCost;
  try{maxCost=parseBudget(budget.value);}catch(error){budget.setCustomValidity(error.message);}
  if(!form.reportValidity())return null;
  const values=new FormData(form);
  const forceKn=(name,fallback)=>Number((toNewtons(form.elements[name].value||fallback,form.elements.forceUnit.value)/1000).toPrecision(10));
  return createChallenge({title:values.get('title'),instructions:values.get('instructions'),maxCost,
    frontKn:forceKn('frontKn',40),rearKn:forceKn('rearKn',120),starter:design,
    analysisModel:values.get('analysisModel'),roadKnPerM:forceKn('roadKnPerM',1.6),span:Number(values.get('span')),forceUnit:values.get('forceUnit'),loadType:values.get('loadType'),truckCount:Number(form.elements.truckCount.value),truckSpacing:Number(form.elements.truckSpacing.value),centerKn:forceKn('centerKn',160)});
}
let teacherUnit='kN';
function syncLoadFields(){
  const form=$('teacher-form'),mode=form.elements.loadType.value;
  $('truck-settings').hidden=mode==='static';$('truck-settings').disabled=mode==='static';
  $('static-settings').hidden=mode==='moving';$('static-settings').disabled=mode==='moving';
  document.querySelectorAll('[data-force-unit]').forEach(el=>el.textContent=form.elements.forceUnit.value);
}
$('load-type').onchange=syncLoadFields;
$('force-unit').onchange=()=>{const form=$('teacher-form'),unit=form.elements.forceUnit.value;for(const name of ['frontKn','rearKn','centerKn','roadKnPerM']){const field=form.elements[name];if(field.value!=='')field.value=Number(fromNewtons(toNewtons(field.value,teacherUnit),unit).toPrecision(12));}teacherUnit=unit;syncLoadFields();};
$('teacher-form').elements.maxCost.addEventListener('input',event=>event.target.setCustomValidity(''));
$('show-load-labels').addEventListener('change',event=>{
  showLoadLabels=event.target.checked;
  try{localStorage.setItem('bridge-lab-show-loads',String(showLoadLabels));}catch{}
  renderDrawing();
});
$('teacher-btn').addEventListener('click',()=>{
  const form=$('teacher-form');
  if(activeChallenge){form.elements.title.value=activeChallenge.title;form.elements.instructions.value=activeChallenge.instructions;form.elements.maxCost.value=activeChallenge.maxCost??'';}
  const config=design.loadCase||{type:'moving',truckCount:1,truckSpacing:10};
  teacherUnit=design.forceUnit||'kN';form.elements.forceUnit.value=teacherUnit;
  form.elements.analysisModel.value=design.analysisModel||'truss';form.elements.roadKnPerM.value=Number(fromNewtons(design.deckLineLoad??design.deckDeadLoad*(design.deckNodeIds.length-1)/design.span,teacherUnit).toPrecision(12));
  form.elements.span.value=design.span;form.elements.loadType.value=config.type;
  form.elements.truckCount.value=config.truckCount;form.elements.truckSpacing.value=config.truckSpacing;
  form.elements.frontKn.value=Number(fromNewtons(design.axleLoads?.[0]?.force||40000,teacherUnit).toPrecision(12));
  form.elements.rearKn.value=Number(fromNewtons(design.axleLoads?.[1]?.force||120000,teacherUnit).toPrecision(12));
  form.elements.centerKn.value=Number(fromNewtons(design.staticLoads?.[0]?.force||160000,teacherUnit).toPrecision(12));
  form.elements.maxCost.setCustomValidity('');syncLoadFields();
  $('teacher-dialog').showModal();
});
$('close-teacher').onclick=()=>$('teacher-dialog').close();
$('teacher-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.target.querySelector('[type=submit]');button.disabled=true;
  try{
    const challenge=teacherChallenge();if(!challenge)return;
    const me=await api('/api/me');if(!me.user){toast('Sign in through Classroom to save and assign challenges.');return;}setCsrf(me.csrf);
    const result=await api(editingChallengeId?'/api/challenges/'+editingChallengeId:'/api/challenges',{method:editingChallengeId?'PUT':'POST',data:{challenge}});
    editingChallengeId=result.id;activeChallenge=challenge;change(structuredClone(challenge.starter));$('teacher-dialog').close();toast('Challenge saved. Open Classroom to assign it and copy its URL.');
  }catch(error){toast(error.message||'Could not save challenge.');}
  finally{button.disabled=false;}
});
$('save-local-challenge').onclick=()=>{
  try{const challenge=teacherChallenge();if(!challenge)return;saveChallenge(challenge);activeChallenge=challenge;change(structuredClone(challenge.starter));$('teacher-dialog').close();toast('Challenge saved on this device.');}
  catch(error){toast(error.message||'Could not save challenge.');}
};
$('export-teacher').onclick=()=>{
  try{const challenge=teacherChallenge();if(challenge){downloadChallenge(challenge);toast('Challenge JSON exported.');}}
  catch(error){toast(error.message||'Could not export challenge.');}
};
$('challenges-btn').onclick=()=>{
  const list=savedChallenges();
  $('challenge-list').innerHTML=list.length?list.map((c,i)=>`<div class="challenge-item"><div><b>${esc(c.title)}</b><small>${esc(c.instructions||'Build a bridge and test it.')} · ${c.maxCost===null?'No budget':money(c.maxCost)+' budget'}</small></div><button class="primary" data-start="${i}">Start</button><button class="secondary" data-export="${i}">Export</button></div>`).join(''):'<p class="saved-empty">No saved challenges yet. Create one in Teacher Mode or import a challenge JSON file.</p>';
  $('challenge-list').onclick=event=>{
    const start=event.target.closest('[data-start]'),exportButton=event.target.closest('[data-export]');
    if(start)startChallenge(list[Number(start.dataset.start)]);
    if(exportButton)downloadChallenge(list[Number(exportButton.dataset.export)]);
  };
  $('challenges-dialog').showModal();
};
$('close-challenges').onclick=()=>$('challenges-dialog').close();
$('import-challenge').onclick=()=>$('challenge-file').click();
$('challenge-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>1000000)throw Error('Challenge file is too large.');
    const challenge=parseChallenge(await file.text());
    saveChallenge(challenge);startChallenge(challenge);
  }catch(error){toast(error.message||'Could not import challenge.');}
  event.target.value='';
});
render();
async function loadRoute(){
  const route=parseClassRoute(location.pathname),params=new URLSearchParams(location.search);
  if(route?.challengeSlug){
    $('route-dialog').showModal();
    try{
      const result=await api('/api/public/classes/'+encodeURIComponent(route.classSlug)+'/'+encodeURIComponent(route.challengeSlug));
      const challenge=parseChallenge(JSON.stringify(result.challenge));sharedClass=result.classSlug;
      sharedAttemptKey='bridge-lab-attempt:'+result.classSlug+':'+result.slug;
      let attempt=challenge.starter;
      try{const saved=JSON.parse(localStorage.getItem(sharedAttemptKey)||'null');if(saved?.starter===JSON.stringify(challenge.starter))attempt=parseDesign(JSON.stringify(saved.design));}catch{}
      activeChallenge=challenge;challengeCompleted=false;
      try{localStorage.setItem(ACTIVE_CHALLENGE,JSON.stringify(challenge));}catch{}
      change(structuredClone(attempt));undo.length=0;redo.length=0;setTool('select');$('route-dialog').close();
      document.title=challenge.title+' · '+result.className+' · Bridge Lab';
    }catch(error){$('route-title').textContent='Unable to open challenge';$('route-copy').textContent=error.message;}
  }else if(params.has('author')||params.has('edit')){
    try{
      const me=await api('/api/me');if(!me.user){location.href='/classroom';return;}setCsrf(me.csrf);
      if(params.has('edit')){
        const dashboard=await api('/api/dashboard'),goal=dashboard.challenges.find(c=>c.id===params.get('edit'));
        if(!goal)throw Error('Challenge not found, or it belongs to another teacher.');
        editingChallengeId=goal.id;activeChallenge=goal.data;change(structuredClone(goal.data.starter));
      }else{leaveChallenge();$('teacher-form').reset();render();}
      $('teacher-btn').click();
    }catch(error){toast(error.message);}
  }
}
loadRoute();


// Optional browser agent controls. They use the same design and test actions as the UI.
if(document.modelContext?.registerTool) {
  const register=tool=>Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});
  register({
    name:'read_bridge_design',title:'Read bridge design',
    description:'Read the current bridge name, span, joint count, and member count.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true},
    execute:()=>({name:design.name,spanMetres:design.span,joints:design.nodes.length,members:design.members.length})
  });
  register({
    name:'start_bridge_test',title:'Start bridge test',
    description:'Start the same moving-truck test as the Test bridge button and report the first predicted failure.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:false},
    execute:()=>{
      $('test-btn').click();
      return {started:!!sweep,firstFailure:sweep?.firstFailure??null,frames:sweep?.frames.length??0};
    }
  });
}
