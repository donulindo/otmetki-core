import 'server-only';
import {pathToFileURL} from 'node:url';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {isAbsolute, resolve, relative, sep} from 'node:path';
import {generateText} from 'ai';
import {getDB,getMaterial,getMaterialFile,privatePath,updateMaterialExtraction,createJob,updateJob,now} from './db';
import {acquireAI,aiConfigured,languageModel} from './provider';
import type {Effort,TextBlock} from './types';
import {flushPublicationRequests,actorForId,requireMaterial} from './platform';

interface NativeResult {blocks: TextBlock[]; warnings: string[]; pageCount: number; status: 'ready'|'limited'; needsVision: {blockId:string;imageFile:string;page?:number;slide?:number}[];}
interface Task {jobId:string;materialId:string;ownerId:string;actorId?:string;blockId?:string;effort:Effort;attempt?:number;expectedVersion?:number;sourceHash?:string;baseline?:{blocks:TextBlock[];warnings:string[]};resume?:NativeResult;wholePage?:number;}
const globalTasks=globalThis as typeof globalThis & {__otmetkiDocuments?:{active:boolean;activeJobId?:string;tasks:Task[];recovered:boolean}};
const queue=globalTasks.__otmetkiDocuments ??= {active:false,tasks:[],recovered:false};

