'use client';
import {PRODUCT_NAME,PRODUCT_TITLE,PRODUCT_FUNCTIONS} from '@/lib/brand';

import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Check,GitBranch,LockKeyhole,Moon,Sun,Users} from 'lucide-react';

export default function ContributionPage({repositoryUrl}:{repositoryUrl:string|null}) {
  const [theme,setTheme]=useState('light');
  useEffect(()=>{try{if(localStorage.getItem('otmetki-theme')==='dark')setTheme('dark');}catch{}},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('otmetki-theme',theme);}catch{}},[theme]);
  return <div className="contribution-page">
    <header className="contribution-header"><a className="brand" href="/"><img src="/mark.svg" alt=""/><span>{PRODUCT_NAME}<span className="brand-dot">.</span></span></a><nav aria-label="Совместная разработка">{repositoryUrl&&<a href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="Открытый код на GitHub"><GitBranch size={17}/>GitHub</a>}<button className="icon-button theme-button" onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label={theme==='light'?'Тёмная тема':'Светлая тема'}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button></nav></header>
    <main className="contribution-main">
      <a className="contribution-back" href="/"><ArrowLeft size={14}/>К приложению</a>
      <section className="contribution-hero"><div><span className="eyebrow">РАЗВИВАЕМ ВМЕСТЕ</span><h1>Твоя идея.<br/><em>Общее улучшение.</em></h1><p>Делаем учебное пространство для первого курса экономического факультета МГУ — экономики и менеджмента. Поддержка остальных курсов и факультетов ещё в разработке.</p><div className="contribution-hero-actions">{repositoryUrl?<a className="btn btn-primary" href={repositoryUrl} target="_blank" rel="noopener noreferrer"><GitBranch size={18}/>Открытая часть на GitHub<ArrowUpRight size={18}/></a>:<button className="btn btn-primary" disabled><GitBranch size={18}/>Открытая часть готовится</button>}</div></div><div className="contribution-hero-art" aria-hidden="true"><GitBranch size={73}/><span>Меньше препятствий.<br/>Больше полезного.</span><i>M</i></div></section>
      <section className="contribution-access" id="access"><div><span className="eyebrow">ХОЧЕШЬ ПОМОЧЬ?</span><h2>Есть что<br/><em>улучшить.</em></h2><p>Предлагай изменения в открытом репозитории. Документация и инструкции для работы находятся рядом с кодом.</p><p>Предложить правку может любой. Для её принятия нужен действующий одобренный статус разработчика и отдельное решение владельца.</p></div><div className="contribution-access-card"><Users size={25}/><h3>Участие в разработке</h3><p>Порядок подачи заявки и подтверждения профиля обсудим отдельно. Статус не открывает доступ к личным материалам, админке или рабочему серверу.</p><button className="btn btn-secondary" disabled><LockKeyhole size={16}/>Приём заявок готовится</button></div></section>
      <footer className="contribution-footer"><span>{PRODUCT_NAME} · совместная разработка</span><span><Check size={13}/>Открытая часть — Apache 2.0</span></footer>
    </main>
  </div>;
}
