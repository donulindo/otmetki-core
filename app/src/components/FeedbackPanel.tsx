'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CheckCheck, ChevronRight, CircleHelp, Clock3, LoaderCircle, MessageCircle, MessageSquarePlus, Paperclip, RefreshCw, Wrench } from 'lucide-react';
import type { Feedback, FeedbackStatus } from '../lib/types';

const statuses: Record<FeedbackStatus, { label: string; icon: typeof Clock3 }> = {
  received: { label: 'Получено', icon: Clock3 },
  clarification: { label: 'Нужно уточнение', icon: CircleHelp },
  in_progress: { label: 'В работе', icon: Wrench },
  resolved: { label: 'Исправлено', icon: CheckCheck },
};

function date(value: string, full = false) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(full ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

function ticketFrom(payload: unknown): Feedback {
  const result = payload as Feedback & { feedback?: Feedback; item?: Feedback; ticket?: Feedback };
  const ticket = result.feedback ?? result.item ?? result.ticket ?? result;
  if (!ticket?.id || !Array.isArray(ticket.messages)) throw new Error('Не удалось прочитать обращение. Попробуй обновить его.');
  return ticket;
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error('Время входа истекло. Войди снова, чтобы продолжить.');
    if (response.status === 429) throw new Error('Слишком много запросов. Подожди немного и попробуй снова.');
    throw new Error('Не получилось выполнить запрос. Проверь соединение и попробуй снова.');
  }
  return payload;
}

