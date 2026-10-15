'use client';
import {PRODUCT_NAME,PRODUCT_TITLE,PRODUCT_FUNCTIONS} from '@/lib/brand';

import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Check, ChevronDown, Copy, Download, FileText, LoaderCircle, MessageSquare, PanelRightClose, PanelRightOpen, RotateCcw, Sparkles, Square, ThumbsDown } from 'lucide-react';
import type { Chat, Material, ModelId, Effort, Subject } from '@/lib/types';
import { request } from './client-api';
import { createPreviewChat } from './chat-client';
import { normalizeMathDelimiters } from './math-text';

const effortNames: Record<Effort,string> = { low:'Быстро', medium:'Сбалансированно',high:'Вдумчиво',xhigh:'Глубоко',max:'Максимально' };
const math = createMathPlugin({ singleDollarTextMath: true });
interface Props {
  canAct?:boolean;chat: Chat; initialMessages: UIMessage[]; subject?: Subject; materials: Material[]; aiConfigured: boolean;
  contextOpen: boolean; onContext:()=>void; onChange:(changes:Partial<Chat>)=>Promise<void>; onFinish:()=>void;
  onMaterial:(material:Material,version?:number)=>void; onFeedback:()=>void; onReload:()=>void;
}
interface MessageSnapshot { model?: ModelId; effort?: Effort; contextSources?: {id:string;version:number}[]; status?:string; }

