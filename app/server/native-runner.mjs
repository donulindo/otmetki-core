// Server runtime file, deliberately outside the JS bundle. Python is an installed executable, not a bundle asset.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
export function nativeExtract(path,mime,outputDir,renderPage){
  return new Promise((resolveResult,reject)=>{
    const python=resolve(process.env.DOCUMENT_PYTHON||'.venv/bin/python');
    const args=[resolve('server/extract.py'),'--input',path,'--output-dir',outputDir,'--mime',mime];
    if(renderPage)args.push('--render-page',String(renderPage));
    const child=spawn(python,args,{stdio:['ignore','pipe','pipe'],env:{NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,LANG:'C.UTF-8',HOME:outputDir,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'},windowsHide:true});
    const chunks=[];let size=0,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},Math.min(300000,Number(process.env.DOCUMENT_TIMEOUT_MS)||180000));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)child.kill('SIGKILL');else chunks.push(chunk);});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('NATIVE_UNAVAILABLE'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||timedOut){reject(new Error(timedOut?'NATIVE_TIMEOUT':'NATIVE_FAILURE'));return;}try{resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('NATIVE_INVALID_RESULT'));}});
  });
}
