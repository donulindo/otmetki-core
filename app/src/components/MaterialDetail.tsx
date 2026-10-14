'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownToLine, Check, ChevronDown, ExternalLink, FileText,
  History, Layers3, LoaderCircle, MessageSquare, Pencil, ScanLine, Sparkles, X,
} from 'lucide-react';
import type { Effort, Material, MaterialKind, MaterialStatus, TextBlock } from '@/lib/types';
import LibraryActions from './LibraryActions';
import type {StudyAudience} from './platform-types';
import { isLinkOnly,hasOriginal } from './material-source';

interface MaterialVersion { version: number; reason: string; createdAt: string; }
interface SimilarCandidate {
  id: string; title: string; version: number; overlapBlocks: number;
  totalBlocks?: number; comparedBlocks?: number; candidateComparedBlocks?: number; exactFileDuplicate?: boolean;
}
interface MaterialResponse { alternativeId?:string; material: Material; latestVersion?:number; versions?: MaterialVersion[]; similarCandidates?: SimilarCandidate[]; }
interface Props {
  audiences?:StudyAudience[];canAct?:boolean;candidates?:Material[];onArchive?:()=>void;
  material: Material;
  onClose: () => void;
  onUpdate: (material: Material) => void;
  onFeedback: (material: Material) => void;
  onVersion?: (version?: number) => Promise<void>;
  latestVersion?: number;
  versions?: MaterialVersion[];
  similarCandidates?: SimilarCandidate[];
}

const KINDS: Record<MaterialKind, string> = { lecture: 'Лекция', seminar: 'Семинар', homework: 'Задание', rules: 'Правила курса', notes: 'Заметки' };
const STATUSES: Record<MaterialStatus, string> = { queued: 'В очереди', extracting: 'Получаем текст', ready: 'Готов для ИИ', limited: 'Готов с ограничениями', error: 'Ошибка обработки' };
const EFFORTS: Record<Effort, string> = { low: 'Быстрая', medium: 'Обычная', high: 'Подробная', xhigh: 'Очень подробная', max: 'Максимальная' };
const REASONS: Record<string, string> = { created: 'Загрузка', extraction: 'Извлечение текста', recheck: 'Перепроверка', manual_correction: 'Исправление текста', metadata: 'Описание', file_replaced: 'Новый файл' };

async function materialResponse(response: Response): Promise<MaterialResponse> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить действие.');
  return body.material ? body : { material: body };
}

function sourceLabel(block: TextBlock, index: number) {
  if (block.slide !== undefined) return `Слайд ${block.slide}`;
  if (block.page !== undefined) return `Страница ${block.page}`;
  return `Фрагмент ${index + 1}`;
}

