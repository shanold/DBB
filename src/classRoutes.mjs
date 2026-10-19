export const RESERVED_CLASS_NAMES=new Set(['class','classroom','api','src','assets','admin','signin-with-chatgpt','signout-with-chatgpt','callback']);
export const readableClassName=slug=>slug.replace(/-[a-f0-9]{8}$/,'');
export const readableChallengeName=slug=>slug.replace(/-[a-f0-9]{6}$/,'');
export function classPath(classSlug,challengeSlug=null){
  return '/'+encodeURIComponent(readableClassName(classSlug))+(challengeSlug?'/'+encodeURIComponent(readableChallengeName(challengeSlug)):'');
}
export function parseClassRoute(pathname){
  const parts=pathname.split('/').filter(Boolean);
  if((parts.length===2||parts.length===3)&&/^[a-z0-9][a-z0-9-]*$/.test(parts[0])&&/^[a-f0-9]{8}$/.test(parts[1]))
    return {classSlug:parts[0]+'-'+parts[1],challengeSlug:parts[2]||null,legacy:true};
  if(parts[0]==='class'&&(parts.length===2||parts.length===3))
    return {classSlug:parts[1],challengeSlug:parts[2]||null,legacy:true};
  if((parts.length===1||parts.length===2)&&!RESERVED_CLASS_NAMES.has(parts[0])&&parts.every(p=>/^[a-z0-9][a-z0-9-]*$/.test(p)))
    return {classSlug:parts[0],challengeSlug:parts[1]||null,legacy:false};
  return null;
}
