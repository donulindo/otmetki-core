'use client';

import { useEffect, useRef, useState, useMemo, useDeferredValue } from 'react';
import {
  AlertCircle, Archive, List, LayoutGrid, ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, FileImage,
  FileText, Layers3, LoaderCircle, MessageSquare, Plus, Search, UploadCloud, X,
} from 'lucide-react';
import type { Material, MaterialKind, MaterialStatus, Subject } from '@/lib/types';
import type {StudyAudience} from './platform-types';
import { request } from './client-api';
import { isLinkOnly,hasOriginal } from './material-source';
import {buildCourseSections,courseType,isCourseInfo,libraryTypeNames,matchesLibraryQuery,type LibraryType} from './course-library';
import {plural} from './client-api';

interface Props {
  audiences?:StudyAudience[];canAct?:boolean;
  subjects: Subject[];
  materials: Material[];
  subjectId: string;
  onSubjectChange: (id: string) => void;
  onRefresh: () => Promise<void>;
  onOpen: (material: Material) => void;
  onFeedback: (material: Material) => void;
}

const KIND_LABELS: Record<MaterialKind, string> = {
  lecture: 'Лекция', seminar: 'Семинар', homework: 'Задание', rules: 'Правила курса', notes: 'Заметки',
};
const STATUS_LABELS: Record<MaterialStatus, string> = {
  queued: 'В очереди', extracting: 'Получаем текст', ready: 'Готов для ИИ',
  limited: 'Нужна сверка', error: 'Ошибка обработки',
};

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

function fileType(material: Material) {
  if (isLinkOnly(material)) return 'ССЫЛКА';if(!hasOriginal(material))return 'ТЕКСТ';
  return material.filename.split('.').pop()?.toUpperCase() || 'ФАЙЛ';
}

async function readMaterial(response: Response): Promise<Material> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Не удалось сохранить материал. Попробуй ещё раз.');
  return body.material ?? body;
}

interface UploadEntry {
  id: string;
  file: File;
  state: 'pending' | 'uploading' | 'uploaded' | 'error';
  material?: Material;
  error?: string;
}

function filenameTitle(filename: string) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 180);
}