function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function MaterialDetail({ audiences=[],canAct=true,candidates=[],onArchive, material, onClose, onUpdate, onFeedback, onVersion, latestVersion, versions, similarCandidates }: Props) {
  const [current, setCurrent] = useState(material);
  const [history, setHistory] = useState<MaterialVersion[]>(versions || []);
  const [similar, setSimilar] = useState<SimilarCandidate[]>(similarCandidates || []);
  const [newest, setNewest] = useState(latestVersion || material.version);
  const [versionLoading, setVersionLoading] = useState(false);
  const [tab, setTab] = useState<'text' | 'original'>('text');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [topic, setTopic] = useState(material.topic);
  const [kind, setKind] = useState<MaterialKind>(material.kind);
  const [saving, setSaving] = useState(false);
  const [blockDraft, setBlockDraft] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [recheckBlock, setRecheckBlock] = useState<TextBlock | null>(null);
  const [replacement, setReplacement] = useState<SimilarCandidate | null>(null);
  const [effort, setEffort] = useState<Effort>('high');
  const [checking, setChecking] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousMaterial = useRef({ id: material.id, version: material.version });
  const modalState = useRef({ open: false, busy: false });
  modalState.current = { open: !!recheckBlock || !!replacement, busy: checking || replacing };
  const callbacks = useRef({ onClose, onUpdate, onVersion });
  callbacks.current = { onClose, onUpdate, onVersion };
  const pending = current.status === 'queued' || current.status === 'extracting';
  const historical = Math.max(newest, latestVersion || 0) > current.version;
  const readonly = historical || pending || versionLoading || !canAct || current.access?.canEdit===false;
  const apiUrl = `/api/materials/${encodeURIComponent(current.id)}`;
  const fileUrl = `${apiUrl}/file?version=${current.version}`;
  const fileDownloadUrl = `${fileUrl}&download=1`;
  const imageUrl = (block: TextBlock) => `${apiUrl}/image?block=${encodeURIComponent(block.id)}&version=${current.version}`;
  const sourceUrl = safeSourceUrl(current.sourceUrl);
  const linkOnly = isLinkOnly(current);
  const originalAvailable=hasOriginal(current);
  const pageRecheck = current.mimeType === 'application/pdf' && recheckBlock?.page !== undefined;

  function applyManifest(body: MaterialResponse) {
    if (body.versions) {
      const incoming = body.versions;
      setHistory((previous) => Math.max(0, ...incoming.map((item) => item.version)) >= Math.max(0, ...previous.map((item) => item.version)) ? incoming : previous);
      setNewest((previous) => Math.max(previous, body.material.version, body.latestVersion??0, ...incoming.map((item) => item.version)));
    } else setNewest((previous) => Math.max(previous, body.material.version, body.latestVersion??0));
    if (body.similarCandidates) setSimilar(body.similarCandidates);
  }

  useEffect(() => {
    setCurrent(material);
    setTitle(material.title); setTopic(material.topic); setKind(material.kind);
    if (previousMaterial.current.id !== material.id || previousMaterial.current.version !== material.version) {
      setEditing(false); setBlockDraft(null); setRecheckBlock(null); setReplacement(null); setError(''); setNotice('');
    }
    const switched = previousMaterial.current.id !== material.id;
    if (switched) { setHistory(versions || []); setSimilar(similarCandidates || []); }
    previousMaterial.current = { id: material.id, version: material.version };
    setNewest((previous) => Math.max(switched ? 0 : previous, material.version, latestVersion || 0));
  }, [material, latestVersion, versions, similarCandidates]);

  useEffect(() => {
    if (versions) {
      setHistory((previous) => Math.max(0, ...versions.map((item) => item.version)) >= Math.max(0, ...previous.map((item) => item.version)) ? versions : previous);
      setNewest((previous) => Math.max(previous, material.version, ...versions.map((item) => item.version)));
    }
  }, [versions, material.version]);
  useEffect(() => { if (similarCandidates) setSimilar(similarCandidates); }, [similarCandidates]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/materials/${encodeURIComponent(material.id)}`, { cache: 'no-store' })
      .then(materialResponse).then((body) => { if (!cancelled) applyManifest(body); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить историю версий.'); });
    return () => { cancelled = true; };
    // The manifest is loaded once per opened material; mutations refresh it separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);

  useEffect(() => {
    const oldFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (modalState.current.open) { if (!modalState.current.busy) { setRecheckBlock(null); setReplacement(null); } }
        else callbacks.current.onClose();
      }
      if (event.key === 'Tab') {
        const scope = modalState.current.open ? modalRef.current : panelRef.current;
        const elements = scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], iframe');
        if (!elements?.length) return;
        const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); oldFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (!recheckBlock && !replacement) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previousFocus?.focus();
  }, [recheckBlock, replacement]);

  useEffect(() => {
    if (!pending || historical) return;
    let running = false;
    const interval = window.setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const body = await materialResponse(await fetch(`/api/materials/${encodeURIComponent(current.id)}`, { cache: 'no-store' }));
        setCurrent(body.material); applyManifest(body); callbacks.current.onUpdate(body.material);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось обновить статус.'); }
      finally { running = false; }
    }, 3000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, historical, current.id]);

  async function selectVersion(version?: number) {
    if (versionLoading) return;
    setVersionLoading(true); setError(''); setNotice(''); setEditing(false); setBlockDraft(null); setRecheckBlock(null); setReplacement(null);
    try {
      if (onVersion) await onVersion(version);
      else {
        const body = await materialResponse(await fetch(`${apiUrl}${version === undefined ? '' : `?version=${version}`}`, { cache: 'no-store' }));
        setCurrent(body.material); applyManifest(body);
        if (version === undefined) onUpdate(body.material);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть версию.'); }
    finally { setVersionLoading(false); }
  }

  async function refreshAfterChange(next: Material) {
    setCurrent(next); setNewest(next.version); onUpdate(next);
    try {
      const body = await materialResponse(await fetch(apiUrl, { cache: 'no-store' }));
      applyManifest(body);
      if (onVersion) await onVersion(undefined);
    } catch { setError('Изменения сохранены, но историю не удалось обновить. Открой актуальную версию ещё раз.'); }
  }

  async function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving || readonly) return;
    setSaving(true); setError('');
    try {
      const body = await materialResponse(await fetch(apiUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: current.version, title: title.trim(), topic: topic.trim(), kind }) }));
      await refreshAfterChange(body.material); setEditing(false); setNotice(body.alternativeId?'Исправление сохранено как альтернатива. Актуальная версия сохранена.':'Описание сохранено новой версией.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.'); }
    finally { setSaving(false); }
  }

  async function saveBlock() {
    if (!blockDraft || saving || readonly) return;
    setSaving(true); setError('');
    try {
      const body = await materialResponse(await fetch(apiUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: current.version, blocks: [{ id: blockDraft.id, text: blockDraft.text }] }) }));
      await refreshAfterChange(body.material); setBlockDraft(null); setNotice(body.alternativeId?'Исправление сохранено как альтернатива. Актуальная версия сохранена.':'Исправление текста сохранено новой версией.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить текст.'); }
    finally { setSaving(false); }
  }

  async function recheck() {
    if (!recheckBlock || checking || readonly) return;
    setChecking(true); setError(''); setNotice('');
    try {
      const body = await materialResponse(await fetch(`${apiUrl}/recheck`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: recheckBlock.id, effort, version: current.version }) }));
      await refreshAfterChange(body.material); setRecheckBlock(null); setNotice('Перепроверка поставлена в очередь. Статус обновится после обработки.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось перепроверить фрагмент.'); }
    finally { setChecking(false); }
  }

  async function replaceFile() {
    if (!replacement || replacing || readonly) return;
    setReplacing(true); setError(''); setNotice('');
    try {
      const body = await materialResponse(await fetch(`${apiUrl}/replace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId: replacement.id, version: current.version }) }));
      await refreshAfterChange(body.material); setReplacement(null); setNotice('Новый файл сохранён следующей версией. Предыдущие версии доступны в истории.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось добавить новую версию файла.'); }
    finally { setReplacing(false); }
  }

  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !modalState.current.busy) onClose(); }}>
      <div className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex={-1} ref={panelRef}>
        <div className="detail-topbar"><span className="detail-kind"><FileText size={16} />{KINDS[current.kind]}{current.isExample && <span className="material-example-badge">Пример</span>}</span><button className="icon-button" onClick={onClose} disabled={checking || replacing} aria-label="Закрыть материал"><X size={23} /></button></div>
        <div className="detail-scroll">
          <header className="detail-heading"><span className="eyebrow">{current.topic || 'МАТЕРИАЛ КУРСА'}</span><h2 id="detail-title">{current.title}</h2><div className="detail-heading-meta"><span className={`material-status status-${current.status}`}>{pending ? <LoaderCircle className="spin" size={13} /> : <span className="status-dot" />}{linkOnly && !current.blocks.length ? 'Только ссылка' : STATUSES[current.status]}</span><span>Версия {current.version}</span>{current.pageCount > 0 && <span>{current.pageCount} {current.mimeType.includes('presentation') ? 'слайдов' : 'страниц'}</span>}</div></header>
          <LibraryActions material={current} audiences={audiences} canAct={canAct&&!historical} candidates={candidates} onChange={async()=>{const body=await materialResponse(await fetch(apiUrl,{cache:'no-store'}));await refreshAfterChange(body.material);}} onArchive={()=>{onArchive?.();onClose();}}/><div className="detail-version-bar"><History size={16} /><label className="detail-version-label">История<span className="select-wrap"><select aria-label="Версия материала" value={current.version} disabled={versionLoading || saving || checking || replacing} onChange={(event) => void selectVersion(Number(event.target.value))}>{history.length ? history.map((item) => <option key={item.version} value={item.version}>Версия {item.version} · {REASONS[item.reason] || 'Обновление'}{item.version === Math.max(newest, latestVersion || 0) ? ' · актуальная' : ''}</option>) : <option value={current.version}>Версия {current.version}</option>}</select><ChevronDown size={14} /></span></label>{versionLoading && <LoaderCircle size={16} className="spin" />}</div>
          {historical && <div className="detail-history-banner"><History size={18} /><div><strong>Ты смотришь сохранённую версию {current.version}</strong><p>Оригинал и текст относятся к этой версии. Изменения доступны в актуальной.</p></div><button className="button-secondary" disabled={versionLoading} onClick={() => void selectVersion(undefined)}>К актуальной версии</button></div>}
          <div className="detail-actions">{originalAvailable && <a href={fileDownloadUrl} download className="button-secondary"><ArrowDownToLine size={16} />Скачать оригинал</a>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="button-secondary"><ExternalLink size={16} />Открыть источник</a>}<button className="button-quiet" disabled={readonly || saving} onClick={() => { setEditing(!editing); setError(''); }}><Pencil size={15} />{editing ? 'Закрыть редактирование' : 'Изменить'}</button><button className="button-quiet" onClick={() => onFeedback(current)}><MessageSquare size={16} />Сообщить об ошибке</button></div>
          {editing && !historical && <form className="detail-edit-form" onSubmit={saveMetadata}><label className="field">Название<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required disabled={saving} /></label><div className="library-form-row"><label className="field">Тип<span className="select-wrap"><select value={kind} onChange={(event) => setKind(event.target.value as MaterialKind)} disabled={saving}>{Object.entries(KINDS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={16} /></span></label><label className="field">Тема<input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={180} disabled={saving} /></label></div><button className="button-primary" type="submit" disabled={saving || !title.trim()}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{saving ? 'Сохраняем…' : 'Сохранить'}</button></form>}
          {!historical && similar.length > 0 && <div className="detail-similar"><div className="detail-similar-heading"><Layers3 size={18} /><div><strong>Есть похожие материалы</strong><p>Повторы не объединяются автоматически. Если это обновлённый файл, сохрани его следующей версией.</p></div></div>{similar.map((candidate) => <div className="detail-similar-row" key={candidate.id}><div><strong>{candidate.title}</strong><span>{candidate.exactFileDuplicate ? 'Точный дубль файла' : `Совпадающих фрагментов: ${candidate.overlapBlocks}`} · версия {candidate.version}</span></div><div className="detail-candidate-actions"><a className="button-quiet" href={`/api/materials/${encodeURIComponent(candidate.id)}/file?version=${candidate.version}`} target="_blank" rel="noreferrer" aria-label={`Открыть файл ${candidate.title}`}><ExternalLink size={14} />Посмотреть файл</a><button className="button-secondary" disabled={readonly || saving} onClick={() => { setReplacement(candidate); setError(''); }}>Новая версия</button></div></div>)}</div>}
          {current.warnings.length > 0 && <div className="detail-warning"><AlertCircle size={18} /><div><strong>Есть места для сверки</strong>{current.warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="detail-notice" role="status"><Check size={16} />{notice}</p>}
          <div className="detail-tabs" role="tablist" aria-label="Просмотр материала"><button role="tab" id="text-tab" aria-selected={tab === 'text'} aria-controls="material-text" className={tab === 'text' ? 'is-active' : ''} onClick={() => setTab('text')}>Извлечённый текст<span>{current.blocks.length}</span></button><button role="tab" id="original-tab" aria-selected={tab === 'original'} aria-controls="material-original" className={tab === 'original' ? 'is-active' : ''} onClick={() => setTab('original')}>{linkOnly ? 'Источник' : 'Оригинал'}<ExternalLink size={14} /></button></div>
          {tab === 'text' ? <div id="material-text" role="tabpanel" aria-labelledby="text-tab" className="detail-text-content">
            {current.blocks.length ? current.blocks.map((block, index) => {
              const canRecheck = !!block.imageFile || (current.mimeType === 'application/pdf' && block.page !== undefined);
              const isEditing = blockDraft?.id === block.id;
              return <article className={`detail-block detail-block-${block.kind}`} key={block.id}>
                <div className="detail-block-heading"><span>{sourceLabel(block, index)}{block.kind === 'table' && ' · таблица'}{block.kind === 'formula' && ' · формула'}{block.kind === 'image' && ' · изображение'}</span><div className="detail-block-actions"><button className="detail-recheck-button" disabled={readonly || saving || checking} onClick={() => { setBlockDraft({ id: block.id, text: block.text }); setNotice(''); }}><Pencil size={13} />Исправить текст</button>{canRecheck && <button className="detail-recheck-button" disabled={readonly || checking || saving} onClick={() => { setRecheckBlock(block); setNotice(''); setError(''); }}><ScanLine size={14} />{current.mimeType === 'application/pdf' && block.page !== undefined ? `Перепроверить страницу ${block.page}` : 'Перепроверить'}</button>}</div></div>
                {block.imageFile && <a className="detail-source-image" href={imageUrl(block)} target="_blank" rel="noreferrer"><img src={imageUrl(block)} loading="lazy" alt={`Оригинал фрагмента: ${sourceLabel(block, index)}`} /></a>}
                {isEditing && !historical ? <div className="detail-block-edit"><label className="field">Текст фрагмента<textarea value={blockDraft.text} onChange={(event) => setBlockDraft({ id: block.id, text: event.target.value })} maxLength={200_000} rows={8} disabled={saving} /></label><p>Исправление создаст новую версию. Исходный текст останется в истории.</p><div><button className="button-secondary" disabled={saving} onClick={() => setBlockDraft(null)}>Отмена</button><button className="button-primary" disabled={saving || readonly} onClick={() => void saveBlock()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Сохранить текст</button></div></div> : block.text ? <div className="detail-block-text">{block.text}</div> : <p className="detail-block-empty">Текст этого фрагмента не получен. Сверься с оригиналом.</p>}
                {block.warning && <p className="detail-block-warning"><AlertCircle size={14} />{block.warning}</p>}
              </article>;
            }) : <div className="detail-empty">{pending ? <LoaderCircle size={30} className="spin" /> : <ScanLine size={30} strokeWidth={1.4} />}<h3>{linkOnly ? 'Сохранена ссылка' : pending ? 'Материал готовится' : current.status === 'error' ? 'Текст не удалось получить' : 'Пока нет извлечённого текста'}</h3><p>{linkOnly ? 'Содержимое сайта не загружено и не включено в контекст ИИ. Открой вкладку «Источник», чтобы перейти к материалу.' : pending ? 'Здесь появятся фрагменты с указанием источника. Можно закрыть окно — обработка продолжится.' : 'Оригинал доступен для скачивания. Сообщи об ошибке, чтобы мы могли разобраться.'}</p></div>}
          </div> : <div id="material-original" role="tabpanel" aria-labelledby="original-tab" className="detail-original">{!linkOnly&&!originalAvailable?<div className="detail-link-original"><FileText size={35}/><h3>Текстовый материал</h3><p>Оригинальный файл не загружен. Доступны сохранённые фрагменты текста.</p>{sourceUrl&&<a href={sourceUrl} target="_blank" rel="noreferrer">Открыть источник</a>}</div>:linkOnly ? <div className="detail-link-original"><ExternalLink size={35} strokeWidth={1.2} /><h3>Сохранённая ссылка</h3>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{sourceUrl}</a> : <p>Адрес источника недоступен.</p>}<p>Содержимое внешнего сайта не загружено и не включено в контекст ИИ. Пока здесь сохранены только ссылка и описание.</p></div> : <>{current.mimeType.startsWith('image/') ? <img src={fileUrl} alt={`Оригинал: ${current.title}`} /> : <div className="detail-empty"><FileText size={40} strokeWidth={1.1} /><h3>{current.mimeType === 'application/pdf' ? 'PDF-документ' : current.filename}</h3><p>{current.mimeType === 'application/pdf' ? 'Открой оригинал в отдельной вкладке: там можно увеличить страницы или сохранить файл.' : 'Скачай документ, чтобы открыть его в привычном приложении.'}</p></div>}<a className="button-secondary" href={fileUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />{current.mimeType === 'application/pdf' ? 'Открыть PDF' : 'Открыть оригинал отдельно'}</a></>}</div>}
          <footer className="detail-footnote"><Sparkles size={15} /><p>{linkOnly ? 'Ссылка не даёт ИИ доступ к внешнему сайту. Для работы с содержимым добавь файл материала.' : 'В чат попадут выбранные материалы. Исходный файл и все сохранённые версии доступны отдельно.'}</p></footer>
        </div>
        {recheckBlock && <div className="detail-recheck-dialog" role="dialog" aria-modal="true" aria-labelledby="recheck-title" tabIndex={-1} ref={modalRef}><div className="detail-recheck-head"><span className="detail-recheck-icon"><ScanLine size={22} /></span><button className="icon-button" onClick={() => setRecheckBlock(null)} disabled={checking} aria-label="Закрыть перепроверку"><X size={19} /></button></div><h3 id="recheck-title">{pageRecheck ? `Перепроверить страницу ${recheckBlock.page}` : 'Посмотрим внимательнее'}</h3><p>{pageRecheck ? 'Текст этой страницы будет заново прочитан; остальные страницы сохранятся. Результат сохранится новой версией.' : 'ИИ сверится с оригиналом этого фрагмента. Результат сохранится новой версией.'}</p><blockquote>{recheckBlock.text.slice(0, 200) || 'Фрагмент без извлечённого текста'}</blockquote><label className="field">Глубина проверки<span className="select-wrap"><select value={effort} onChange={(event) => setEffort(event.target.value as Effort)} disabled={checking}>{Object.entries(EFFORTS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={16} /></span></label><span className="detail-recheck-model">GPT‑6.1 Sol · {pageRecheck ? `страница ${recheckBlock.page}` : 'только этот фрагмент'}</span><button className="button-primary" disabled={checking || readonly} onClick={() => void recheck()}>{checking ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{checking ? 'Ставим в очередь…' : pageRecheck ? `Перепроверить страницу ${recheckBlock.page}` : 'Перепроверить'}</button>{error && <p className="form-error" role="alert">{error}</p>}</div>}
        {replacement && <div className="detail-recheck-dialog detail-replace-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title" tabIndex={-1} ref={modalRef}><div className="detail-recheck-head"><span className="detail-recheck-icon"><History size={22} /></span><button className="icon-button" onClick={() => setReplacement(null)} disabled={replacing} aria-label="Закрыть замену файла"><X size={19} /></button></div><h3 id="replace-title">Сохранить новый файл?</h3><p>Файл «{replacement.title}» станет следующей версией материала «{current.title}».</p><blockquote>Название, тема и связь с чатами сохранятся. Старый оригинал и извлечённый текст останутся в истории.</blockquote><div className="detail-replace-actions"><button className="button-secondary" disabled={replacing} onClick={() => setReplacement(null)}>Отмена</button><button className="button-primary" disabled={replacing || readonly} onClick={() => void replaceFile()}>{replacing ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{replacing ? 'Сохраняем…' : 'Заменить файл'}</button></div>{error && <p className="form-error" role="alert">{error}</p>}</div>}
      </div>
    </div>
  );
}
