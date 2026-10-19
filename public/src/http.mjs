let csrf=null;
export function setCsrf(value){csrf=value;}
export async function api(path,{method='GET',data}={}){
  const response=await fetch(path,{method,credentials:'same-origin',headers:{...(data?{'Content-Type':'application/json'}:{}),...(csrf&&method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
  let result;try{result=await response.json();}catch{throw Error('Classroom server is unavailable. Try again in a moment.');}
  if(!response.ok)throw Error(result.error||'Unable to complete that action.');return result;
}
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