function UploadDialog({ subjects, audiences=[], initialSubjectId, onClose, onUploaded }: {
  audiences?:StudyAudience[];subjects: Subject[]; initialSubjectId: string; onClose: () => void;
  onUploaded: (materials: Material[], complete: boolean) => Promise<void>;
}) {
  const [audienceId,setAudienceId]=useState('');
  const [mode, setMode] = useState<'files' | 'link'>('files');
  const [sourceUrl, setSourceUrl] = useState('');
  const [savedLink, setSavedLink] = useState<Material | null>(null);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState(initialSubjectId || subjects[0]?.id || '');
  const [kind, setKind] = useState<MaterialKind>('lecture');
  const [topic, setTopic] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [href]');
        if (!elements?.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previousFocus?.focus(); };
  }, [busy, onClose]);

  function chooseFiles(files: FileList | File[] | null) {
    if (!files || busy) return;
    const nextEntries = [...entries];
    const errors: string[] = [];
    for (const next of Array.from(files)) {
      if (nextEntries.some((entry) => entry.file.name === next.name && entry.file.size === next.size && entry.file.lastModified === next.lastModified)) continue;
      if (nextEntries.length >= 20) {
        errors.push('За одну загрузку можно добавить до 20 файлов.');
        break;
      }
      const photo = next.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(next.name);
      const limit = (photo ? 40 : 100) * 1024 * 1024;
      if (next.size > limit) {
        errors.push(`«${next.name}» не добавлен: ${photo ? 'фотографии — до 40 МБ.' : 'документы — до 100 МБ.'}`);
        continue;
      }
      nextEntries.push({ id: crypto.randomUUID(), file: next, state: 'pending' });
    }
    setEntries(nextEntries);
    setError(errors.join(' '));
    if (!entries.length && nextEntries.length === 1) setTitle(filenameTitle(nextEntries[0].file.name));
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'link') {
      if (!title.trim() || !sourceUrl.trim() || !subjectId || busy) return;
      setBusy(true); setError('');
      try {
        let material = savedLink;
        if (!material) {
          const url = new URL(sourceUrl.trim());
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Используй ссылку http:// или https:// без данных для входа.');
          material = await readMaterial(await fetch('/api/materials', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title.trim(), subjectId, kind, topic: topic.trim(), sourceUrl: url.href,audienceId:audienceId||undefined }),
          }));
          setSavedLink(material);
        }
        try { await onUploaded([material], true); setRefreshNeeded(false); }
        catch { setRefreshNeeded(true); setError('Ссылка сохранена, но библиотеку не удалось обновить. Повторная попытка обновит список, не создавая ещё одну ссылку.'); }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не удалось сохранить ссылку.');
      } finally { setBusy(false); }
      return;
    }
    if (!entries.length || (entries.length === 1 && !title.trim()) || !subjectId || busy) return;
    setBusy(true);
    setError('');
    const working = entries.map((entry) => ({ ...entry }));
    const remaining = working.filter((entry) => entry.state !== 'uploaded');
    setProgress({ completed: 0, total: remaining.length });
    try {
      for (let index = 0; index < remaining.length; index++) {
        const entry = remaining[index];
        entry.state = 'uploading'; entry.error = undefined;
        setEntries([...working]);
        try {
          const form = new FormData();
          form.set('file', entry.file);
          form.set('title', working.length === 1 ? title.trim() : filenameTitle(entry.file.name));
          form.set('subjectId', subjectId);
          form.set('kind', kind);
          form.set('topic', topic.trim());if(audienceId)form.set('audienceId',audienceId);
          entry.material = await readMaterial(await fetch('/api/materials/upload', { method: 'POST', body: form }));
          entry.state = 'uploaded';
        } catch (cause) {
          entry.state = 'error';
          entry.error = cause instanceof Error ? cause.message : 'Не удалось загрузить файл.';
        }
        setEntries([...working]);
        setProgress({ completed: index + 1, total: remaining.length });
      }
      const successful = working.flatMap((entry) => entry.material ? [entry.material] : []);
      const complete = working.every((entry) => entry.state === 'uploaded');
      if (successful.length) {
        try {
          await onUploaded(successful, complete);
          setRefreshNeeded(false);
        } catch {
          setRefreshNeeded(true);
          setError('Файлы сохранены, но библиотеку не удалось обновить. Повторная попытка обновит список — сохранённые файлы не будут загружаться заново.');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить файл.');
    } finally { setBusy(false); setProgress(null); }
  }

  const uploadedCount = entries.filter((entry) => entry.state === 'uploaded').length;
  const failedCount = entries.filter((entry) => entry.state === 'error').length;
  const allUploaded = entries.length > 0 && uploadedCount === entries.length;
  const lockedMetadata = busy || uploadedCount > 0 || !!savedLink;
  const canSubmit = mode === 'link'
    ? !!title.trim() && !!sourceUrl.trim() && !!subjectId && (!savedLink || refreshNeeded)
    : !!entries.length && (entries.length !== 1 || !!title.trim()) && !!subjectId && (!allUploaded || refreshNeeded);

  return (
    <div className="modal-backdrop library-upload-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal-panel library-upload-panel" role="dialog" aria-modal="true" aria-labelledby="upload-heading" tabIndex={-1} ref={panelRef}>
        <div className="library-dialog-heading">
          <div><span className="eyebrow">ПОПОЛНИМ БИБЛИОТЕКУ</span><h2 id="upload-heading">Добавить материал</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть загрузку" disabled={busy}><X size={22} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="library-upload-modes" role="tablist" aria-label="Как добавить материал"><button type="button" role="tab" aria-selected={mode === 'files'} className={mode === 'files' ? 'is-active' : ''} disabled={busy || uploadedCount > 0 || !!savedLink} onClick={() => { setMode('files'); setError(''); }}><FileText size={16} />Файлы</button><button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'is-active' : ''} disabled={busy || uploadedCount > 0 || !!savedLink} onClick={() => { setMode('link'); setError(''); }}><ArrowUpRight size={16} />Ссылка</button></div>
          {mode === 'files' ? <>
          <input ref={inputRef} type="file" hidden multiple accept=".pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg,.webp" onChange={(event) => chooseFiles(event.target.files)} />
          <button type="button" className={`library-dropzone${dragging ? ' is-dragging' : ''}${entries.length ? ' has-file' : ''}`} disabled={busy || entries.length >= 20}
            onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) chooseFiles(event.dataTransfer.files); }}>
            <span className="library-drop-icon">{entries.length ? <Check size={26} /> : <UploadCloud size={28} />}</span>
            <strong>{entries.length ? `${entries.length} из 20 файлов выбрано` : 'Перетащи файлы сюда'}</strong>
            <span>{entries.length ? 'Нажми, чтобы добавить ещё' : 'или выбери на устройстве — до 20 сразу'}</span>
            <small>PDF, Word, презентации, TXT и фотографии<br />Документы до 100 МБ · фотографии до 40 МБ каждый</small>
          </button>
          {entries.length > 0 && <div className="library-file-list"><div className="library-file-list-heading"><span>Выбрано файлов: {entries.length}</span><button type="button" className="button-quiet" disabled={busy} onClick={() => { setEntries([]); setTitle(''); setError(''); setRefreshNeeded(false); }}>Очистить список</button></div>{entries.map((entry) => <div className={`library-file-row upload-${entry.state}`} key={entry.id}><span className="library-file-icon">{entry.state === 'uploading' ? <LoaderCircle size={17} className="spin" /> : entry.state === 'uploaded' ? <Check size={17} /> : <FileText size={17} />}</span><div className="library-file-info"><strong>{entry.file.name}</strong><span>{fileSize(entry.file.size)}{entry.state === 'uploaded' ? ' · сохранён' : entry.state === 'uploading' ? ' · загружаем' : ''}</span>{entry.error && <p role="alert">{entry.error}</p>}</div><button type="button" className="icon-button" disabled={busy} aria-label={`Убрать ${entry.file.name} из списка`} onClick={() => { const next = entries.filter((item) => item.id !== entry.id); setEntries(next); if (next.length === 1) setTitle(next[0].material?.title || filenameTitle(next[0].file.name)); }}><X size={15} /></button></div>)}</div>}
          </> : <div className="library-link-fields"><label className="field">Адрес ссылки<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.org/…" maxLength={2000} required disabled={lockedMetadata} /></label><p className="library-upload-note">Ссылка сохранится в библиотеке. Содержимое сайта пока не загружается и не добавляется в контекст ИИ.</p></div>}
          {mode === 'link' || entries.length <= 1 ? <label className="field">Название<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="Например, производные и их применение" required disabled={busy || allUploaded || !!savedLink} /></label> : <p className="library-upload-note">Названия возьмём из имён файлов. Предмет, тип и тема применяются ко всей подборке.</p>}
          <div className="library-form-row">
            <label className="field">Предмет<span className="select-wrap"><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={lockedMetadata} required>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><ChevronDown size={16} /></span></label>
            <label className="field">Тип материала<span className="select-wrap"><select value={kind} onChange={(event) => setKind(event.target.value as MaterialKind)} disabled={lockedMetadata}>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={16} /></span></label>
          </div>
          <label className="field">Доступ<select value={audienceId} disabled={lockedMetadata} onChange={e=>setAudienceId(e.target.value)}><option value="">Личный · только тебе</option>{audiences.filter(a=>!a.archived&&a.subjectIds.includes(subjectId)).map(a=><option value={a.id} key={a.id}>{a.label} · {a.scope==='group'?'группа':'поток'}</option>)}</select></label>{audienceId&&<p className="library-upload-note">После обработки опубликуем отдельную общую копию. Дальнейшие личные изменения останутся личными.</p>}<label className="field">Тема <span className="field-optional">необязательно</span><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={180} placeholder="Поможет быстро найти материал" disabled={lockedMetadata} /></label>
          {mode === 'files' && <p className="library-upload-note">Оригинал останется в библиотеке. Статус покажет, когда извлечённый текст можно использовать в чате.</p>}
          {progress && progress.total > 0 && <p className="library-batch-progress" role="status">Обработано загрузок: {progress.completed} из {progress.total}. {uploadedCount > 0 && `Сохранено файлов: ${uploadedCount}.`}</p>}
          {mode === 'files' && !busy && failedCount > 0 && <p className="library-batch-progress" role="status">Сохранено: {uploadedCount}. Не удалось загрузить: {failedCount}. Повторим только неудачные загрузки.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="library-dialog-actions"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>{uploadedCount > 0 || savedLink ? 'Закрыть' : 'Отмена'}</button><button type="submit" className="button-primary" disabled={!canSubmit || busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Plus size={18} />}{busy ? mode === 'link' ? 'Сохраняем…' : 'Загружаем…' : refreshNeeded && (allUploaded || savedLink) ? 'Обновить библиотеку' : failedCount > 0 && mode === 'files' ? 'Повторить неудачные загрузки' : 'Добавить в библиотеку'}</button></div>
        </form>
      </div>
    </div>
  );
}

