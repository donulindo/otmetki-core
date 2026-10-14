'use client';
import {PRODUCT_NAME,PRODUCT_TITLE,PRODUCT_FUNCTIONS} from '@/lib/brand';

import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, LockKeyhole, ShieldCheck, LoaderCircle, BookOpen, Sparkles, MessageCircle } from 'lucide-react';

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

export default function LoginScreen() {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [telegramReady, setTelegramReady] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState('');
  useEffect(() => {
    fetch('/api/session').then(r => r.json()).then(data => { setTelegramEnabled(Boolean(data.configured?.telegram)); if (typeof data.telegramBotUsername === 'string' && /^[a-zA-Z0-9_]+$/.test(data.telegramBotUsername)) setTelegramUsername(data.telegramBotUsername); }).catch(() => {});
    const check = () => {
      const app = window.Telegram?.WebApp;
      if (app?.initData) { setTelegramReady(true); app.ready?.(); app.expand?.(); }
    };
    check();
    const timer = setInterval(check, 500);
    return () => clearInterval(timer);
  }, []);
  async function login(kind: 'local' | 'telegram') {
    setBusy(true); setError('');
    try {
      const body = kind === 'telegram' ? { initData: window.Telegram?.WebApp?.initData ?? '' } : { passcode };
      const response = await fetch(`/api/auth/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось войти. Проверьте данные и попробуйте снова.');
      window.location.assign('/');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось войти.'); }
    finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-brand"><span>{PRODUCT_NAME}<span className="brand-dot">.</span></span><span className="login-preview">закрытый предпросмотр</span></div>
    <main className="login-main">
      <section className="login-story">
        <div className="eyebrow"><span className="tiny-dot" /> УЧЁБА СТАНОВИТСЯ ЯСНЕЕ</div>
        <h1>Твои материалы.<br />Твои вопросы.<br /><em>Твой темп.</em></h1>
        <p>Лекции, семинары и спокойный разговор с ИИ — в одном пространстве. Чтобы разбираться, а не искать по чатам.</p>
        <div className="login-features"><span><BookOpen size={17} /> Материалы с источниками</span><span><Sparkles size={17} /> Sol и Luna</span><span><MessageCircle size={17} /> Чат по твоему предмету</span></div>
        <div className="login-orbit" aria-hidden="true"><div className="orbit-line" /><div className="orbit-card"><span>Всему своё место</span><strong>Меньше суеты.<br />Больше понимания.</strong><ArrowUpRight size={28}/></div><div className="orbit-mark">M</div></div>
      </section>
      <section className="login-card">
        <div className="lock-tile"><LockKeyhole size={25}/></div>
        <span className="eyebrow">ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА</span>
        <h2>Добро пожаловать<br />в мастерскую.</h2>
        <p>Здесь новые возможности можно проверить до выпуска. Доступ проверяется отдельно от имени в профиле.</p>
        <form onSubmit={e => { e.preventDefault(); void login('local'); }}>
          <label className="field"><span>Ключ доступа</span><input type="password" autoComplete="current-password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="Введите закрытый ключ" required disabled={busy}/></label>
          {error && <p className="error-note" role="alert">{error}</p>}
          <button className="btn btn-primary login-submit" type="submit" disabled={busy || !passcode}>{busy ? <LoaderCircle size={18} className="spin"/> : <>Открыть пространство <ArrowRight size={19}/></>}</button>
        </form>
        {telegramEnabled && <><div className="login-divider"><span>или</span></div><button className="btn btn-secondary login-submit" disabled={busy || !telegramReady} onClick={() => void login('telegram')}><MessageCircle size={18}/>Войти через Telegram</button>{!telegramReady && <p className="small muted">Для входа через Telegram откройте предпросмотр из {telegramUsername ? <a className="login-bot-link" href={`https://t.me/${telegramUsername}`} target="_blank" rel="noopener noreferrer">тестового бота</a> : 'тестового бота'}.</p>}</>}
        <div className="login-safety"><ShieldCheck size={18}/><span>Отдельное пространство для проверки.<br />Учебные действия в рабочем боте не выполняются.</span></div>
      </section>
    </main>
    <footer className="login-footer">{PRODUCT_TITLE} <a href="/contribute">Совместная разработка <ArrowUpRight size={13}/></a></footer>
  </div>;
}
