import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dirname),port=Number(process.env.PORT||4173);
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
createServer(async(req,res)=>{try{
 const u=new URL(req.url||'/',`http://localhost:${port}`);let file=resolve(root,'.'+decodeURIComponent(u.pathname));
 if(file!==root&&!file.startsWith(root+sep))throw Error('forbidden');if((await stat(file)).isDirectory())file=resolve(file,'index.html');
 const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
}catch{res.writeHead(404);res.end('Not found');}}).listen(port,()=>console.log('Traffic Sketch Lab: http://localhost:'+port));