export default function FeedbackPanel({ items, onRefresh, onCreate }: { items: Feedback[]; onRefresh: () => Promise<void>; onCreate: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [detail, setDetail] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const visible = items.filter(item => filter === 'all' || (filter === 'resolved' ? item.status === 'resolved' : item.status !== 'resolved'));
  const selected = detail?.id === selectedId ? detail : items.find(item => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!visible.some(item => item.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [items, filter, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setText('');
    request(`/api/feedback/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(payload => setDetail(ticketFrom(payload)))
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось открыть обращение.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedId, retry]);

  async function refresh() {
    setRefreshing(true);
    setError('');
    try { await onRefresh(); setRetry(value => value + 1); }
    catch { setError('Не удалось обновить обращения. Попробуй ещё раз.'); }
    finally { setRefreshing(false); }
  }

  async function updateStatus(status: FeedbackStatus) {
    if (!selected || saving) return;
    const id = selected.id;
    setSaving(true);
    setError('');
    try {
      await request(`/api/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const payload = await request(`/api/feedback/${encodeURIComponent(id)}`);
      if (selectedRef.current === id) setDetail(ticketFrom(payload));
      try { await onRefresh(); } catch { setError('Статус сохранён, но список не обновился. Нажми «Обновить обращения».'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось изменить статус.'); }
    finally { setSaving(false); }
  }

  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !text.trim() || saving) return;
    const id = selected.id;
    setSaving(true);
    setError('');
    try {
      await request(`/api/feedback/${encodeURIComponent(id)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() }) });
      if (selectedRef.current === id) setText('');
      const payload = await request(`/api/feedback/${encodeURIComponent(id)}`);
      if (selectedRef.current === id) setDetail(ticketFrom(payload));
      try { await onRefresh(); } catch { setError('Сообщение сохранено, но список не обновился. Нажми «Обновить обращения».'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось отправить сообщение. Текст сохранён в поле.'); }
    finally { setSaving(false); }
  }

  return <section className="feedback-panel">
    <header className="feedback-heading">
      <div><span className="eyebrow">Сделаем удобнее вместе</span><h1>Обратная связь<span className="heading-dot">.</span></h1><p>Здесь можно рассказать об ошибке или предложить, что доработать.</p></div>
      <div className="feedback-actions"><button className="btn btn-secondary" onClick={refresh} disabled={refreshing} aria-label="Обновить обращения"><RefreshCw size={17} className={refreshing ? 'spin' : ''} /></button><button className="btn btn-primary" onClick={onCreate}><MessageSquarePlus size={17} /> Написать</button></div>
    </header>
    {error && <div className="feedback-error" role="alert"><span>{error}</span><button onClick={() => setRetry(value => value + 1)} className="feedback-text-button">Повторить</button></div>}
    <div className="feedback-layout">
      <aside className="feedback-list" aria-label="Твои обращения">
        <div className="feedback-filters" aria-label="Фильтр обращений">{([['all', 'Все'], ['open', 'Открытые'], ['resolved', 'Исправлено']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <div className="feedback-ticket-list">
          {visible.map(item => {
            const StatusIcon = statuses[item.status].icon;
            return <button key={item.id} className={`feedback-ticket ${selectedId === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)} aria-pressed={selectedId === item.id}>
              <div className="feedback-ticket-meta"><span className={`feedback-status status-${item.status}`}><StatusIcon size={13} />{statuses[item.status].label}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div>
              <strong>{item.subject}</strong><p>{item.message}</p><span className="feedback-ticket-footer"><MessageCircle size={13} /> {item.messages.length} {item.messages.length === 1 ? 'сообщение' : item.messages.length >= 2 && item.messages.length <= 4 ? 'сообщения' : 'сообщений'}<ChevronRight size={15} /></span>
            </button>;
          })}
          {!visible.length && <div className="feedback-list-empty"><MessageCircle size={26} /><p>{filter === 'all' ? 'Пока нет обращений' : 'Здесь пока ничего нет'}</p><span>{filter === 'all' ? 'Твои сообщения появятся здесь.' : 'Попробуй другой фильтр.'}</span></div>}
        </div>
      </aside>
      <div className="feedback-conversation">
        {selected ? <>
          <header className="feedback-conversation-header"><div><span className="eyebrow">Обращение · {selected.id.slice(0, 8)}</span><h2>{selected.subject}</h2><p>{selected.targetType === 'material' ? 'Связано с материалом' : selected.targetType === 'chat' ? 'Связано с чатом' : 'Общее обращение'}{selected.targetVersion != null ? ` · версия ${selected.targetVersion}` : ''}</p></div><label className="feedback-status-control"><span>Статус</span><select aria-label="Статус обращения" value={selected.status} onChange={event => void updateStatus(event.target.value as FeedbackStatus)} disabled={saving || loading}>{Object.entries(statuses).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}</select></label></header>
          <div className="feedback-thread" aria-busy={loading}>
            {loading && <div className="feedback-loading" role="status"><LoaderCircle size={16} className="spin" /> Обновляем переписку</div>}
            <article className="feedback-message feedback-message-user"><div className="feedback-message-meta"><span className="feedback-avatar">Ты</span><strong>Твоё обращение</strong><time dateTime={selected.createdAt}>{date(selected.createdAt, true)}</time></div><p>{selected.message}</p></article>
            {(selected.attachmentText || selected.attachmentFilename) && <details className="feedback-attached"><summary><Paperclip size={15} /> Приложенный контекст <ChevronRight size={14} /></summary>{selected.attachmentText && <pre>{selected.attachmentText}</pre>}{selected.attachmentFilename && <><a className="feedback-filename feedback-download-attachment" href={`/api/feedback/${selected.id}/attachment`} download><Paperclip size={14} /> {selected.attachmentFilename}</a><img className="feedback-attached-image" src={`/api/feedback/${selected.id}/attachment`} alt="Скриншот из обращения" loading="lazy" /></>}</details>}
            {selected.messages.map(message => <article key={message.id} className={`feedback-message feedback-message-${message.author}`}><div className="feedback-message-meta"><span className={`feedback-avatar ${message.author === 'owner' ? 'owner' : ''}`}>{message.author === 'owner' ? <Wrench size={14} /> : 'Ты'}</span><strong>{message.author === 'owner' ? 'Разработчик' : 'Ты'}</strong><time dateTime={message.createdAt}>{date(message.createdAt, true)}</time></div><p>{message.text}</p></article>)}
            {selected.status === 'resolved' && <div className="feedback-resolved"><Check size={16} /> Обращение отмечено как исправленное. Если проблема осталась, напиши ниже.</div>}
          </div>
          <form className="feedback-reply" onSubmit={reply}><label className="sr-only" htmlFor="feedback-reply">Добавить сообщение</label><textarea id="feedback-reply" placeholder="Добавить подробности или ответить…" value={text} maxLength={10000} onChange={event => setText(event.target.value)} rows={2} disabled={saving} /><button className="btn btn-primary feedback-send" type="submit" disabled={saving || !text.trim()} aria-label="Отправить сообщение">{saving ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}</button><span className="feedback-reply-hint">Переписка доступна тебе и владельцу приложения.</span></form>
        </> : <div className="feedback-empty-state"><div className="feedback-empty-icon"><MessageSquarePlus size={36} strokeWidth={1.35} /></div><span className="eyebrow">Каждая деталь имеет значение</span><h2>Что можно сделать лучше?</h2><p>Расскажи, где возникла ошибка или чего не хватает. Здесь сохранится разговор и будет виден статус обращения.</p><button className="btn btn-primary" onClick={onCreate}><MessageSquarePlus size={17} /> Написать разработчику</button></div>}
      </div>
    </div>
  </section>;
}
