'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, ImagePlus, LoaderCircle, MessageSquare, Paperclip, Send, ShieldCheck, X } from 'lucide-react';

interface Target { type: 'general' | 'material' | 'chat'; id?: string; version?: number; title?: string; }

export default function FeedbackDialog({ target, onClose, onSaved }: { target?: Target; onClose: () => void; onSaved: () => Promise<void> }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [attachmentText, setAttachmentText] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  savingRef.current = saving;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    subjectRef.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !savingRef.current) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? [])].filter(element => element.offsetParent !== null);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = priorOverflow; previousFocus?.focus(); };
  }, [onClose]);

  useEffect(() => {
    if (!screenshot) { setScreenshotUrl(null); return; }
    const url = URL.createObjectURL(screenshot);
    setScreenshotUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  function chooseFile(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Добавь скриншот в PNG, JPEG или WebP.'); if (fileRef.current) fileRef.current.value = ''; return; }
    if (file.size > 40 * 1024 * 1024) { setError('Скриншот должен быть меньше 40 МБ.'); if (fileRef.current) fileRef.current.value = ''; return; }
    setScreenshot(file);
  }

  function showPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) { setError('Добавь тему и описание — так будет проще разобраться.'); return; }
    setError('');
    setPreview(true);
  }

  async function submit() {
    if (saving || saved) return;
    setSaving(true);
    setError('');
    const data = new FormData();
    data.set('subject', subject.trim());
    data.set('message', message.trim());
    data.set('targetType', target?.type ?? 'general');
    if (target?.id) data.set('targetId', target.id);
    if (target?.version != null) data.set('targetVersion', String(target.version));
    if (includeAttachments && attachmentText.trim()) data.set('attachmentText', attachmentText.trim());
    if (includeAttachments && screenshot) data.set('screenshot', screenshot);
    if (includeAttachments && (attachmentText.trim() || screenshot)) data.set('attachmentConsent', 'true');
    try {
      const response = await fetch('/api/feedback', { method: 'POST', body: data });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Время входа истекло. Войди снова, чтобы отправить обращение.');
        if (response.status === 413) throw new Error('Вложение слишком большое. Уменьши скриншот и попробуй ещё раз.');
        throw new Error('Не удалось отправить обращение. Текст остаётся здесь — попробуй снова.');
      }
      setSaved(true);
      try { await onSaved(); } catch { /* The ticket already exists; never offer a duplicate submission. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверь соединение и попробуй ещё раз.'); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="modal feedback-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title" tabIndex={-1}>
      <button className="feedback-dialog-close" type="button" aria-label="Закрыть" onClick={onClose} disabled={saving}><X size={20} /></button>
      {saved ? <div className="feedback-success"><div className="feedback-success-icon"><Check size={32} /></div><span className="eyebrow">На связи</span><h2 id="feedback-dialog-title">Обращение отправлено<span className="heading-dot">.</span></h2><p>Оно сохранено в обратной связи. Там можно добавить подробности, прочитать ответ и посмотреть статус.</p><button type="button" className="btn btn-primary" onClick={onClose}>Готово <Check size={16} /></button></div> : <>
        <header className="feedback-dialog-header"><span className="eyebrow"><MessageSquare size={14} /> Обратная связь</span><h2 id="feedback-dialog-title">{preview ? 'Проверим перед отправкой' : 'Расскажи, что улучшить'}<span className="heading-dot">.</span></h2><p>{preview ? 'Разработчик получит только то, что показано ниже.' : 'Ошибка, неудобная деталь или новая идея — можно написать своими словами.'}</p></header>
        {target?.type !== 'general' && target?.id && <div className="feedback-target"><FileText size={17} /><span>{target.title ?? (target.type === 'material' ? 'Материал' : 'Чат')}{target.version != null && <small>Версия {target.version}</small>}</span></div>}
        {error && <div className="feedback-error" role="alert">{error}</div>}
        {preview ? <div className="feedback-preview">
          <span className="eyebrow">Тема</span><h3>{subject.trim()}</h3><span className="eyebrow">Комментарий</span><p className="feedback-preview-message">{message.trim()}</p>
          {includeAttachments && (attachmentText.trim() || screenshot) ? <div className="feedback-preview-attachments"><span className="eyebrow"><Paperclip size={13} /> Вложения по твоему выбору</span>{attachmentText.trim() && <pre>{attachmentText.trim()}</pre>}{screenshot && <div className="feedback-screenshot">{screenshotUrl && <img src={screenshotUrl} alt="Скриншот, который будет отправлен разработчику" />}<span>{screenshot.name}</span></div>}</div> : <div className="feedback-privacy-note"><ShieldCheck size={16} /><span>Без вложений. Личная переписка и содержимое файлов не отправляются.</span></div>}
          <footer className="feedback-dialog-footer"><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setPreview(false)}><ArrowLeft size={16} /> Изменить</button><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void submit()}>{saving ? <><LoaderCircle size={17} className="spin" /> Отправляем</> : <>Отправить <Send size={16} /></>}</button></footer>
        </div> : <form className="feedback-form" onSubmit={showPreview}>
          <label className="field"><span>Тема</span><input ref={subjectRef} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Например, неверно прочиталась формула" required maxLength={160} /></label>
          <label className="field"><span>Что случилось или чего не хватает?</span><textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Расскажи, где возникла ошибка и какой результат ты ожидал." required maxLength={10000} rows={5} /></label>
          <label className="feedback-attachment-toggle"><input type="checkbox" checked={includeAttachments} onChange={event => setIncludeAttachments(event.target.checked)} /><span><strong>Приложить контекст</strong><small>Только текст или скриншот, который выберешь сам.</small></span><Paperclip size={18} /></label>
          {includeAttachments && <div className="feedback-attachment"><label className="field"><span>Фрагмент текста <small>необязательно</small></span><textarea value={attachmentText} onChange={event => setAttachmentText(event.target.value)} placeholder="Вставь участок материала или переписки, который поможет разобраться." maxLength={12000} rows={3} /></label><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Добавить скриншот" onChange={event => chooseFile(event.target.files?.[0])} />{screenshot ? <div className="feedback-file-selected"><div>{screenshotUrl && <img src={screenshotUrl} alt="Выбранный скриншот" />}<span><strong>{screenshot.name}</strong><small>{(screenshot.size / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ</small></span></div><button type="button" aria-label="Убрать скриншот" onClick={() => { setScreenshot(null); if (fileRef.current) fileRef.current.value = ''; }}><X size={17} /></button></div> : <button className="feedback-upload" type="button" onClick={() => fileRef.current?.click()}><ImagePlus size={22} /><span><strong>Добавить скриншот</strong><small>PNG, JPEG или WebP · до 40 МБ</small></span><span className="feedback-upload-plus">+</span></button>}</div>}
          <div className="feedback-privacy-note"><ShieldCheck size={16} /><span>Перед отправкой покажем всё, что увидит разработчик.</span></div>
          <footer className="feedback-dialog-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Отмена</button><button type="submit" className="btn btn-primary" disabled={!subject.trim() || !message.trim()}>Посмотреть <ArrowRight size={16} /></button></footer>
        </form>}
      </>}
    </div>
  </div>;
}
