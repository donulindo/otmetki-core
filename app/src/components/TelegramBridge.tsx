'use client';
import {useEffect} from 'react';
export default function TelegramBridge({canGoBack,onBack}:{canGoBack:boolean;onBack:()=>void}){
 useEffect(()=>{let cleanup=()=>{};let tries=0;const timer=setInterval(()=>{const tg=(window as any).Telegram?.WebApp;if(!tg?.initData){if(++tries>30)clearInterval(timer);return;}clearInterval(timer);tg.ready?.();tg.expand?.();const update=()=>{document.documentElement.style.setProperty('--app-height',`${tg.viewportHeight||window.innerHeight}px`);document.documentElement.style.setProperty('--tg-safe-top',`${tg.contentSafeAreaInset?.top||0}px`);};update();tg.onEvent?.('viewportChanged',update);tg.onEvent?.('contentSafeAreaChanged',update);if(canGoBack){tg.BackButton?.show();tg.BackButton?.onClick(onBack);}else tg.BackButton?.hide();cleanup=()=>{tg.offEvent?.('viewportChanged',update);tg.offEvent?.('contentSafeAreaChanged',update);tg.BackButton?.offClick(onBack);tg.BackButton?.hide();};},100);return()=>{clearInterval(timer);cleanup();};},[canGoBack,onBack]);
 return null;
}