async function nativeExtract(path:string,mime:string,outputDir:string,renderPage?:number):Promise<NativeResult> {
  const runtimeURL=pathToFileURL(resolve('server/native-runner.mjs')).href;
  const runner=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ runtimeURL);
  return runner.nativeExtract(path,mime,outputDir,renderPage);
}
function containedImage(path:string,outputDir:string) {
  const rel=relative(outputDir,path);return isAbsolute(path)&&rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..';
}
async function vision(imageFile:string,effort:Effort,nativeText?:string,timeout=120000) {
  const signal=AbortSignal.timeout(timeout);
  const release=await acquireAI('background',signal);
  try {
    const result=await generateText({model:languageModel('gpt-6.1-sol'),maxRetries:0,abortSignal:signal,
      timeout,maxOutputTokens:14000,
      providerOptions:{openai:{reasoningEffort:effort,store:false}},
      messages:[{role:'user',content:[
        {type:'text',text:'Распознай весь видимый учебный текст. Верни только текст, не решай задания и не исправляй автора. Сохраняй числа, отрицания, условия, единицы измерения и математические знаки. Формулы запиши в LaTeX, таблицы — строками с |. Нечитаемое обозначь [неразборчиво]; ничего не дописывай.'+(nativeText?'\nНа странице уже программно прочитан следующий текст. Верни только дополнительное содержимое картинок/формул, которого в нём нет. Не повторяй этот текст. Если дополнений нет, верни [нет дополнительного текста].\n'+nativeText:'')},
        {type:'image',image:await readFile(imageFile),mediaType:'image/png'}
      ]}]});
    if(result.finishReason==='length'||!result.text.trim())throw new Error('VISION_INCOMPLETE');
    return result.text;
  } finally {release();}
}
async function run(task:Task) {
  const checkAccess=()=>{if(task.ownerId.startsWith('audience:')){const actor=actorForId(task.actorId||'');if(!actor)throw new Error('ACCESS_REVOKED');requireMaterial(actor,task.materialId);}};
  try{checkAccess();}catch{updateJob(task.jobId,task.ownerId,'cancelled');return;}
  const material=getMaterial(task.materialId,task.ownerId);if(!material){updateJob(task.jobId,task.ownerId,'cancelled');return;}
  let expectedVersion=task.expectedVersion??material.version;
  if((task.sourceHash&&task.sourceHash!==material.hash)||(material.version!==expectedVersion&&(!task.baseline||JSON.stringify(task.baseline.blocks)!==JSON.stringify(material.blocks)||JSON.stringify(task.baseline.warnings)!==JSON.stringify(material.warnings)))){cancelObsolete(task);return;}
  expectedVersion=material.version;
  updateJob(task.jobId,task.ownerId,'running');
  const source=getMaterialFile(task.materialId,task.ownerId);
  if(!source){updateJob(task.jobId,task.ownerId,'completed');return;}
  getDB().prepare('UPDATE materials SET status=?,updated_at=? WHERE id=? AND owner_id=?').run('extracting',now(),material.id,task.ownerId);
  const outputDir=privatePath(`extractions/${material.id}/${task.jobId}`);await mkdir(outputDir,{recursive:true,mode:0o700});
  try {
    let native:NativeResult;
    if(task.resume) {
      native=task.resume;
    } else if(task.blockId) {
      const block=material.blocks.find(b=>b.id===task.blockId);
      if(!block)throw new Error('NO_BLOCK');
      let imagePath:string;
      if(block.imageFile)imagePath=privatePath(block.imageFile);
      else if(source.mimeType==='application/pdf'&&block.page) {
        const rendered=await nativeExtract(source.path,source.mimeType,outputDir,block.page);
        imagePath=rendered.needsVision[0]?.imageFile;if(!imagePath)throw new Error('NO_IMAGE');
        task.wholePage=block.page;
      } else throw new Error('NO_IMAGE');
      native={blocks:material.blocks.map(b=>({...b})),warnings:material.warnings.filter(w=>!w.includes('ИИ пока')),pageCount:material.pageCount,status:'limited',needsVision:[{blockId:block.id,imageFile:imagePath,page:block.page,slide:block.slide}]};
    } else {
      native=await nativeExtract(source.path,source.mimeType,outputDir);
      await writeFile(resolve(outputDir,'native.json'),JSON.stringify(native),{mode:0o600});
    }
    const pendingWarnings=new Set(['Изображение ожидает распознавания; содержимое пока не извлечено.','Страница содержит скан или визуальные сведения; нужно распознавание изображения.','Фотография ожидает распознавания. Для рукописи рекомендуется сверка с оригиналом.']);
    const blocks=native.blocks.map(b=>({...b}));const warnings=native.warnings.filter(w=>!pendingWarnings.has(w)&&!w.includes('ИИ пока'));let waiting=false;
    const pending:NativeResult['needsVision']=[];
    const visionDeadline=Date.now()+180000;
    // Keep every generated image address private, including images beyond this pass's budget.
    for(const item of native.needsVision){const path=resolve(item.imageFile);if(!containedImage(path,privatePath('extractions')))throw new Error('INVALID_IMAGE_PATH');const block=blocks.find(b=>b.id===item.blockId);if(block)block.imageFile=relative(resolve(privatePath('extractions'),'..'),path);}
    for(const [index,item] of native.needsVision.entries()) {
      checkAccess();
      const imagePath=task.blockId?item.imageFile:resolve(item.imageFile);
      if(!containedImage(imagePath,privatePath('extractions')))throw new Error('INVALID_IMAGE_PATH');
      const block=blocks.find(b=>b.id===item.blockId);if(!block)continue;
      const rel=relative(resolve(privatePath('extractions'),'..'),imagePath);
      block.imageFile=rel;
      if(index>=30||Date.now()>=visionDeadline){warnings.push('Достигнут лимит обработки изображений за один проход. Доступна перепроверка отдельных страниц или фрагментов.');break;}
      if(!aiConfigured()){waiting=true;pending.push(item);block.warning='Текст изображения пока не распознан.';continue;}
      try {
        const nativeText=!task.wholePage&&item.page?blocks.filter(b=>b.page===item.page&&b.id!==item.blockId&&b.kind!=='image').map(b=>b.text).join('\n'):undefined;
        const recognized=await vision(imagePath,task.effort,nativeText,Math.min(120000,Math.max(1000,visionDeadline-Date.now())));
        if(task.wholePage)for(let i=blocks.length-1;i>=0;i--)if(blocks[i].page===task.wholePage&&blocks[i].id!==item.blockId)blocks.splice(i,1);
        block.text=recognized.trim()==='[нет дополнительного текста]'?'':recognized;block.kind=block.text?'text':'image';
        block.warning=block.text.includes('[неразборчиво]')?'Есть неразборчивые участки — сверьте с оригиналом.':undefined;
      } catch {
        waiting=true;pending.push(item);block.warning='Распознавание изображения ожидает доступности модели.';
      }
    }
    if(source.mimeType.startsWith('image/')&&blocks.some(b=>b.text.trim()))warnings.push('Текст распознан — рекомендуется сверка с оригиналом.');
    if(waiting)warnings.push('ИИ пока недоступен или не завершил чтение изображения. Полученный текст сохранён; можно повторить обработку.');
    const uncertain=waiting||warnings.length>0||blocks.some(b=>b.warning||(!b.text&&b.kind==='image'));
    const finalWarnings=[...new Set(warnings)];
    const latest=getMaterial(material.id,task.ownerId);
    checkAccess();
    if(!latest||latest.hash!==material.hash||JSON.stringify(latest.blocks)!==JSON.stringify(material.blocks)||JSON.stringify(latest.warnings)!==JSON.stringify(material.warnings)){cancelObsolete(task);return;}
    expectedVersion=latest.version;
    let resultingVersion=expectedVersion;
    if(JSON.stringify(material.blocks)!==JSON.stringify(blocks)||JSON.stringify(material.warnings)!==JSON.stringify(finalWarnings)) {
      const updated=updateMaterialExtraction(material.id,task.ownerId,{blocks,status:uncertain?'limited':'ready',warnings:finalWarnings,pageCount:native.pageCount},'extraction',expectedVersion);
      if(!updated){cancelObsolete(task);return;}resultingVersion=updated.version;
    } else {
      const updated=getDB().prepare('UPDATE materials SET status=?,updated_at=? WHERE id=? AND owner_id=? AND version=? AND deleted_at IS NULL').run(uncertain?'limited':'ready',now(),material.id,task.ownerId,expectedVersion);
      if(!updated.changes){cancelObsolete(task);return;}
    }
    const nextTask:Task={...task,expectedVersion:resultingVersion,sourceHash:material.hash,baseline:{blocks,warnings:finalWarnings},attempt:(task.attempt||0)+1,resume:{...native,blocks,warnings:finalWarnings,needsVision:pending}};
    getDB().prepare('UPDATE jobs SET payload_json=? WHERE id=? AND owner_id=?').run(JSON.stringify(nextTask),task.jobId,task.ownerId);
    updateJob(task.jobId,task.ownerId,waiting?'waiting':'completed',waiting?'Модель пока недоступна.':null);
    flushPublicationRequests(task.ownerId,task.materialId);
    if(waiting) {
      // Three bounded attempts. A manual edit invalidates this checkpoint; it is never overwritten.
      if(nextTask.attempt!>=3)return;
      const timer=setTimeout(()=>{queue.tasks.push(nextTask);void drain();},Math.min(300000,30000*Math.pow(2,Math.min(nextTask.attempt!,3))));
      timer.unref();
    }
  } catch {
    const latest=getMaterial(task.materialId,task.ownerId);
    if(!latest||latest.hash!==material.hash||JSON.stringify(latest.blocks)!==JSON.stringify(material.blocks)||JSON.stringify(latest.warnings)!==JSON.stringify(material.warnings)){cancelObsolete(task);return;}
    getDB().prepare('UPDATE materials SET status=?,warnings_json=?,updated_at=? WHERE id=? AND owner_id=?').run('error',JSON.stringify(['Не удалось прочитать файл. Оригинал сохранён; проверьте формат или повторите обработку.']),now(),material.id,task.ownerId);
    updateJob(task.jobId,task.ownerId,'error','Не удалось прочитать файл.');
  }
}
function cancelObsolete(task:Task) {
  updateJob(task.jobId,task.ownerId,'cancelled','Файл или текст изменён; устаревший результат не применён.');
  const busy=getDB().prepare("SELECT count(*) AS n FROM jobs WHERE material_id=? AND owner_id=? AND state IN ('queued','running')").get(task.materialId,task.ownerId) as {n:number};
  if(!busy.n) {
    const material=getMaterial(task.materialId,task.ownerId);
    if(material&&['queued','extracting'].includes(material.status))getDB().prepare('UPDATE materials SET status=? WHERE id=? AND owner_id=?').run(material.warnings.length||!material.blocks.length||material.blocks.some(b=>b.warning||!b.text.trim())?'limited':'ready',task.materialId,task.ownerId);
  }
}
async function drain() {
  if(queue.active)return;queue.active=true;
  try {while(queue.tasks.length){const task=queue.tasks.shift()!;queue.activeJobId=task.jobId;await run(task);}}
  finally {queue.active=false;queue.activeJobId=undefined;}
}
export function enqueueMaterialExtraction(materialId:string,ownerId:string) {
  recoverDocumentQueue();
  const material=getMaterial(materialId,ownerId);if(!material)throw new Error('MISSING_MATERIAL');
  const pending=material.blocks.filter(b=>b.imageFile&&b.warning&&/пока не распознан|ожидает доступности модели|ожидает распознавания/u.test(b.warning));
  const payload={expectedVersion:material.version,sourceHash:material.hash,baseline:{blocks:material.blocks,warnings:material.warnings},effort:'medium' as const,...(pending.length?{resume:{blocks:material.blocks,warnings:material.warnings,pageCount:material.pageCount,status:'limited' as const,needsVision:pending.map(b=>({blockId:b.id,imageFile:privatePath(b.imageFile!),page:b.page,slide:b.slide}))}}:{})};
  const jobId=createJob(materialId,ownerId,'extract',payload);
  getDB().prepare('UPDATE materials SET status=?,updated_at=? WHERE id=? AND owner_id=?').run('queued',now(),materialId,ownerId);
  queue.tasks.push({jobId,materialId,ownerId,...payload});void drain();return {jobId};
}
export function enqueueRecheck(materialId:string,ownerId:string,blockId:string,effort:Effort='medium',actorId=ownerId) {
  recoverDocumentQueue();
  const material=getMaterial(materialId,ownerId);const block=material?.blocks.find(b=>b.id===blockId);
  if(!block||(!block.imageFile&&!(material?.mimeType==='application/pdf'&&block.page)))throw new Error('NO_IMAGE');
  if(!['low','medium','high','xhigh','max'].includes(effort))throw new Error('INVALID_EFFORT');
  const payload={blockId,effort,actorId,expectedVersion:material!.version,sourceHash:material!.hash,baseline:{blocks:material!.blocks,warnings:material!.warnings}};
  const jobId=createJob(materialId,ownerId,'recheck',payload);
  getDB().prepare('UPDATE materials SET status=?,updated_at=? WHERE id=? AND owner_id=?').run('queued',now(),materialId,ownerId);
  queue.tasks.push({jobId,materialId,ownerId,...payload});void drain();return {jobId};
}
export function recoverDocumentQueue() {
  if(queue.recovered)return;queue.recovered=true;
  const rows=getDB().prepare("SELECT * FROM jobs WHERE state IN ('queued','running','waiting')").all() as {id:string;material_id:string;owner_id:string;kind:string;payload_json:string}[];
  for(const row of rows){
    if(queue.activeJobId===row.id||queue.tasks.some(t=>t.jobId===row.id))continue;
    const p=JSON.parse(row.payload_json);
    if(row.kind!=='extract'&&row.kind!=='recheck')continue;
    if(row.kind==='recheck'&&!p.blockId){updateJob(row.id,row.owner_id,'cancelled');continue;}
    if((p.attempt||0)>=3)continue;
    queue.tasks.push({...p,jobId:row.id,materialId:row.material_id,ownerId:row.owner_id,blockId:row.kind==='recheck'?p.blockId:undefined,effort:p.effort||'medium'});
  }
  if(queue.tasks.length)void drain();
}