export default function MaterialLibrary({ audiences=[],canAct=true,subjects, materials, subjectId, onSubjectChange, onRefresh, onOpen, onFeedback }: Props) {
  const [scopeFilter,setScopeFilter]=useState('all');
  const [archived,setArchived]=useState<Material[]|null>(null);
  const [archiveError,setArchiveError]=useState('');
  const [archiveBusy,setArchiveBusy]=useState(false);
  const [query,setQuery]=useState('');
  const deferredQuery=useDeferredValue(query);
  const [kindFilter,setKindFilter]=useState<LibraryType>('all');
  const [layout,setLayout]=useState<'list'|'cards'>('list');
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [uploadOpen,setUploadOpen]=useState(false);
  const [uploadResult,setUploadResult]=useState('');
  const refreshRef=useRef(onRefresh);refreshRef.current=onRefresh;
  const hasPending=materials.some(m=>m.status==='queued'||m.status==='extracting');
  useEffect(()=>{try{if(localStorage.getItem('msu-library-layout')==='cards')setLayout('cards');}catch{}},[]);
  useEffect(()=>{setKindFilter('all');setScopeFilter('all');setQuery('');setCollapsed(new Set());window.scrollTo({top:0,left:0,behavior:'instant'});},[subjectId]);
  useEffect(()=>{
    if(!hasPending)return;
    let busy=false;
    const timer=window.setInterval(async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{await refreshRef.current();}catch{}finally{busy=false;}},3000);
    return()=>window.clearInterval(timer);
  },[hasPending]);
  function changeLayout(next:'list'|'cards'){setLayout(next);try{localStorage.setItem('msu-library-layout',next);}catch{}}
  function reset(){setScopeFilter('all');setKindFilter('all');setQuery('');setCollapsed(new Set());}
  function toggleSection(key:string){setCollapsed(old=>{const next=new Set(old);if(next.has(key))next.delete(key);else next.add(key);return next;});}
  async function showArchive(){setArchiveBusy(true);setArchiveError('');try{setArchived((await request<{archived:Material[]}>('/api/library')).archived);}catch(e){setArchiveError(e instanceof Error?e.message:'Архив недоступен.');}finally{setArchiveBusy(false);}}
  async function restore(m:Material){setArchiveBusy(true);setArchiveError('');try{await request('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restore',materialId:m.id})});await showArchive();await onRefresh();}catch(e){setArchiveError(e instanceof Error?e.message:'Не удалось восстановить.');}finally{setArchiveBusy(false);}}
  const selectedSubject=subjects.find(s=>s.id===subjectId);
  const subjectMaterials=useMemo(()=>materials.filter(m=>!subjectId||m.subjectId===subjectId),[materials,subjectId]);
  const filtered=useMemo(()=>subjectMaterials.filter(m=>(scopeFilter==='all'||(m.access?.scope||'personal')===scopeFilter)&&(kindFilter==='all'||(kindFilter==='course'?isCourseInfo(m):kindFilter==='notes'?m.kind==='notes'&&!isCourseInfo(m):m.kind===kindFilter))&&matchesLibraryQuery(m,deferredQuery)),[subjectMaterials,scopeFilter,kindFilter,deferredQuery]);
  const sections=useMemo(()=>buildCourseSections(filtered,subjects),[filtered,subjects]);
  const allCollapsed=sections.length>0&&sections.every(s=>collapsed.has(s.key));
  const hasFilters=!!query||scopeFilter!=='all'||kindFilter!=='all';
  const searching=query!==deferredQuery;
  const kinds:[LibraryType,string][]=[['all','Все типы'],['course','О курсе'],['lecture','Лекции'],['seminar','Семинары'],['homework','Задания'],['notes','Дополнительные'],['rules','Правила курса']];
  function materialItem(material:Material){
    const pending=['queued','extracting'].includes(material.status),link=isLinkOnly(material),format=fileType(material),preview=material.blocks.find(b=>b.kind==='text')?.text;
    const status=link&&!material.blocks.length?'Ссылка':STATUS_LABELS[material.status];
    return <article key={material.id} className={`course-resource resource-${layout}`}>
      <button className="resource-open" onClick={()=>onOpen(material)} aria-label={`Открыть ${material.title}`} title={material.title}>
        <span className="resource-file-icon" aria-hidden="true">{link?<ArrowUpRight size={23}/>:material.mimeType.startsWith('image/')?<FileImage size={23}/>:<FileText size={23}/>}<small>{format}</small></span>
        <span className="resource-main"><strong>{material.title}</strong><span className="resource-meta"><span>{libraryTypeNames[courseType(material)]}</span><span>{hasOriginal(material)?fileSize(material.size):link?'Внешний ресурс':'Текст'}</span><span>v{material.version}</span>{material.access?.audienceLabel&&<span className="resource-audience">{material.access.audienceLabel}</span>}{material.isExample&&<span className="resource-example">Пример</span>}<span className="resource-scope-label">{material.access?.audienceLabel||'Личный материал'}</span></span></span>
        {layout==='cards'&&<span className={'resource-preview'+(!preview?' resource-preview-empty':'')}>{preview?preview.slice(0,180):hasOriginal(material)?'Открыть оригинал':link?'Открыть ссылку':'Открыть материал'}</span>}
      </button>
      <div className="resource-side"><span className={`resource-status resource-status-${link?'link':material.status}`} title={material.warnings.join(' ')||status}>{pending?<LoaderCircle size={13} className="spin"/>:material.status==='ready'&&!link?<Check size={14}/>:!link&&['limited','error'].includes(material.status)?<AlertCircle size={14}/>:<span className="status-dot"/>}<span className={material.status==='ready'&&!link?'resource-scope-label':'resource-status-label'}>{status}</span></span><div className="resource-actions">{link?material.sourceUrl&&<a className="icon-button" href={material.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Открыть ссылку ${material.title}`} title="Открыть источник"><ArrowUpRight size={16}/></a>:hasOriginal(material)&&<a className="icon-button" href={`/api/materials/${material.id}/file?version=${material.version}&download=1`} download aria-label={`Скачать ${material.title}`} title="Скачать оригинал"><ArrowDownToLine size={16}/></a>}<button className="icon-button" onClick={()=>onFeedback(material)} aria-label={`Сообщить об ошибке в ${material.title}`} title="Сообщить об ошибке"><MessageSquare size={16}/></button></div></div>
    </article>;
  }
  return <section className="library-view library-compact">
    <header className="library-heading"><div><h1>{selectedSubject?.name||'Материалы'}</h1><p>{subjectMaterials.length} {plural(subjectMaterials.length,'материал','материала','материалов')}{selectedSubject?` · ${selectedSubject.semester} семестр`:' · все предметы'}</p></div><button className="button-primary library-upload-button" disabled={!canAct||!subjects.length} onClick={()=>setUploadOpen(true)} aria-label="Добавить материал"><Plus size={17}/><span>Добавить материал</span></button></header>
    <nav className="library-subjects" aria-label="Фильтр по предмету"><button className={`library-subject-chip${!subjectId?' is-active':''}`} aria-pressed={!subjectId} onClick={()=>onSubjectChange('')}><Layers3 size={15}/>Все предметы<span>{materials.length}</span></button>{subjects.map(s=><button key={s.id} className={`library-subject-chip${subjectId===s.id?' is-active':''}`} aria-pressed={subjectId===s.id} onClick={()=>onSubjectChange(s.id)}><span className="library-subject-dot" style={{backgroundColor:s.color}}/>{s.shortName}<span>{materials.filter(m=>m.subjectId===s.id).length}</span></button>)}</nav>
    <div className="course-library-controls"><label className="library-search"><Search size={17}/><input value={query} onChange={e=>{setQuery(e.target.value);setCollapsed(new Set());}} placeholder="Поиск по материалам" aria-label="Найти материал"/>{query&&<button className="icon-button" onClick={()=>setQuery('')} aria-label="Очистить поиск"><X size={15}/></button>}</label><div className="library-scope-tabs" role="group" aria-label="Область материалов">{[['all','Все'],['personal','Личные'],['group','Группа'],['stream','Поток']].map(([id,label])=><button key={id} aria-pressed={scopeFilter===id} onClick={()=>{setScopeFilter(id);setCollapsed(new Set());}}>{label}</button>)}</div><div className="library-compact-tools"><label className="library-type-filter"><span className="resource-scope-label">Тип материала</span><select aria-label="Тип материала" value={kindFilter} onChange={e=>{setKindFilter(e.target.value as LibraryType);setCollapsed(new Set());}}>{kinds.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><ChevronDown size={13}/></label><div className="library-view-switch" role="group" aria-label="Вид библиотеки"><button aria-label="Список" title="Список" aria-pressed={layout==='list'} onClick={()=>changeLayout('list')}><List size={17}/></button><button aria-label="Карточки" title="Карточки" aria-pressed={layout==='cards'} onClick={()=>changeLayout('cards')}><LayoutGrid size={16}/></button></div><button className="library-archive-button" disabled={archiveBusy} onClick={()=>void showArchive()} aria-label="Открыть архив" title="Архив">{archiveBusy?<LoaderCircle size={16} className="spin"/>:<Archive size={16}/>}<span>Архив</span></button></div></div>
    {uploadResult&&<div className="library-notice" role="status"><Check size={16}/><span>{uploadResult}</span><button className="icon-button" onClick={()=>setUploadResult('')} aria-label="Скрыть сообщение"><X size={15}/></button></div>}
    {archived&&<section className="library-archive-panel"><div className="platform-list-row"><h2>Архив материалов</h2><button className="text-button" onClick={()=>setArchived(null)}>Закрыть</button></div>{archived.length?archived.map(m=><div className="platform-list-row" key={m.id}><span>{m.title} · v{m.version}</span><button className="btn btn-secondary" disabled={!canAct||archiveBusy} onClick={()=>void restore(m)}>Восстановить</button></div>):<p className="muted">Архив пуст.</p>}</section>}{archiveError&&<p className="form-error" role="alert">{archiveError}</p>}
    <div className="course-library-summary" aria-live="polite"><div>{searching?<LoaderCircle size={13} className="spin"/>:<BookOpen size={14}/>}<span>{hasFilters?`Найдено: ${filtered.length} из ${subjectMaterials.length}`:'Разделы курса'}</span>{hasFilters&&<button onClick={reset} className="text-button">Сбросить фильтры<X size={12}/></button>}</div>{sections.length>0&&<button className="text-button" onClick={()=>setCollapsed(allCollapsed?new Set():new Set(sections.map(s=>s.key)))}>{allCollapsed?'Развернуть все':'Свернуть все'}<ChevronDown size={14} className={allCollapsed?'':'collapse-all-icon'}/></button>}</div>
    <div className="course-library-sections" aria-busy={searching}>{sections.map(group=>{const expanded=!collapsed.has(group.key),id='course-section-'+encodeURIComponent(group.key);return <section className="course-section" key={group.key}><h2><button className="course-section-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>toggleSection(group.key)}><ChevronDown size={18} className={expanded?'':'section-collapsed'}/><span>{!subjectId&&<small>{subjects.find(s=>s.id===group.subjectId)?.name}</small>}{group.title}</span><span className="course-section-count">{group.materials.length}</span></button></h2><div id={id} hidden={!expanded} className={layout==='cards'?'course-card-grid':'course-resource-list'}>{group.materials.map(materialItem)}</div></section>;})}</div>
    {!filtered.length&&<div className="course-library-empty"><BookOpen size={29}/><h2>{subjectMaterials.length?'Нет материалов по этим фильтрам':'Здесь пока нет материалов'}</h2><p>{subjectMaterials.length?'Измени запрос или сбрось фильтры, чтобы увидеть все разделы курса.':'Добавь первый документ, лекцию или задание.'}</p>{hasFilters?<button className="btn btn-secondary" onClick={reset}>Показать все материалы</button>:<button className="btn btn-primary" disabled={!canAct||!subjects.length} onClick={()=>setUploadOpen(true)}><Plus size={16}/>Добавить материал</button>}</div>}
    {uploadOpen&&<UploadDialog audiences={audiences} subjects={subjects} initialSubjectId={subjectId} onClose={()=>setUploadOpen(false)} onUploaded={async(uploaded,complete)=>{await onRefresh();if(complete)setUploadOpen(false);setUploadResult(uploaded.length===1?isLinkOnly(uploaded[0])?'Ссылка сохранена. Для контекста ИИ добавь сам документ.':'Материал сохранён. Статус обновится после обработки.':`Сохранено материалов: ${uploaded.length}.`);}}/>}
  </section>;
}
