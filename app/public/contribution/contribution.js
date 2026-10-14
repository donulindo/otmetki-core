(() => {
  let theme='light';
  try { if (localStorage.getItem('otmetki-theme') === 'dark') theme='dark'; } catch {}
  const button=document.querySelector('.theme-button');
  const apply=()=>{document.documentElement.dataset.theme=theme;if(button){button.setAttribute('aria-label',theme==='dark'?'Светлая тема':'Тёмная тема');button.setAttribute('title',theme==='dark'?'Светлая тема':'Тёмная тема');}try{localStorage.setItem('otmetki-theme',theme);}catch{}};
  apply();
  button?.addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';apply();});
  const url=document.body.dataset.publicSourceUrl||'';
  if(!/^https:\/\/github\.com\/donulindo\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/?$/.test(url))return;
  const repo=url.replace(/\/$/,'');
  const isDocs=Boolean(document.querySelector('.documentation-hero'));
  const original=document.querySelector(isDocs?'.contribution-access-card>.btn':'.contribution-hero-actions>.btn');
  if(!original)return;
  const link=document.createElement('a');link.className='btn btn-primary';link.href=isDocs?repo+'/tree/main/docs':repo;link.target='_blank';link.rel='noopener noreferrer';link.textContent=isDocs?'Открыть документы ↗':'Открытая часть на GitHub ↗';original.replaceWith(link);
  const note=isDocs?document.querySelector('.contribution-access-card>.contribution-fine'):document.querySelector('.contribution-hero>div>.contribution-fine');note?.remove();
})();
