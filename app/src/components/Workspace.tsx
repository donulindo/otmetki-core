'use client';
import {PRODUCT_NAME,PRODUCT_TITLE,PRODUCT_FUNCTIONS} from '@/lib/brand';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { CalendarDays, ClipboardList, ListChecks, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Download, FileText, FolderOpen, GitBranch, GraduationCap, Home, LoaderCircle, LogOut, Menu, MessageCircle, Moon, Plus, Search, Settings2, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';
import type { Viewer, Subject, Material, Chat, Feedback, ModelId, Effort } from '@/lib/types';
import { profileDirection } from '@/lib/catalog';
import PlatformSettings from './PlatformSettings';
import CourseCalendar from './CourseCalendar';
import TelegramBridge from './TelegramBridge';
import {readiness,type PlatformState} from './platform-types';
import MaterialLibrary from './MaterialLibrary';
import MaterialDetail from './MaterialDetail';
import FeedbackPanel from './FeedbackPanel';
import FeedbackDialog from './FeedbackDialog';
import ChatCanvas from './ChatCanvas';
import { request, downloadContext, kindNames, statusNames, formatDate, plural } from './client-api';

type Section = 'home'|'materials'|'chat'|'tutor'|'feedback'|'settings'|'schedule'|'work_calendar';
type FeedbackTarget={type:'general'|'material'|'chat';id?:string;version?:number;title?:string};
interface MaterialVersion {version:number;reason:string;createdAt:string;}
interface SimilarCandidate {id:string;title:string;version:number;overlapBlocks:number;comparedBlocks?:number;candidateComparedBlocks?:number;exactFileDuplicate?:boolean;}
const sections = [{id:'home',label:'Главная',icon:Home},{id:'materials',label:'Материалы',icon:BookOpen},{id:'chat',label:'Беседы',icon:MessageCircle},{id:'tutor',label:'Репетитор',icon:GraduationCap},{id:'schedule',label:'Расписание',icon:CalendarDays},{id:'work_calendar',label:'Работы',icon:ClipboardList},{id:'feedback',label:'Обратная связь',icon:MessageCircle}] as const;
const efforts: Record<Effort,string>={low:'Быстро',medium:'Сбалансированно',high:'Вдумчиво',xhigh:'Глубоко',max:'Максимально'};

export default function Workspace({initialViewer,repositoryUrl=null}: {initialViewer:Viewer;repositoryUrl?:string|null}) {
  const [platform,setPlatform]=useState<PlatformState|null>(null);
  const refreshPlatform=useCallback(async()=>setPlatform(await request<PlatformState>('/api/platform')),[]);
  const canAct=(f:string)=>platform?.features.find(x=>x.id===f)?.canAct??false;
  const [section,setSection]=useState<Section>('home');
  const [subjects,setSubjects]=useState<Subject[]>([]);
  const [subjectId,setSubjectId]=useState('');
  const [storedMaterials,setMaterials]=useState<Material[]>([]);
  const [storedChats,setChats]=useState<Chat[]>([]);
  const [feedback,setFeedback]=useState<Feedback[]>([]);
  const [currentChat,setCurrentChat]=useState<Chat|null>(null);
  const [messages,setMessages]=useState<UIMessage[]>([]);
  const [contextOpen,setContextOpen]=useState(false);
  const [materialOpen,setMaterialOpen]=useState<Material|null>(null);
  const [materialVersions,setMaterialVersions]=useState<MaterialVersion[]>([]);
  const [similarCandidates,setSimilarCandidates]=useState<SimilarCandidate[]>([]);
  const [latestMaterialVersion,setLatestMaterialVersion]=useState(1);
  const [feedbackTarget,setFeedbackTarget]=useState<FeedbackTarget|null>(null);
  const [newChat,setNewChat]=useState(false);
  const [newTitle,setNewTitle]=useState('');
  const [newKind,setNewKind]=useState<'work'|'tutor'>('work');
  const [newSubject,setNewSubject]=useState('');
  const [creating,setCreating]=useState(false);
  const [contextQuery,setContextQuery]=useState('');
  const [drawerBusy,setDrawerBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [chatLoading,setChatLoading]=useState(false);
  const [aiConfigured,setAiConfigured]=useState(false);
  const [theme,setTheme]=useState('light');
  const [mobileNav,setMobileNav]=useState(false);
  const [toast,setToast]=useState('');
  const [defaults,setDefaults]=useState<{model:ModelId;effort:Effort}>({model:'gpt-6.1-sol',effort:'medium'});
  const [preferencesBusy,setPreferencesBusy]=useState(false);
  const [saveDone,setSaveDone]=useState(false);
  const newChatRef=useRef<HTMLElement>(null);
  const visibleIds=new Set(subjects.map(s=>s.id));
  const materials=storedMaterials;
  const chats=storedChats;
  const subject=subjects.find(s=>s.id===(currentChat&&['chat','tutor'].includes(section)?currentChat.subjectId:subjectId));
  const report = useCallback((error:unknown)=>{setToast(error instanceof Error?error.message:'Не получилось выполнить действие. Попробуйте ещё раз.');},[]);
  const refreshMaterials=useCallback(async()=>{const result=await request<{materials:Material[]}>('/api/materials');setMaterials(result.materials);},[]);
  const refreshChats=useCallback(async()=>{const result=await request<{chats:Chat[]}>('/api/chats');setChats(result.chats);setCurrentChat(current=>current ? result.chats.find(chat=>chat.id===current.id)??current : null);},[]);
  const refreshFeedback=useCallback(async()=>{const result=await request<{feedback:Feedback[]}>('/api/feedback');setFeedback(result.feedback);},[]);
  useEffect(()=> {
    const stored=localStorage.getItem('otmetki-theme');if(stored==='dark')setTheme('dark');
    Promise.allSettled([
      request<{subjects:Subject[]}>('/api/catalog').then(r=>{const preferred=profileDirection(initialViewer.group);const ordered=[...r.subjects].sort((a,b)=>Number(b.direction===preferred)-Number(a.direction===preferred)||a.name.localeCompare(b.name,'ru'));const start=ordered.find(s=>s.direction===preferred&&/математ/i.test(s.name))??ordered[0];setSubjects(ordered);setSubjectId(start?.id||'');setNewSubject(start?.id||'');}),
      refreshMaterials(),refreshChats(),refreshFeedback(),refreshPlatform(),
      request<{configured:{ai:boolean}}>('/api/session').then(r=>setAiConfigured(r.configured.ai)),
      request<{model:ModelId;effort:Effort}>('/api/preferences').then(setDefaults),
    ]).then(results=>{for(const r of results)if(r.status==='rejected')report(r.reason);setLoading(false);});
  },[refreshMaterials,refreshChats,refreshFeedback,report,initialViewer.group,refreshPlatform]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('otmetki-theme',theme);},[theme]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!newChat)return;
    const previous=document.activeElement as HTMLElement|null;
    newChatRef.current?.focus();
    const priorOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    function trap(e:KeyboardEvent){
      if(e.key!=='Tab')return;
      const controls=[...(newChatRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[])];
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);document.body.style.overflow=priorOverflow;previous?.focus();};
  },[newChat]);
  useEffect(()=>{
    function close(e:KeyboardEvent){if(e.key==='Escape'){setContextOpen(false);setMobileNav(false);setNewChat(false);}}
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[]);
  function navigate(next:Section){setSection(next);setMobileNav(false);if(next==='tutor'&&currentChat?.kind!=='tutor')setCurrentChat(null);if(next==='chat'&&currentChat?.kind==='tutor')setCurrentChat(null);}
  async function openChat(chat:Chat) {
    setChatLoading(true);setMobileNav(false);setSection(chat.kind==='tutor'?'tutor':'chat');
    try {const data=await request<{chat:Chat;messages:UIMessage[]}>(`/api/chats/${chat.id}`);setMessages(data.messages);setCurrentChat(data.chat);setSubjectId(chat.subjectId);}
    catch(err){report(err);}finally{setChatLoading(false);}
  }
  async function openMaterial(material:Material,version?:number) {
    try {
      const data=await request<{material:Material;latestVersion?:number;versions?:MaterialVersion[];similarCandidates?:SimilarCandidate[]}>(`/api/materials/${material.id}${version?`?version=${version}`:''}`);
      setMaterialOpen(data.material);setMaterialVersions(data.versions??[]);setSimilarCandidates(data.similarCandidates??[]);
      setLatestMaterialVersion(Math.max(data.material.version,data.latestVersion??0,...(data.versions??[]).map(item=>item.version)));
    }catch(error){report(error);}
  }
  async function patchChat(changes:Partial<Chat>) {
    if(!currentChat)return;
    const result=await request<{chat:Chat}>(`/api/chats/${currentChat.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
    const updated=result.chat;
    setCurrentChat(updated);setChats(existing=>existing.map(c=>c.id===updated.id?updated:c));
  }
  async function createChat() {
    if(!newSubject)return;
    setCreating(true);
    try {
      const result=await request<{chat:Chat}>('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subjectId:newSubject,kind:newKind,title:newTitle.trim()||undefined})});
      setChats(prev=>[result.chat,...prev]);setMessages([]);setCurrentChat(result.chat);setSection(newKind==='tutor'?'tutor':'chat');setSubjectId(newSubject);setNewChat(false);setNewTitle('');setContextOpen(true);
    }catch(err){report(err);}finally{setCreating(false);}
  }
  function showNewChat(kind:'work'|'tutor'='work'){if(!canAct(kind==='tutor'?'tutor':'chat')){report(new Error('Новые беседы этой функции сейчас недоступны. Сохранённая история остаётся у тебя.'));return;}setNewKind(kind);setNewSubject(subjectId||subjects[0]?.id||'');setNewChat(true);}
  async function toggleContext(id:string) {
    if(!currentChat)return;
    setDrawerBusy(true);
    try{await patchChat({contextIds:currentChat.contextIds.includes(id)?currentChat.contextIds.filter(m=>m!==id):[...currentChat.contextIds,id]});}catch(err){report(err);}finally{setDrawerBusy(false);}
  }
  async function exportContext() {
    if(!currentChat)return;
    setDrawerBusy(true);try{await downloadContext(currentChat.contextIds,currentChat.subjectId);}catch(err){report(err);}finally{setDrawerBusy(false);}
  }
  async function savePreferences() {
    setPreferencesBusy(true);setSaveDone(false);
    try {await request('/api/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(defaults)});setSaveDone(true);setTimeout(()=>setSaveDone(false),2500);}catch(err){report(err);}finally{setPreferencesBusy(false);}
  }
  async function logout(){try{await request('/api/auth/logout',{method:'POST'});window.location.assign('/');}catch(err){report(err);}}
  const readyMaterials=materials.filter(m=>['ready','limited'].includes(m.status));
  const subjectMaterials=materials.filter(m=>m.subjectId===subjectId);
  const contextMaterials=materials.filter(m=>m.subjectId===currentChat?.subjectId&&(!contextQuery||m.title.toLowerCase().includes(contextQuery.toLowerCase())));
  const telegramBack=useCallback(()=>{setSection('home');setContextOpen(false);setMaterialOpen(null);setMobileNav(false);},[]);
  const selectedFeature=platform?.features.find(f=>f.id===section);
  return <div className="workspace"><TelegramBridge canGoBack={section!=='home'||!!materialOpen||contextOpen} onBack={telegramBack}/>
    {mobileNav&&<button className="sidebar-scrim" aria-label="Закрыть навигацию" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('home');}}><img src="/mark.svg" alt=""/><span>{PRODUCT_NAME}<span className="brand-dot">.</span></span></a>
      <div className="workspace-badge"><span className="tiny-dot"/>{PRODUCT_FUNCTIONS}</div>
      <button className="new-chat-button" onClick={()=>showNewChat(section==='tutor'?'tutor':'work')} disabled={loading||!subjects.length}><Plus size={18}/><span>Новая беседа</span><span className="shortcut">↗</span></button>
      <span className="sidebar-label">ПРОСТРАНСТВО</span>
      <nav className="primary-nav">{sections.map(({id,label,icon:Icon})=><button aria-label={label} aria-current={section===id?'page':undefined} className={section===id?'nav-active':''} key={id} onClick={()=>navigate(id)}><Icon size={18}/><span>{label}{platform?.features.find(f=>f.id===id)&&<small className="nav-readiness">{readiness[platform.features.find(f=>f.id===id)!.status]}</small>}</span>{id==='materials'&&<span className="nav-count">{materials.length}</span>}{id==='feedback'&&feedback.some(f=>f.status!=='resolved')&&<span className="nav-dot"/>}</button>)}<a className="nav-contribute" href="/contribute"><GitBranch size={18}/><span>Разработка</span><ArrowUpRight size={13}/></a></nav>
      <div className="sidebar-divider"/><div className="sidebar-label-row"><span className="sidebar-label">НЕДАВНИЕ БЕСЕДЫ</span><button className="icon-button" aria-label="Добавить беседу" onClick={()=>showNewChat()}><Plus size={14}/></button></div>
      <div className="recent-chats">{chats.slice(0,6).map(chat=><button key={chat.id} onClick={()=>void openChat(chat)} className={currentChat?.id===chat.id&&['chat','tutor'].includes(section)?'recent-active':''}><MessageCircle size={14}/><span>{chat.title}</span></button>)}{!chats.length&&<p>Здесь появятся разговоры,<br />к которым хочется вернуться.</p>}</div>
      <div className="sidebar-bottom"><div className="preview-note"><ShieldCheck size={16}/><div><strong>Закрытая бета</strong><span>Доступ по подтверждённому профилю</span></div><span className="preview-led"/></div><div className="profile-row"><div className="profile-avatar">{initialViewer.displayName.charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{initialViewer.displayName}</strong><span>{initialViewer.group || 'Владелец пространства'}</span></div><button className="icon-button" onClick={()=>navigate('settings')} aria-label="Настройки"><Settings2 size={18}/></button></div></div>
    </aside>
    <div className="workspace-main">
      <div className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Открыть навигацию"><Menu size={21}/></button><span className="breadcrumb-audience">Первый курс</span><ChevronRight size={13}/><strong>{section==='home'?'Главная':section==='settings'?'Настройки':sections.find(s=>s.id===section)?.label}</strong></div><div className="topbar-right">{section==='home'&&repositoryUrl&&<a className="topbar-github" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="Открытый код на GitHub" title="Открытый код на GitHub"><GitBranch size={17}/><span>GitHub</span></a>}<span className="private-tag beta-tag"><span className="tiny-dot"/>Бета-версия</span><button className="beta-feedback-button" aria-label="Расскажи, что улучшить в бета-версии" title="Расскажи, что улучшить" onClick={()=>setFeedbackTarget(currentChat&&['chat','tutor'].includes(section)?{type:'chat',id:currentChat.id,title:currentChat.title}:{type:'general'})}><MessageCircle size={14}/><span>Что улучшить?</span></button><button className="icon-button theme-button" onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label={theme==='light'?'Тёмная тема':'Светлая тема'}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button></div></div>
      {loading?<main className="page-content"><div className="page-skeleton"><span/><span/><span/></div><p className="muted">Собираем твоё пространство…</p></main>:<>
      {selectedFeature&&<div className={'function-banner '+(selectedFeature.canAct?'':'function-readonly')}><strong>{readiness[selectedFeature.status]}</strong><span>{!selectedFeature.enabled?'Ты отключил новые действия. Сохранённые данные доступны по прежним правам.':selectedFeature.canAct?'Для твоего учебного профиля.':'Новые действия пока недоступны для твоего профиля. Доступная история сохраняется.'}</span></div>}{['schedule','work_calendar'].includes(section)&&<main className="page-content"><CourseCalendar key={section} kind={section==='schedule'?'lesson':'work'} subjects={subjects} audiences={platform?.audiences||[]} canAct={canAct(section)}/></main>}{section==='home'&&<main className="page-content home-page"><div className="home-topline"><span className="eyebrow">ЭКОНОМИЧЕСКИЙ ФАКУЛЬТЕТ · МГУ</span><span className="home-date">{new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(new Date())}</span></div><section className="beta-welcome"><Sparkles size={18}/><div><strong>Все новые возможности пока в бете.</strong><p>Расскажи, что неудобно, чего не хватает и что стоит доработать.</p></div><button className="text-button" onClick={()=>setFeedbackTarget({type:'general'})}>Поделиться мнением<ArrowRight size={15}/></button></section><section className="home-hero"><div><h1>Всё для учёбы.<br /><em>В одном месте.</em></h1><p>Материалы под рукой, мысли в порядке.<br />Выбери предмет — и продолжим оттуда, где ты остановился.</p><button className="btn btn-primary" onClick={()=>showNewChat()}><Sparkles size={17}/>Начать разговор<ArrowRight size={18}/></button></div><div className="hero-art" aria-hidden="true"><div className="hero-paper paper-back"/><div className="hero-paper paper-front"><span className="paper-label">МЕНЬШЕ СУЕТЫ. БОЛЬШЕ ЯСНОСТИ.</span><span className="paper-star">M</span><div className="paper-lines"><i/><i/><i/></div><span className="paper-bottom">Твои источники.<br />Твой контекст.</span></div><div className="hero-small-tag"><Check size={13}/>Всё на месте</div></div></section>
      <div className="home-metrics"><div><BookOpen size={18}/><strong>{materials.length}</strong><span>{plural(materials.length,'материал','материала','материалов')} в библиотеке</span></div><div><MessageCircle size={18}/><strong>{chats.length}</strong><span>{plural(chats.length,'сохранённая беседа','сохранённые беседы','сохранённых бесед')}</span></div><div><FolderOpen size={18}/><strong>{subjects.length}</strong><span>{plural(subjects.length,'предмет','предмета','предметов')}</span></div></div>
      <div className="section-title"><div><span className="eyebrow">ТВОЯ БИБЛИОТЕКА</span><h2>Начни с предмета.</h2></div><button className="text-button" onClick={()=>navigate('materials')}>Все материалы <ArrowRight size={16}/></button></div>
      <div className="subject-directions">{[...new Set(subjects.map(s=>s.direction))].map(direction=><section className="subject-direction" key={direction}><h3>{direction==='management'?'Менеджмент':'Экономика'}<span>{subjects.find(s=>s.direction===direction)?.group}</span></h3><div className="subject-grid">{subjects.filter(s=>s.direction===direction).map((s,index)=><button className="subject-card" key={s.id} onClick={()=>{setSubjectId(s.id);navigate('materials');}}><span className={`subject-icon subject-color-${index%5}`}><BookOpen size={21}/></span><span className="subject-meta">{s.group} · {s.semester} семестр</span><strong>{s.name}</strong><div><span>{materials.filter(m=>m.subjectId===s.id).length} {plural(materials.filter(m=>m.subjectId===s.id).length,'материал','материала','материалов')}</span><ArrowUpRight size={19}/></div></button>)}</div></section>)}</div>
      <div className="home-lower"><section><div className="section-title"><div><span className="eyebrow">ПОД РУКОЙ</span><h2>Свежие материалы.</h2></div></div>{materials.length?<div className="latest-materials">{materials.slice(0,3).map(m=><button key={m.id} className="latest-material" onClick={()=>void openMaterial(m)}><div className="file-icon"><FileText size={21}/></div><div><strong>{m.title}</strong><span>{kindNames[m.kind]} · {formatDate(m.createdAt)}{m.isExample?' · Пример':''}</span></div><ChevronRight size={16}/></button>)}</div>:<div className="home-empty-library"><FolderOpen size={28}/><p>Первый материал — начало хорошей библиотеки.</p><button className="text-button" onClick={()=>navigate('materials')}>Загрузить материал <ArrowRight size={15}/></button></div>}</section><section className="tutor-promo"><span className="eyebrow">РАЗБИРАЕМСЯ ВМЕСТЕ</span><GraduationCap size={31}/><h2>Не просто ответ.<br /><em>Понимание.</em></h2><p>Репетитор поможет пройти тему по шагам и проверить себя.</p><button className="text-button" onClick={()=>showNewChat('tutor')}>Начать занятие <ArrowUpRight size={18}/></button></section></div>
      </main>}
      {section==='materials'&&<main className="page-content materials-page"><MaterialLibrary audiences={platform?.audiences||[]} canAct={canAct('materials')} subjects={subjects} materials={materials} subjectId={subjectId} onSubjectChange={setSubjectId} onRefresh={refreshMaterials} onOpen={material=>void openMaterial(material)} onFeedback={m=>setFeedbackTarget({type:'material',id:m.id,version:m.version,title:m.title})}/></main>}
      {['chat','tutor'].includes(section)&&<main className={`chat-layout ${contextOpen&&currentChat?'has-context':''}`}>{chatLoading?<div className="chat-loading"><LoaderCircle className="spin" size={25}/><p>Открываем беседу…</p></div>:currentChat?<ChatCanvas canAct={canAct(section)} key={currentChat.id} chat={currentChat} initialMessages={messages} subject={subject} materials={materials} aiConfigured={aiConfigured} contextOpen={contextOpen} onContext={()=>setContextOpen(!contextOpen)} onChange={patchChat} onFinish={()=>void refreshChats().catch(report)} onReload={()=>void openChat(currentChat)} onMaterial={(material,version)=>void openMaterial(material,version)} onFeedback={()=>setFeedbackTarget({type:'chat',id:currentChat.id,title:currentChat.title})}/>:<div className="start-chat"><div className="chat-empty-mark">{section==='tutor'?<GraduationCap size={30}/>:<Sparkles size={30}/>}</div><span className="eyebrow">{section==='tutor'?'ТВОЙ УЧЕБНЫЙ ТЕМП':'ПРОСТРАНСТВО ДЛЯ МЫСЛЕЙ'}</span><h1>{section==='tutor'?<>Сложное становится<br /><em>понятным.</em></>:<>Начнём<br /><em>с хорошего вопроса.</em></>}</h1><p>{section==='tutor'?'Учимся по твоим лекциям и семинарам. Объясняем, пробуем, разбираем ошибки.':'Личный разговор по предмету, с выбранными материалами и сохранённой историей.'}</p><button className="btn btn-primary" onClick={()=>showNewChat(section==='tutor'?'tutor':'work')}><Plus size={17}/>{section==='tutor'?'Начать занятие':'Создать беседу'}<ArrowRight size={18}/></button>{chats.filter(c=>c.kind===(section==='tutor'?'tutor':'work')).length>0&&<div className="start-recent"><span className="eyebrow">ПРОДОЛЖИТЬ РАЗГОВОР</span>{chats.filter(c=>c.kind===(section==='tutor'?'tutor':'work')).slice(0,3).map(c=><button key={c.id} onClick={()=>void openChat(c)}><MessageCircle size={16}/>{c.title}<ArrowRight size={15}/></button>)}</div>}</div>}
      {currentChat&&contextOpen&&<><button className="context-scrim" aria-label="Закрыть материалы" onClick={()=>setContextOpen(false)}/><aside className="context-drawer"><header><div><span className="eyebrow">ИСТОЧНИКИ БЕСЕДЫ</span><h3>Твой контекст<span>.</span></h3></div><button className="icon-button" onClick={()=>setContextOpen(false)} aria-label="Закрыть материалы"><X size={19}/></button></header><p>Выбери материалы, на которые будет опираться агент. Повторяющиеся фрагменты читаются один раз.</p><label className="context-search"><Search size={16}/><input value={contextQuery} onChange={e=>setContextQuery(e.target.value)} placeholder="Найти материал" aria-label="Поиск материалов в контексте"/></label><div className="context-list">{currentChat.contextIds.some(id=>!materials.some(m=>m.id===id))&&<div className="library-notice"><p>Часть прежних источников больше недоступна. Старые ответы сохранены.</p><button className="text-button" disabled={drawerBusy||!canAct(section)} onClick={()=>void patchChat({contextIds:currentChat.contextIds.filter(id=>materials.some(m=>m.id===id))}).catch(report)}>Убрать недоступные источники</button></div>}{contextMaterials.map(m=><div className={`context-item ${currentChat.contextIds.includes(m.id)?'context-selected':''}`} key={m.id}><label><input type="checkbox" checked={currentChat.contextIds.includes(m.id)} disabled={drawerBusy||!canAct(section)||!['ready','limited'].includes(m.status)} onChange={()=>void toggleContext(m.id)}/><span className="context-check"><Check size={12}/></span></label><button className="context-item-title" onClick={()=>void openMaterial(m)}><strong>{m.title}</strong><span>{kindNames[m.kind]} · {statusNames[m.status]}{m.isExample?' · Пример':''}</span></button><button className="icon-button" title="Посмотреть материал" aria-label={`Посмотреть ${m.title}`} onClick={()=>void openMaterial(m)}><ChevronRight size={14}/></button></div>)}{!contextMaterials.length&&<div className="context-empty"><FolderOpen size={28}/><p>{contextQuery?'По этому запросу ничего не найдено.':'Добавь материалы этого предмета в библиотеку.'}</p><button className="text-button" onClick={()=>{setSubjectId(currentChat.subjectId);setContextOpen(false);navigate('materials');}}>Открыть библиотеку <ArrowRight size={14}/></button></div>}</div><footer><div className="context-summary"><span>Подключено</span><strong>{currentChat.contextIds.length} из {materials.filter(m=>m.subjectId===currentChat.subjectId).length}</strong></div><button className="btn btn-secondary" onClick={()=>void exportContext()} disabled={drawerBusy||!currentChat.contextIds.length}>{drawerBusy?<LoaderCircle size={16} className="spin"/>:<Download size={16}/>}Скачать TXT без дублей</button><span className="small muted">Исходники сохраняются. TXT включает ссылки на источники и ограничения распознавания.</span></footer></aside></>}
      </main>}
      {section==='feedback'&&<main className="page-content feedback-page"><FeedbackPanel items={feedback} onRefresh={refreshFeedback} onCreate={()=>setFeedbackTarget({type:'general'})}/></main>}
      {section==='settings'&&<main className="page-content settings-page"><span className="eyebrow">ПОД СВОЙ ТЕМП</span><h1>Настройки<span className="brand-dot">.</span></h1><p className="page-intro">Новые беседы начинаются с твоего выбора. Внутри каждого чата его можно изменить.</p><section className="settings-card"><div className="settings-heading"><Sparkles size={22}/><div><h3>Твой ИИ</h3><p>Бесплатно. Без скрытой смены модели.</p></div></div><label className="field"><span>Модель для новых бесед</span><select value={defaults.model} onChange={e=>setDefaults({...defaults,model:e.target.value as ModelId})}><option value="gpt-6.1-sol">GPT‑6.1 Sol</option><option value="gpt-6-luna">GPT‑6 Luna</option></select></label><label className="field"><span>Уровень размышлений</span><select value={defaults.effort} onChange={e=>setDefaults({...defaults,effort:e.target.value as Effort})}>{Object.entries(efforts).map(([id,label])=><option key={id} value={id}>{label} · {id}</option>)}</select></label><button className="btn btn-primary" disabled={preferencesBusy} onClick={()=>void savePreferences()}>{preferencesBusy?<LoaderCircle size={17} className="spin"/>:saveDone?<Check size={17}/>:null}{saveDone?'Сохранено':'Сохранить выбор'}</button></section><section className="settings-card"><div className="settings-heading"><Sun size={22}/><div><h3>Внешний вид</h3><p>Тёплый светлый или спокойный тёмный.</p></div></div><div className="theme-choice"><button className={theme==='light'?'theme-selected':''} onClick={()=>setTheme('light')}><Sun size={20}/>Светлая{theme==='light'&&<Check size={16}/>}</button><button className={theme==='dark'?'theme-selected':''} onClick={()=>setTheme('dark')}><Moon size={20}/>Тёмная{theme==='dark'&&<Check size={16}/>}</button></div></section>{platform&&<PlatformSettings state={platform} owner={initialViewer.role==='owner'} onRefresh={refreshPlatform} onReview={m=>void openMaterial(m)}/ >}<section className="settings-card settings-session"><ShieldCheck size={21}/><div><h3>Закрытое пространство</h3><p>Доступ проверяется на сервере. Эти действия не затрагивают рабочий бот.</p></div><button className="btn btn-secondary" onClick={()=>void logout()}><LogOut size={16}/>Выйти</button></section></main>}
      </>}
    </div>
    {materialOpen&&<MaterialDetail audiences={platform?.audiences||[]} canAct={canAct('materials')} candidates={materials} onArchive={()=>void refreshMaterials().catch(report)} material={materialOpen} latestVersion={latestMaterialVersion} versions={materialVersions} similarCandidates={similarCandidates} onVersion={version=>openMaterial(materialOpen,version)} onClose={()=>setMaterialOpen(null)} onUpdate={m=>{setMaterialOpen(m);setLatestMaterialVersion(Math.max(latestMaterialVersion,m.version));setMaterials(prev=>prev.map(item=>item.id===m.id&&m.version>=item.version?m:item));void refreshMaterials().catch(report);}} onFeedback={m=>setFeedbackTarget({type:'material',id:m.id,version:m.version,title:m.title})}/>}
    {feedbackTarget&&<FeedbackDialog target={feedbackTarget} onClose={()=>setFeedbackTarget(null)} onSaved={async()=>{await refreshFeedback();setToast('Комментарий сохранён. Продолжить обсуждение можно в обратной связи.');}}/>}
    {newChat&&<div className="modal-backdrop" onClick={()=>setNewChat(false)}><section className="modal new-chat-modal" ref={newChatRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="new-chat-title" onClick={e=>e.stopPropagation()}><button className="icon-button modal-close" onClick={()=>setNewChat(false)} aria-label="Закрыть"><X size={20}/></button><span className="eyebrow">НОВАЯ ТОЧКА ОТСЧЁТА</span><h2 id="new-chat-title">{newKind==='tutor'?'Разберёмся вместе.':'Начнём разговор.'}</h2><p>Выбери предмет. Материалы можно подключить перед первым сообщением.</p><div className="conversation-kind"><button className={newKind==='work'?'selected':''} onClick={()=>setNewKind('work')}><MessageCircle size={18}/>Беседа</button><button className={newKind==='tutor'?'selected':''} onClick={()=>setNewKind('tutor')}><GraduationCap size={19}/>Репетитор</button></div><label className="field"><span>Предмет</span><select value={newSubject} onChange={e=>setNewSubject(e.target.value)}>{subjects.map(s=><option key={s.id} value={s.id}>{s.name} · {s.group}</option>)}</select></label><label className="field"><span>Название <span className="muted">· необязательно</span></span><input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Например, подготовка к самостоятельной" maxLength={150}/></label><div className="new-chat-footnote"><BookOpen size={16}/><span>Лекции и семинары предмета подключаются по умолчанию. Выбор можно изменить.</span></div><button className="btn btn-primary" disabled={creating||!newSubject} onClick={()=>void createChat()}>{creating?<LoaderCircle className="spin" size={17}/>:<Plus size={17}/>}Создать<ArrowRight size={18}/></button></section></div>}
    {toast&&<div className="toast" role="status"><span>{toast}</span><button className="icon-button" onClick={()=>setToast('')} aria-label="Закрыть уведомление"><X size={16}/></button></div>}
  </div>;
}
