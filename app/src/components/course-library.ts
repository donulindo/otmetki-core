import type {Material,MaterialKind,Subject} from '@/lib/types';
export type LibraryType=MaterialKind|'all'|'course';
export interface CourseSection {key:string;title:string;subjectId:string;materials:Material[];order:number;about:boolean;}
const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
const aboutTopic=/^(?:общие сведения|общее|основная информация|информация о курсе|о курсе)[.!\s]*$/iu;
export function isCourseInfo(m:Pick<Material,'topic'|'kind'>){return aboutTopic.test(m.topic.trim())&&m.kind!=='homework'&&m.kind!=='seminar'&&m.kind!=='lecture';}
export function courseType(m:Material):Exclude<LibraryType,'all'>{return isCourseInfo(m)?'course':m.kind;}
export const libraryTypeNames:Record<Exclude<LibraryType,'all'>,string>={lecture:'Лекция',seminar:'Семинар',homework:'Задание',rules:'Правила курса',notes:'Дополнительный материал',course:'Документ курса'};
export function matchesLibraryQuery(m:Material,query:string){const words=query.trim().toLocaleLowerCase('ru').split(/\s+/u).filter(Boolean);if(!words.length)return true;const text=[m.title,m.topic,m.filename,...m.blocks.map(b=>b.text)].join('\n').toLocaleLowerCase('ru');return words.every(w=>text.includes(w));}
function fallbackOrder(title:string,about:boolean){if(about)return -1;const n=/^(?:тема|topic)\s*(\d+(?:[.,]\d+)?)/iu.exec(title);if(n)return 100+Number(n[1].replace(',','.'));if(/проект|экзамен|зач[её]т/iu.test(title))return 1_000;return title==='Без раздела'?2_000:50;}
function aboutPriority(m:Material){if(/^сведения и структура курса$/iu.test(m.title))return 99;const patterns=[/программ|учебный план/iu,/об автор/iu,/балль|рейтинг|оценив|брс/iu,/контакт/iu];const n=patterns.findIndex(p=>p.test(m.title));return n<0?10:n;}
export function buildCourseSections(materials:Material[],subjects:Subject[]):CourseSection[]{
 const groups=new Map<string,CourseSection>();
 for(const material of materials){const topic=material.topic.trim(),about=aboutTopic.test(topic),title=about?'О курсе':topic||'Без раздела';const key=material.subjectId+'::'+title.normalize('NFC').toLocaleLowerCase('ru');let group=groups.get(key);if(!group){group={key,title,subjectId:material.subjectId,materials:[],about,order:about?-1:material.coursePosition?.section??fallbackOrder(title,false)};groups.set(key,group);}group.materials.push(material);if(!about&&material.coursePosition)group.order=Math.min(group.order,material.coursePosition.section);}
 const subjectOrder=new Map(subjects.map((s,i)=>[s.id,i]));
 return [...groups.values()].sort((a,b)=>(subjectOrder.get(a.subjectId)??999)-(subjectOrder.get(b.subjectId)??999)||a.order-b.order||collator.compare(a.title,b.title)).map(g=>({...g,materials:g.materials.sort((a,b)=>{
  if(a.coursePosition&&b.coursePosition)return a.coursePosition.item-b.coursePosition.item||collator.compare(a.title,b.title);
  return (g.about?aboutPriority(a)-aboutPriority(b):0)||collator.compare(a.title,b.title);
 })}));
}
