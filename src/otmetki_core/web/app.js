const byId = id => document.getElementById(id);
let selectedCourse = null;
let selectedMaterials = new Map();
const kindNames = {lecture:'Лекция',seminar:'Семинар',reference:'Справочник',glossary:'Глоссарий',homework:'Домашняя работа',test:'Контрольная',independent:'Самостоятельная',exam:'Экзамен',project:'Проект'};
const text = (tag, value, className) => {const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
async function api(path, body) {const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);if(!response.ok){const error=await response.json();throw new Error(error.error||'Не удалось выполнить запрос.');}return response;}
async function courses() {
  byId('status').textContent='Загружаем…';byId('detail').hidden=true;byId('courses').hidden=false;
  try {const result=await (await api('/api/courses?direction='+byId('direction').value)).json();byId('courses').replaceChildren();
    for(const course of result.courses){const button=text('button','', 'card course');button.append(text('strong',course.title),text('span',course.cohort+' · '+course.semester+' семестр'));button.addEventListener('click',()=>openCourse(course));byId('courses').append(button);}
    byId('status').textContent=result.courses.length?'':'Предметов пока нет. Добавь вымышленные примеры командой demo.';
  } catch(error){byId('status').textContent=error.message;}
}
async function openCourse(course) {
  selectedCourse=course;selectedMaterials.clear();byId('export').disabled=true;byId('course-title').textContent=course.title;byId('status').textContent='Загружаем…';
  try {const collections=await Promise.all(['materials','assignments','point-rules'].map(async key=>[key,await(await api('/api/courses/'+course.id+'/'+key)).json()]));
    for(const [key,data] of collections){const target=byId(key==='point-rules'?'points':key);target.replaceChildren();
      if(!data[key].length)target.append(text('p','Пока нет записей.','muted'));
      for(const item of data[key]){const card=text('div','', 'card');
        if(key==='materials'){card.classList.add('material');const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','Добавить '+item.title+' в контекст');check.addEventListener('change',()=>{if(check.checked)selectedMaterials.set(item.id,item.version);else selectedMaterials.delete(item.id);byId('export').disabled=!selectedMaterials.size;});const button=text('button',item.title);button.append(text('small',(kindNames[item.kind]||item.kind)+' · версия '+item.version+' · '+(item.status==='limited'?'есть ограничения':'текст готов')));button.addEventListener('click',()=>openMaterial(item));card.append(check,button);}
        else{const heading=text('strong',item.title);if(item.tentative)heading.append(text('span','Предварительно','pill'));card.append(heading,text('p',item.description||'Описание пока не добавлено.','muted'));if(key==='assignments')card.append(text('p',item.dueAt?'Срок: '+new Date(item.dueAt).toLocaleString('ru-RU'):'Дата не определена.','muted'));card.append(text('span',item.maxPoints===null?'Баллы не указаны.':'До '+item.maxPoints+' баллов','muted'));}
        target.append(card);
      }
    }
    byId('courses').hidden=true;byId('detail').hidden=false;byId('status').textContent='';
  } catch(error){byId('status').textContent=error.message;}
}
function openMaterial(material) {byId('material-title').textContent=material.title;byId('material-version').textContent='Версия '+material.version;byId('material-blocks').replaceChildren();for(const warning of material.warnings)byId('material-blocks').append(text('p',warning,'muted'));for(const block of material.blocks){const card=text('div','', 'card');card.append(text('small',block.page?'Страница '+block.page:block.slide?'Слайд '+block.slide:'Текстовый фрагмент','muted'),text(block.kind==='text'?'p':'pre',block.text));if(block.warning)card.append(text('small',block.warning,'muted'));byId('material-blocks').append(card);}byId('material-dialog').showModal();}
byId('direction').addEventListener('change',courses);byId('back').addEventListener('click',courses);byId('close-dialog').addEventListener('click',()=>byId('material-dialog').close());
byId('export').addEventListener('click',async()=>{byId('status').textContent='Готовим текст…';try{const response=await api('/api/context.txt',{materials:[...selectedMaterials].map(([id,version])=>({id,version}))});const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download='context.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);byId('status').textContent='Текст скачан. Оригиналы не менялись.';}catch(error){byId('status').textContent=error.message;}});
courses();
