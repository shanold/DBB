import {readFile,writeFile,mkdir,rm,cp,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
const assets={};
async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){const relative=prefix+'/'+entry.name;if(entry.isDirectory())await walk(dir+'/'+entry.name,relative);else{const data=await readFile(dir+'/'+entry.name);const type=entry.name.endsWith('.html')?'text/html; charset=utf-8':entry.name.endsWith('.css')?'text/css':entry.name.endsWith('.mjs')?'text/javascript':entry.name.endsWith('.png')?'image/png':entry.name.endsWith('.svg')?'image/svg+xml':'application/octet-stream';assets[relative]={body:data.toString('base64'),type};}}}
await walk('public');
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/assets.mjs','export default '+JSON.stringify(assets)+';');
await rm('dist',{recursive:true,force:true});await cp('public','dist',{recursive:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['server/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built Worker and classroom assets.');