export default function ChatCanvas({canAct=true,chat,initialMessages,subject,materials,aiConfigured,contextOpen,onContext,onChange,onFinish,onMaterial,onFeedback,onReload}: Props) {
  const [input,setInput] = useState('');
  const [localError,setLocalError] = useState('');
  const [changing,setChanging] = useState(false);
  const [copied,setCopied] = useState('');
  const [atBottom,setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const finishRef=useRef(onFinish);finishRef.current=onFinish;
  const clientChat=useMemo(()=>createPreviewChat({id:chat.id,messages:initialMessages,onFinish:()=>finishRef.current()}),[chat.id]);
  const {messages,status,error,sendMessage,stop,clearError,resumeStream} = useChat({chat:clientChat,resume:['submitted','streaming'].includes(chat.generationState)});
  const disconnectTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{
    clearTimeout(disconnectTimer.current);
    return ()=>{
      // Defer to avoid cancelling React Strict Mode's immediate effect remount.
      // This releases the reader only; it never calls the server stop endpoint.
      disconnectTimer.current=setTimeout(()=>void clientChat.stop(),0);
    };
  },[clientChat]);
  const generating = status==='submitted'||status==='streaming';
  const selected = materials.filter(m=>chat.contextIds.includes(m.id));
  const lastSnapshot=messages.filter(message=>message.role==='assistant').at(-1)?.metadata as MessageSnapshot|undefined;
  const changedSources=lastSnapshot?.contextSources?.filter(source=>selected.some(material=>material.id===source.id&&material.version!==source.version))??[];
  const staleMaterials=changedSources.length>0;
  useEffect(()=> {
    if (atBottom && scroller.current) scroller.current.scrollTop=scroller.current.scrollHeight;
  },[messages,status,atBottom]);
  useEffect(()=>{
    if(textarea.current){textarea.current.style.height='auto';textarea.current.style.height=`${Math.min(textarea.current.scrollHeight,180)}px`;}
  },[input]);
  async function submit(text=input) {
    const content=text.trim(); if(!content||generating||!aiConfigured||!canAct)return;
    setInput('');setLocalError('');clearError();setAtBottom(true);
    try {await sendMessage({text:content});} catch {setLocalError('Ответ не завершился. Уже полученный текст остаётся в беседе.');}
  }
  async function regenerate(){const last=messages.filter(m=>m.role==='user').at(-1);if(!last||generating||!canAct)return;setChanging(true);setLocalError('');try{await request(`/api/chats/${chat.id}/regenerate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedMessageId:last.id})});await resumeStream();}catch(e){setLocalError(e instanceof Error?e.message:'Не удалось пересоздать ответ.');}finally{setChanging(false);}}
  async function stopResponse() {
    try {await request(`/api/chats/${chat.id}/stop`,{method:'POST'}); await stop(); onFinish();}
    catch(err){setLocalError(err instanceof Error?err.message:'Не получилось остановить ответ.');}
  }
  async function change(model:ModelId,effort:Effort) {
    setChanging(true);setLocalError('');
    try {await onChange({model,effort});}catch(err){setLocalError(err instanceof Error?err.message:'Не получилось сохранить выбор.');}finally{setChanging(false);}
  }
  async function copy(message:UIMessage) {
    try {await navigator.clipboard.writeText(message.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n'));setCopied(message.id);setTimeout(()=>setCopied(''),2000);}catch{setLocalError('Браузер не разрешил копирование. Можно выделить текст вручную.');}
  }
  return <section className="chat-canvas">
    <header className="chat-header"><div><span className="eyebrow">{chat.kind==='tutor'?'РЕПЕТИТОР':'ЛИЧНАЯ БЕСЕДА'}</span><h2>{chat.title}</h2><span className="chat-subtitle">{subject?.name ?? 'Учебное пространство'}</span></div><div className="chat-header-actions"><button className={`btn btn-secondary ${contextOpen?'active':''}`} onClick={onContext}>{contextOpen?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}<span>Материалы</span><span className="count-badge">{selected.length}</span></button>{messages.some(m=>m.role==='assistant')&&<a className="icon-button" href={`/api/chats/${chat.id}/export?format=docx`} aria-label="Скачать беседу в Word" title="Скачать в Word"><Download size={18}/></a>}</div></header>
    {staleMaterials&&<div className="chat-notice"><RotateCcw size={17}/><span>Использованные источники обновлены: {changedSources.map(source=>selected.find(material=>material.id===source.id)?.title).join(', ')}. Старый ответ сохранён.</span><button onClick={()=>void regenerate()} disabled={generating||!aiConfigured||!canAct||changing}>Пересоздать</button></div>}
    {!generating&&chat.generationState==='stopped'&&<div className="chat-notice"><Square size={14}/><span>Ответ остановлен. Полученный текст сохранён; можно продолжить разговор.</span></div>}
    {!generating&&chat.generationState==='error'&&<div className="chat-notice"><MessageSquare size={15}/><span>Предыдущий ответ не завершился. Полученный текст сохранён; можно отправить уточнение или повторить вопрос.</span></div>}
    {!generating&&['submitted','streaming'].includes(chat.generationState)&&<div className="chat-notice"><LoaderCircle size={15} className="spin"/><span>Ответ ещё готовится на сервере.</span><button onClick={onReload}>Обновить беседу</button><button onClick={()=>void stopResponse()}>Остановить</button></div>}
    <div className="conversation-scroll" ref={scroller} onScroll={()=>{const el=scroller.current;if(el)setAtBottom(el.scrollHeight-el.scrollTop-el.clientHeight<120);}}>
      {messages.length===0?<div className="chat-empty"><div className="chat-empty-mark"><Sparkles size={29}/></div><span className="eyebrow">{chat.kind==='tutor'?'РАЗБЕРЁМСЯ ВМЕСТЕ':'НАЧНЁМ С ТВОЕГО ВОПРОСА'}</span><h1>{chat.kind==='tutor'?<>Понимание приходит<br /><em>через разговор.</em></>:<>Хорошие вопросы.<br /><em>Ясные ответы.</em></>}</h1><p>{chat.kind==='tutor'?'Пойдём по шагам: объяснение, твоя попытка и разбор. Можно начать с любой темы.':'Подключи нужные лекции и семинары, задай вопрос или попроси помочь с заданием.'}</p><div className="chat-prompts">{(chat.kind==='tutor'?['Объясни тему простыми словами','Помоги разобраться в задаче','Давай проверим, что я понимаю']:['Разбери выбранные материалы','Что самое важное в этой теме?','Помоги составить план решения']).map((text,index)=><button disabled={generating||!aiConfigured||!canAct||changing} onClick={()=>void submit(text)} key={text}><span className="prompt-number">0{index+1}</span>{text}<ArrowUp size={16}/></button>)}</div></div>:<div className="conversation-inner">{messages.map(message=> { const snapshot=message.metadata as MessageSnapshot|undefined; const actualModel=snapshot?.model??chat.model; const actualEffort=snapshot?.effort&&effortNames[snapshot.effort]?snapshot.effort:chat.effort; return <article className={`message message-${message.role}`} key={message.id}><div className="message-avatar">{message.role==='user'?<span>Ты</span>:<span>{PRODUCT_NAME}</span>}</div><div className="message-content"><div className="message-author">{message.role==='user'?'Ты':actualModel==='gpt-6.1-sol'?'Sol':'Luna'}{message.role==='assistant'&&<span>· {effortNames[actualEffort]}</span>}</div>{message.parts.map((part,index)=>{
        if(part.type==='text')return <Streamdown key={index} mode={generating?'streaming':'static'} isAnimating={generating&&message.id===messages.at(-1)?.id} plugins={{math}} skipHtml className="message-markdown">{normalizeMathDelimiters(part.text)}</Streamdown>;
        if(part.type==='source-document'){const source=materials.find(m=>m.id===part.sourceId);return <button key={index} className="source-chip" onClick={()=>source?onMaterial(source,snapshot?.contextSources?.find(item=>item.id===source.id)?.version):onContext()}><FileText size={14}/>{part.title}</button>;}
        if(part.type==='source-url'&&/^https?:\/\//i.test(part.url))return <a className="source-chip" href={part.url} target="_blank" rel="noopener noreferrer" key={index}><BookOpen size={14}/>{part.title||'Источник'}</a>;
        if(part.type.startsWith('tool-')||part.type==='dynamic-tool')return <div className="tool-status" key={index}><BookOpen size={15}/>{(part as {state?:string}).state==='output-available'?'Учебные материалы проверены':'Проверяю учебные материалы'}</div>;
        return null;
      })}{message.role==='assistant'&&snapshot?.status==='stopped'&&<div className="message-state-note"><Square size={12}/>Остановленный ответ · текст сохранён</div>}{message.role==='assistant'&&snapshot?.status==='error'&&<div className="message-state-note"><MessageSquare size={12}/>Ответ не завершён · полученный текст сохранён</div>}{message.role==='assistant'&&!generating&&<div className="message-actions"><button className="icon-button" onClick={()=>void copy(message)} title="Скопировать ответ" aria-label="Скопировать ответ">{copied===message.id?<Check size={15}/>:<Copy size={15}/>}</button><button className="icon-button" onClick={onFeedback} title="Сообщить об ошибке" aria-label="Сообщить об ошибке"><ThumbsDown size={15}/></button><a className="message-download" href={`/api/chats/${chat.id}/export?format=docx`}><FileText size={14}/>Word</a></div>}</div></article>;})}{status==='submitted'&&<div className="message message-assistant"><div className="message-avatar"><img src="/mark.svg" alt=""/></div><div className="thinking"><span/><span/><span/><span className="thinking-label">Собираю ответ</span></div></div>}</div>}
    </div>
    {!atBottom&&messages.length>0&&<button className="jump-bottom" onClick={()=>{setAtBottom(true);scroller.current?.scrollTo({top:scroller.current.scrollHeight,behavior:'smooth'});}}><ChevronDown size={16}/>К последнему ответу</button>}
    <div className="composer-wrap">
      {(error||localError)&&<div className="error-note" role="alert">{localError||error?.message}<button onClick={()=>{clearError();setLocalError('');}}>Закрыть</button></div>}
      {!aiConfigured&&<div className="chat-notice"><MessageSquare size={17}/><span>ИИ пока не подключён. Материалы, выбор контекста и сохранённые беседы доступны.</span></div>}
      <form className="composer" onSubmit={e=>{e.preventDefault();void submit();}}><textarea ref={textarea} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}} placeholder={chat.kind==='tutor'?'В какой теме разберёмся?':'Спроси, уточни или приложи контекст…'} aria-label="Сообщение" rows={1} disabled={!aiConfigured||!canAct}/><div className="composer-footer"><div className="composer-controls"><label className="compact-select" title="Модель"><Sparkles size={14}/><select value={chat.model} disabled={generating||changing||!canAct} aria-label="Модель" onChange={e=>void change(e.target.value as ModelId,chat.effort)}><option value="gpt-6.1-sol">Sol</option><option value="gpt-6-luna">Luna</option></select></label><span className="control-divider"/><label className="compact-select" title="Уровень размышлений"><select value={chat.effort} disabled={generating||changing||!canAct} aria-label="Уровень размышлений" onChange={e=>void change(chat.model,e.target.value as Effort)}>{Object.entries(effortNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button className="context-count" type="button" onClick={onContext}><BookOpen size={15}/><span>{selected.length} {selected.length===1?'материал':selected.length<5?'материала':'материалов'}</span></button></div>{generating?<button className="send-button stop-button" type="button" onClick={()=>void stopResponse()} aria-label="Остановить ответ"><Square size={15} fill="currentColor"/></button>:<button className="send-button" type="submit" disabled={!input.trim()||!aiConfigured||changing||!canAct} aria-label="Отправить сообщение"><ArrowUp size={20}/></button>}</div></form>
      <div className="composer-caption"><span>ИИ может ошибаться. Проверяй важное по источникам.</span><span>Enter — отправить · Shift + Enter — перенос</span></div>
    </div>
  </section>;
}
