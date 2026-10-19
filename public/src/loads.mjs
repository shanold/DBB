export const FORCE_UNITS={N:{label:'Newtons (N)',factor:1},kN:{label:'Kilonewtons (kN)',factor:1000},lbf:{label:'Pounds-force (lbf)',factor:4.4482216152605},kip:{label:'Kips (1,000 lbf)',factor:4448.2216152605},kgf:{label:'Kilograms-force (kgf)',factor:9.80665}};
export function toNewtons(value,unit='kN'){
  if(!FORCE_UNITS[unit]||!Number.isFinite(Number(value)))throw Error('Choose a valid force and unit.');
  return Number(value)*FORCE_UNITS[unit].factor;
}
export function fromNewtons(value,unit='kN'){return value/(FORCE_UNITS[unit]?.factor||1000);}
export function formatForce(value,unit='kN'){return fromNewtons(value,unit).toLocaleString(undefined,{maximumFractionDigits:2})+' '+unit;}
export function loadDescription(design){
  const unit=design.forceUnit||'kN',config=design.loadCase,staticLoad=design.staticLoads?.reduce((sum,l)=>sum+l.force,0)||0;
  const truckCount=config?.truckCount||1;
  const moving=design.axleLoads?.length?`${truckCount} truck${truckCount===1?'':'s'}${truckCount>1?' · '+config.truckSpacing+' m front-to-front':''} · front ${formatForce(design.axleLoads[0].force,unit)} · rear ${formatForce(design.axleLoads[1]?.force||0,unit)}`:'';
  return [moving,staticLoad?`Center load ${formatForce(staticLoad,unit)}`:''].filter(Boolean).join(' · ');
}
