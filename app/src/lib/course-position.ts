import 'server-only';
import {getDB} from './db';
import type {Material} from './types';

/** Only display order is projected; archive paths, URLs and raw source records stay server-side. */
export function coursePosition(material:Material):Material['coursePosition'] {
 const db=getDB();
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='onecon_import_entries'").get())return undefined;
 try {
 const row=db.prepare('SELECT rowid AS ordinal,source_json FROM onecon_import_entries WHERE owner_id=? AND material_id=? LIMIT 1').get(material.ownerId,material.id) as {ordinal:number;source_json:string}|undefined;
 if(!row||typeof row.source_json!=='string'||row.source_json.length>512_000||!Number.isSafeInteger(Number(row.ordinal)))return undefined;
  const data=JSON.parse(row.source_json);
  if(!Array.isArray(data.sections)||data.sections.length>500||!data.source)return undefined;
  const index=data.sections.findIndex((s:{id?:unknown})=>s?.id===data.source.sectionId);
  if(index<0)return undefined;
  // A subsequent manual topic change takes precedence over the old source position.
  const section=data.sections[index];const path:string[]=[];let current=section;const visited=new Set<string>();
  while(current&&typeof current.title==='string'&&!visited.has(current.id)){
   visited.add(current.id);path.unshift(current.title);current=data.sections.find((s:{id?:unknown})=>s?.id===current.parentId);
  }
  if(path.join(' / ').trim()!==material.topic.trim())return undefined;
  return {section:index,item:data.source.id==='course-overview'?Number.MAX_SAFE_INTEGER:Number(row.ordinal)};
 }catch{return undefined;}
}
