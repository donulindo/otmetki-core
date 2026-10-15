'use client';

import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

/** The server replays the complete response when reattaching, including its start. */
export class PreviewChatTransport extends DefaultChatTransport<UIMessage> {
  readonly resumeStreamIsReplay = true;
}

export function createPreviewChat({id,messages,onFinish,fetcher}: {
  id:string;
  messages:UIMessage[];
  onFinish?:()=>void;
  fetcher?:typeof fetch;
}) {
  const transport=new PreviewChatTransport({
    api:'/api/chat',
    body:{chatId:id},
    fetch:async(input,init)=>{
      const result=await (fetcher??fetch)(input,init);
      if(!result.ok){
        const data=await result.clone().json().catch(()=>({}));
        if(result.status===401&&typeof window!=='undefined')window.location.assign('/');
        throw new Error(data.error||'Не удалось получить ответ. Сообщение сохранено; можно попробовать снова.');
      }
      return result;
    },
  });
  // Passing this instance to useChat avoids its options-transport wrapper, which
  // currently drops resumeStreamIsReplay in @ai-sdk/react 4.0.140.
  return new Chat<UIMessage>({id,messages,transport,onFinish});
}
