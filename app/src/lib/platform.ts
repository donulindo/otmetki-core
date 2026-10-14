import 'server-only';
import {getDB,getSubject,listSubjects,listMaterials,getMaterial,getMaterialVersion,getMaterialFile,createMaterial,updateMaterial,updateMaterialExtraction,replaceMaterialWithUpload,deleteMaterial,transaction,recordAudit,id,now} from './db';
import type {Viewer,Material,TextBlock} from './types';

export class PolicyError extends Error {constructor(public status:number,message:string){super(message);}}
export const FEATURES=['materials','chat','tutor','feedback','schedule','work_calendar'] as const;
export type Feature=typeof FEATURES[number];
export const FEATURE_STATUS=['available','beta','closed_test','development','unsupported'] as const;
export type FeatureStatus=typeof FEATURE_STATUS[number];
export interface Profile {faculty:string;direction:string;course:number;academicYear:string;semester:number;group:string;}
export interface Audience extends Profile {id:string;scope:'group'|'stream';label:string;archived:boolean;groups:string[];subjectIds:string[];}
const initialized=new WeakSet<object>();
export function platformDB(){
 const db=getDB();if(initialized.has(db))return db;
 db.exec(`CREATE TABLE IF NOT EXISTS platform_profiles(user_id TEXT PRIMARY KEY,telegram_id TEXT UNIQUE,display_name TEXT NOT NULL,profile_json TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS audiences(id TEXT PRIMARY KEY,scope TEXT NOT NULL,label TEXT NOT NULL,profile_json TEXT NOT NULL,groups_json TEXT NOT NULL,subjects_json TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS audience_memberships(user_id TEXT NOT NULL,audience_id TEXT NOT NULL REFERENCES audiences(id),active INTEGER NOT NULL,PRIMARY KEY(user_id,audience_id));
 CREATE TABLE IF NOT EXISTS feature_rules(id TEXT PRIMARY KEY,feature TEXT NOT NULL,selector_json TEXT NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS feature_grants(user_id TEXT NOT NULL,feature TEXT NOT NULL,PRIMARY KEY(user_id,feature));
 CREATE TABLE IF NOT EXISTS feature_choices(user_id TEXT NOT NULL,feature TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(user_id,feature));
 CREATE TABLE IF NOT EXISTS library_publications(material_id TEXT PRIMARY KEY REFERENCES materials(id),audience_id TEXT NOT NULL REFERENCES audiences(id),author_id TEXT NOT NULL,origin_id TEXT NOT NULL,origin_version INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS library_alternatives(id TEXT PRIMARY KEY,material_id TEXT NOT NULL,base_version INTEGER NOT NULL,author_id TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT);
 CREATE TABLE IF NOT EXISTS library_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS publication_requests(material_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,audience_id TEXT NOT NULL,source_version INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_bindings(chat_id TEXT NOT NULL,response_id TEXT NOT NULL,material_id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(response_id,material_id));
 CREATE TABLE IF NOT EXISTS course_events(id TEXT PRIMARY KEY,author_id TEXT NOT NULL,audience_id TEXT,subject_id TEXT NOT NULL,title TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO library_settings VALUES('moderation','false');`);
 initialized.add(db);return db;
}
export function profileFor(viewer:Viewer):Profile {
 const row=platformDB().prepare('SELECT profile_json FROM platform_profiles WHERE user_id=? AND active=1').get(viewer.id) as any;
 if(row)return JSON.parse(row.profile_json);
 if(viewer.role!=='owner')throw new PolicyError(403,'Профиль не подтверждён.');
 return {faculty:'msu-econ',direction:/^[EЭ]/i.test(viewer.group)?'economics':/^[MМ]/i.test(viewer.group)?'management':'other',course:1,academicYear:'2026/27',semester:1,group:viewer.group};
}
export function confirmedViewer(userId:string):Viewer|null {
 const r=platformDB().prepare('SELECT * FROM platform_profiles WHERE user_id=? AND active=1').get(userId) as any;
 if(!r)return null;const p=JSON.parse(r.profile_json);return {id:r.user_id,displayName:r.display_name,role:'student',...p};
}
export function actorForId(userId:string):Viewer|null{return userId==='preview-owner'?{id:userId,displayName:'Владелец',group:process.env.PREVIEW_OWNER_GROUP||'M104',role:'owner'}:confirmedViewer(userId);}
export function confirmedTelegramIds(){return (platformDB().prepare('SELECT telegram_id FROM platform_profiles WHERE active=1 AND telegram_id IS NOT NULL').all() as any[]).map(r=>r.telegram_id);}
export function viewerForTelegram(telegramId:string){const r=platformDB().prepare('SELECT user_id FROM platform_profiles WHERE telegram_id=? AND active=1').get(telegramId) as any;return r?confirmedViewer(r.user_id):null;}
export function ownerOnly(v:Viewer){if(v.role!=='owner'||v.id!=='preview-owner')throw new PolicyError(403,'Действие доступно владельцу.');}
export function setConfirmedProfile(actor:Viewer,userId:string,telegramId:string,displayName:string,profile:Profile){
 ownerOnly(actor);if(!/^\d+$/.test(telegramId)||!getProfileValid(profile))throw new PolicyError(400,'Проверьте подтверждённый профиль.');
 platformDB().prepare('INSERT INTO platform_profiles VALUES(?,?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET telegram_id=excluded.telegram_id,display_name=excluded.display_name,profile_json=excluded.profile_json,active=1').run(userId,telegramId,displayName,JSON.stringify(profile));
 recordAudit(actor.id,'profile.confirmed','profile',userId,{profile});
}
function getProfileValid(p:Profile){return p.faculty.length>0&&['management','economics','other','common'].includes(p.direction)&&p.course>=1&&p.course<=6&&p.semester>=1&&p.semester<=12&&/^\d{4}\/\d{2}$/.test(p.academicYear)&&p.group.length>0;}
function audience(row:any):Audience{return {...JSON.parse(row.profile_json),id:row.id,scope:row.scope,label:row.label,archived:!!row.archived,groups:JSON.parse(row.groups_json),subjectIds:JSON.parse(row.subjects_json)};}
export function getAudience(audienceId:string){const r=platformDB().prepare('SELECT * FROM audiences WHERE id=?').get(audienceId);return r?audience(r):null;}
export function createAudience(actor:Viewer,input:Omit<Audience,'id'|'archived'>){
 ownerOnly(actor);if(!getProfileValid(input)||!input.groups.length||!input.subjectIds.length||input.subjectIds.some(s=>!getSubject(s))||input.scope==='group'&&input.groups.length!==1)throw new PolicyError(400,'Проверьте аудиторию и предметы.');
 const aid=id();platformDB().prepare('INSERT INTO audiences VALUES(?,?,?,?,?,?,0)').run(aid,input.scope,input.label,JSON.stringify({faculty:input.faculty,direction:input.direction,course:input.course,academicYear:input.academicYear,semester:input.semester,group:input.group}),JSON.stringify([...new Set(input.groups)]),JSON.stringify([...new Set(input.subjectIds)]));recordAudit(actor.id,'audience.created','audience',aid);return getAudience(aid)!;
}
function matchesAudience(p:Profile,a:Audience){return p.faculty===a.faculty&&(a.direction==='common'||p.direction===a.direction)&&p.course===a.course&&p.academicYear===a.academicYear&&p.semester===a.semester&&a.groups.includes(p.group);}
export function setMembership(actor:Viewer,userId:string,audienceId:string,active:boolean){
 ownerOnly(actor);const v=userId===actor.id?actor:confirmedViewer(userId),a=getAudience(audienceId);if(!v||!a||active&&!matchesAudience(profileFor(v),a))throw new PolicyError(400,'Профиль не относится к этой аудитории.');
 platformDB().prepare('INSERT INTO audience_memberships VALUES(?,?,?) ON CONFLICT(user_id,audience_id) DO UPDATE SET active=excluded.active').run(userId,audienceId,Number(active));recordAudit(actor.id,active?'membership.granted':'membership.revoked','audience',audienceId,{userId});
}
export function canReadAudience(v:Viewer,a:Audience){
 if(v.role==='owner')return true;
 // Archived memberships retain historical reading even after promotion to a new semester.
 return !!platformDB().prepare('SELECT 1 FROM audience_memberships WHERE user_id=? AND audience_id=? AND active=1').get(v.id,a.id)&&(a.archived||matchesAudience(profileFor(v),a));
}
export function audiencesFor(v:Viewer){return (platformDB().prepare('SELECT * FROM audiences').all() as any[]).map(audience).filter(a=>canReadAudience(v,a));}
export function archiveAudience(actor:Viewer,aid:string,archived:boolean){ownerOnly(actor);if(!getAudience(aid))throw new PolicyError(404,'Учебный набор не найден.');platformDB().prepare('UPDATE audiences SET archived=? WHERE id=?').run(Number(archived),aid);recordAudit(actor.id,archived?'audience.archived':'audience.restored','audience',aid);}
export function subjectsForViewer(v:Viewer){const p=profileFor(v),extra=new Set(audiencesFor(v).flatMap(a=>a.subjectIds));return listSubjects().filter(s=>p.faculty==='msu-econ'&&p.course===1&&s.direction===p.direction&&s.semester===p.semester||extra.has(s.id));}
export function assertSubject(v:Viewer,sid:string){if(!subjectsForViewer(v).some(s=>s.id===sid))throw new PolicyError(403,'Предмет недоступен этому профилю.');}
export const FEATURE_NAMES:Record<Feature,string>={materials:'Материалы',chat:'Беседы',tutor:'Репетитор',feedback:'Обратная связь',schedule:'Расписание',work_calendar:'Работы'};
const unavailableModules=new Set<Feature>();
export function featureState(v:Viewer,feature:Feature){
 const p=profileFor(v);let status:FeatureStatus=p.faculty==='msu-econ'&&p.course===1&&['economics','management'].includes(p.direction)?'beta':'development';
 let specificity=-1;
 for(const r of platformDB().prepare('SELECT * FROM feature_rules WHERE feature=?').all(feature) as any[]){const sel=JSON.parse(r.selector_json);if(Object.keys(sel).every(k=>sel[k]===(p as any)[k])){const score=(sel.group?100:0)+Object.keys(sel).length;if(score>specificity){specificity=score;status=r.status;}}}
 if(unavailableModules.has(feature))status='unsupported';
 const choice=platformDB().prepare('SELECT enabled FROM feature_choices WHERE user_id=? AND feature=?').get(v.id,feature) as any;
 const admitted=status!=='closed_test'||v.role==='owner'||!!platformDB().prepare('SELECT 1 FROM feature_grants WHERE user_id=? AND feature=?').get(v.id,feature);
 return {id:feature,name:FEATURE_NAMES[feature],status,enabled:choice?.enabled!==0,canAct:['available','beta','closed_test'].includes(status)&&admitted&&choice?.enabled!==0};
}
export function featureCatalog(v:Viewer){return FEATURES.map(f=>featureState(v,f));}
export function assertFeature(v:Viewer,f:Feature){if(!featureState(v,f).canAct)throw new PolicyError(403,'Новые действия этой функции сейчас недоступны. Сохранённые данные остаются доступны по вашим правам.');}
export function chooseFeature(v:Viewer,f:Feature,enabled:boolean){platformDB().prepare('INSERT INTO feature_choices VALUES(?,?,?) ON CONFLICT(user_id,feature) DO UPDATE SET enabled=excluded.enabled').run(v.id,f,Number(enabled));return featureState(v,f);}
export function setFeatureRule(actor:Viewer,feature:Feature,selector:Partial<Profile>,status:FeatureStatus){
 ownerOnly(actor);const json=JSON.stringify(Object.fromEntries(Object.entries(selector).sort(([a],[b])=>a.localeCompare(b))));
 const specificity=(s:any)=>(s.group?100:0)+Object.keys(s).length;
 for(const r of platformDB().prepare('SELECT * FROM feature_rules WHERE feature=?').all(feature) as any[]){const s=JSON.parse(r.selector_json);if(r.selector_json!==json&&specificity(s)===specificity(selector)&&r.status!==status&&Object.keys(s).every(k=>!(k in selector)||s[k]===(selector as any)[k]))throw new PolicyError(400,'Правила одинакового приоритета пересекаются. Уточните аудиторию.');}
 const existing=(platformDB().prepare('SELECT * FROM feature_rules WHERE feature=?').all(feature) as any[]).find(r=>r.selector_json===json);
 if(existing)platformDB().prepare('UPDATE feature_rules SET status=? WHERE id=?').run(status,existing.id);else platformDB().prepare('INSERT INTO feature_rules VALUES(?,?,?,?)').run(id(),feature,json,status);
 recordAudit(actor.id,'feature.rule','feature',feature,{selector,status});
}
export function grantFeature(actor:Viewer,userId:string,feature:Feature,grant:boolean){ownerOnly(actor);if(grant)platformDB().prepare('INSERT OR IGNORE INTO feature_grants VALUES(?,?)').run(userId,feature);else platformDB().prepare('DELETE FROM feature_grants WHERE user_id=? AND feature=?').run(userId,feature);}
function publication(mid:string){return platformDB().prepare('SELECT * FROM library_publications WHERE material_id=?').get(mid) as any;}
export function accessibleMaterial(v:Viewer,mid:string,version?:number,allowArchived=false):Material|null {
 const own=version===undefined?getMaterial(mid,v.id):getMaterialVersion(mid,v.id,version);if(own)return own;
 const pub=publication(mid),a=pub&&getAudience(pub.audience_id);if(!pub&&v.id==='preview-owner'&&v.role==='owner'){const r=platformDB().prepare("SELECT * FROM publication_requests WHERE material_id=? AND state='review'").get(mid) as any;if(r&&(version===undefined||version===r.source_version))return getMaterialVersion(mid,r.actor_id,r.source_version);}
 if(!pub||!a||!canReadAudience(v,a)||pub.archived&&!allowArchived)return null;
 const storage='audience:'+a.id;const m=version===undefined?getMaterial(mid,storage):getMaterialVersion(mid,storage,version);return m;
}
export function requireMaterial(v:Viewer,mid:string,version?:number){const m=accessibleMaterial(v,mid,version);if(!m)throw new PolicyError(404,'Материал недоступен.');return m;}
export function visibleMaterials(v:Viewer){const all=[...listMaterials(v.id)];for(const a of audiencesFor(v))for(const m of listMaterials('audience:'+a.id)){const p=publication(m.id);if(p&&!p.archived)all.push(m);}return all;}
export function materialAccess(v:Viewer,mid:string){const p=publication(mid);if(!p)return getMaterial(mid,v.id)?{scope:'personal',canEdit:featureState(v,'materials').canAct,canArchive:true,audienceId:null}:{scope:'review',canEdit:false,canArchive:false,audienceId:null};const a=getAudience(p.audience_id)!;return {scope:a.scope,canEdit:!a.archived&&canReadAudience(v,a)&&featureState(v,'materials').canAct,canArchive:!a.archived&&(v.role==='owner'||p.author_id===v.id),audienceId:a.id,audienceLabel:a.label};}
function requireSharedWrite(v:Viewer,mid:string){assertFeature(v,'materials');const pub=publication(mid),a=pub&&getAudience(pub.audience_id);if(!pub||!a||a.archived||!canReadAudience(v,a)||pub.archived)throw new PolicyError(403,'Редактирование этого набора закрыто.');return a;}
function copyVersion(v:Viewer,m:Material,a:Audience){
 const file=getMaterialFile(m.id,m.ownerId,m.version);const row=platformDB().prepare('SELECT snapshot_json FROM material_versions WHERE material_id=? AND version=?').get(m.id,m.version) as any;const saved=row&&JSON.parse(row.snapshot_json);
 return createMaterial('audience:'+a.id,{title:m.title,subjectId:m.subjectId,kind:m.kind,topic:m.topic,filename:m.filename,mimeType:m.mimeType,size:m.size,hash:m.hash,filePath:file?saved.file_path:undefined,sourceUrl:m.sourceUrl||undefined,status:m.status,blocks:m.blocks,warnings:m.warnings,pageCount:m.pageCount});
}
export function moderationEnabled(){return (platformDB().prepare("SELECT value FROM library_settings WHERE key='moderation'").get() as any).value==='true';}
export function setModeration(v:Viewer,enabled:boolean){ownerOnly(v);platformDB().prepare("UPDATE library_settings SET value=? WHERE key='moderation'").run(String(enabled));recordAudit(v.id,'library.moderation','settings','moderation',{enabled});}
export function assertPublicationTarget(v:Viewer,aid:string,subjectId:string){assertFeature(v,'materials');const a=getAudience(aid);if(!a||a.archived||!canReadAudience(v,a)||!a.subjectIds.includes(subjectId))throw new PolicyError(403,'Публикация в эту аудиторию недоступна.');return a;}
export function publishMaterial(v:Viewer,mid:string,expectedVersion:number,aid:string):{pending:boolean;material?:Material}{
 assertFeature(v,'materials');const m=getMaterial(mid,v.id),a=getAudience(aid);
 if(!m||m.version!==expectedVersion)throw new PolicyError(409,'Личный материал изменился. Откройте актуальную версию.');
 if(!a||!canReadAudience(v,a)||a.archived||!a.subjectIds.includes(m.subjectId))throw new PolicyError(403,'Публикация в эту аудиторию недоступна.');
 if(['queued','extracting'].includes(m.status)||moderationEnabled()){platformDB().prepare('INSERT INTO publication_requests VALUES(?,?,?,?,?) ON CONFLICT(material_id) DO UPDATE SET actor_id=excluded.actor_id,audience_id=excluded.audience_id,source_version=excluded.source_version,state=excluded.state').run(mid,v.id,aid,m.version,['queued','extracting'].includes(m.status)?'processing':'review');return {pending:true};}
 return transaction(()=>{const common=copyVersion(v,m,a);platformDB().prepare('INSERT INTO library_publications VALUES(?,?,?,?,?,0)').run(common.id,a.id,v.id,m.id,m.version);recordAudit(v.id,'library.published','material',common.id,{audienceId:a.id,originVersion:m.version});return {material:common,pending:false};});
}
export function flushPublicationRequests(ownerId:string,mid:string){const r=platformDB().prepare("SELECT * FROM publication_requests WHERE actor_id=? AND material_id=? AND state='processing'").get(ownerId,mid) as any;if(!r)return;const v=actorForId(ownerId),m=getMaterial(mid,ownerId);if(!v||!m)return;const reasons=platformDB().prepare('SELECT reason FROM material_versions WHERE material_id=? AND version>?').all(mid,r.source_version) as any[];if(reasons.some(x=>x.reason!=='extraction')){platformDB().prepare("UPDATE publication_requests SET state='blocked' WHERE material_id=?").run(mid);return;}try{const result=publishMaterial(v,mid,m.version,r.audience_id);if(!result.pending)platformDB().prepare("UPDATE publication_requests SET state='published' WHERE material_id=?").run(mid);}catch{platformDB().prepare("UPDATE publication_requests SET state='blocked' WHERE material_id=?").run(mid);}}
export function reviewPublication(v:Viewer,mid:string,approve:boolean){ownerOnly(v);const r=platformDB().prepare("SELECT * FROM publication_requests WHERE material_id=? AND state='review'").get(mid) as any;if(!r)throw new PolicyError(404,'Заявка не найдена.');const actor=r.actor_id==='preview-owner'?v:confirmedViewer(r.actor_id);if(!actor)throw new PolicyError(403,'Автор недоступен.');if(approve){assertFeature(actor,'materials');const m=getMaterial(mid,actor.id),a=getAudience(r.audience_id);if(!m||m.version!==r.source_version||!a||a.archived||!canReadAudience(actor,a)||['queued','extracting'].includes(m.status)||!a.subjectIds.includes(m.subjectId))throw new PolicyError(409,'Материал или права изменились.');transaction(()=>{const common=copyVersion(actor,m,a);platformDB().prepare('INSERT INTO library_publications VALUES(?,?,?,?,?,0)').run(common.id,a.id,actor.id,m.id,m.version);});}platformDB().prepare("UPDATE publication_requests SET state=? WHERE material_id=?").run(approve?'published':'rejected',mid);recordAudit(v.id,'publication.reviewed','material',mid,{approve});}
export function pendingPublications(v:Viewer){ownerOnly(v);return platformDB().prepare("SELECT material_id,audience_id,source_version,state FROM publication_requests WHERE state IN ('review','blocked')").all();}
export function reviseShared(v:Viewer,mid:string,baseVersion:number,input:{title?:string;topic?:string;kind?:Material['kind'];blocks?:{id:string;text:string}[]}){
 requireSharedWrite(v,mid);const current=requireMaterial(v,mid),base=accessibleMaterial(v,mid,baseVersion);if(!base)throw new PolicyError(404,'Исходная версия не найдена.');
 if(input.blocks){const ids=new Set(input.blocks.map(b=>b.id));if(ids.size!==input.blocks.length||[...ids].some(x=>!base.blocks.some(b=>b.id===x)))throw new PolicyError(400,'Фрагменты исходной версии не найдены.');}
 return transaction(()=>{
  const latest=requireMaterial(v,mid);
  if(latest.version!==baseVersion||moderationEnabled()){
   const alternativeId=id();platformDB().prepare('INSERT INTO library_alternatives VALUES(?,?,?,?,?,?,NULL)').run(alternativeId,mid,baseVersion,v.id,JSON.stringify(input),now());recordAudit(v.id,'library.alternative','material',mid,{alternativeId,baseVersion});return {material:latest,alternativeId,conflict:latest.version!==baseVersion,awaitingReview:moderationEnabled()};
  }
  let result=latest;
  if(input.blocks){const changes=new Map(input.blocks.map(b=>[b.id,b.text]));result=updateMaterialExtraction(mid,latest.ownerId,{blocks:latest.blocks.map(b=>changes.has(b.id)?{...b,text:changes.get(b.id)!}:b),warnings:latest.warnings,status:latest.status,pageCount:latest.pageCount},'shared_correction',baseVersion)!;}
  if(input.title!==undefined||input.topic!==undefined||input.kind!==undefined)result=updateMaterial(mid,latest.ownerId,{title:input.title,topic:input.topic,kind:input.kind,version:result.version});recordAudit(v.id,'library.corrected','material',mid,{baseVersion,version:result.version});return {material:result};
 });
}
export function alternatives(v:Viewer,mid:string){requireMaterial(v,mid);return platformDB().prepare('SELECT id,base_version AS baseVersion,payload_json AS payload,created_at AS createdAt,resolved_at AS resolvedAt FROM library_alternatives WHERE material_id=? ORDER BY created_at').all(mid).map((r:any)=>({...r,payload:JSON.parse(r.payload)}));}
export function resolveAlternative(v:Viewer,mid:string,alternativeId:string,version:number,merged?:{title?:string;topic?:string;kind?:Material['kind'];blocks?:{id:string;text:string}[]}){
 requireSharedWrite(v,mid);if(moderationEnabled())ownerOnly(v);
 return transaction(()=>{const current=requireMaterial(v,mid);if(current.version!==version)throw new PolicyError(409,'Материал снова изменился. Альтернатива сохранена.');const r=platformDB().prepare('SELECT * FROM library_alternatives WHERE id=? AND material_id=? AND resolved_at IS NULL').get(alternativeId,mid) as any;if(!r)throw new PolicyError(404,'Альтернатива не найдена.');const source=accessibleMaterial(v,mid,r.base_version)!;const change=merged||JSON.parse(r.payload_json);if(!merged&&change.blocks){const changes=new Map<string,string>(change.blocks.map((b:any)=>[b.id,b.text]));change.blocks=current.blocks.map(b=>({id:b.id,text:changes.get(b.id)??b.text}));}
  if(change.replacementId){const candidate=getMaterial(change.replacementId,current.ownerId);if(!candidate)throw new PolicyError(404,'Файл альтернативы недоступен.');const replaced=replaceMaterialWithUpload(mid,current.ownerId,candidate.id,version);platformDB().prepare('UPDATE library_alternatives SET resolved_at=? WHERE id=?').run(now(),alternativeId);recordAudit(v.id,'alternative.resolved','material',mid,{alternativeId,version:replaced.material.version});return replaced.material;}
  // The owner explicitly resolves reviewed alternatives without disabling the moderation setting.
  const storage=current.ownerId;let result=current;if(change.blocks){const edits=new Map<string,string>(change.blocks.map((b:any)=>[b.id,b.text]));if([...edits.keys()].some(x=>!current.blocks.some(b=>b.id===x)))throw new PolicyError(409,'Структура фрагментов изменилась. Требуется объединение.');result=updateMaterialExtraction(mid,storage,{blocks:current.blocks.map(b=>edits.has(b.id)?{...b,text:edits.get(b.id)!}:b),status:current.status,warnings:current.warnings,pageCount:current.pageCount},'alternative_resolved',version)!;}
  if(change.title!==undefined||change.topic!==undefined||change.kind!==undefined)result=updateMaterial(mid,storage,{title:change.title,topic:change.topic,kind:change.kind,version:result.version});platformDB().prepare('UPDATE library_alternatives SET resolved_at=? WHERE id=?').run(now(),alternativeId);recordAudit(v.id,'alternative.resolved','material',mid,{alternativeId,version:result.version});return result;});
}
export function replaceSharedOriginal(v:Viewer,mid:string,candidateId:string,expectedVersion:number){
 const a=requireSharedWrite(v,mid),candidate=getMaterial(candidateId,v.id);if(!candidate||!getMaterialFile(candidateId,v.id)||['queued','extracting'].includes(candidate.status))throw new PolicyError(400,'Выберите обработанный личный файл.');
 return transaction(()=>{const current=requireMaterial(v,mid);if(current.subjectId!==candidate.subjectId)throw new PolicyError(400,'Предметы материалов не совпадают.');const stored=copyVersion(v,candidate,a);if(current.version!==expectedVersion||moderationEnabled()){const aid=id();platformDB().prepare('INSERT INTO library_alternatives VALUES(?,?,?,?,?,?,NULL)').run(aid,mid,expectedVersion,v.id,JSON.stringify({replacementId:stored.id}),now());recordAudit(v.id,'library.file-alternative','material',mid,{alternativeId:aid});return {material:current,alternativeId:aid,conflict:current.version!==expectedVersion};}const result=replaceMaterialWithUpload(mid,current.ownerId,stored.id,expectedVersion);recordAudit(v.id,'library.source-updated','material',mid,{version:result.material.version});return result;});
}
export function archiveMaterial(v:Viewer,mid:string,archived:boolean){assertFeature(v,'materials');const pub=publication(mid);if(pub){const a=getAudience(pub.audience_id)!;if(a.archived||!canReadAudience(v,a)||v.role!=='owner'&&pub.author_id!==v.id)throw new PolicyError(403,'Архивировать может автор публикации или владелец.');platformDB().prepare('UPDATE library_publications SET archived=? WHERE material_id=?').run(Number(archived),mid);}else{if(!getMaterial(mid,v.id)&&archived)throw new PolicyError(404,'Материал не найден.');if(archived)deleteMaterial(mid,v.id);else platformDB().prepare('UPDATE materials SET deleted_at=NULL WHERE id=? AND owner_id=?').run(mid,v.id);}recordAudit(v.id,archived?'material.archived':'material.restored','material',mid);}
export function archivedMaterials(v:Viewer){const own=platformDB().prepare('SELECT id FROM materials WHERE owner_id=? AND deleted_at IS NOT NULL').all(v.id) as any[];const common=(platformDB().prepare('SELECT * FROM library_publications WHERE archived=1').all() as any[]).filter(p=>{const a=getAudience(p.audience_id);return a&&canReadAudience(v,a);});return [...own.map(r=>getMaterialVersion(r.id,v.id,Number((platformDB().prepare('SELECT version FROM materials WHERE id=?').get(r.id) as any).version))),...common.map(p=>getMaterial(p.material_id,'audience:'+p.audience_id))].filter(Boolean);}
export function bindSources(v:Viewer,chatId:string,responseId:string,materials:Material[]){for(const m of materials){requireMaterial(v,m.id,m.version);platformDB().prepare('INSERT OR IGNORE INTO source_bindings VALUES(?,?,?,?)').run(chatId,responseId,m.id,m.version);}}
