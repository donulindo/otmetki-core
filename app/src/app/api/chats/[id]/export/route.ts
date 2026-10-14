import {requireViewer} from '@/lib/auth';
import {authorizeChat,apiError,routeId} from '@/lib/api';
import {listMessages} from '@/lib/db';
import {exportWord,messageText} from '@/lib/document-export';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const viewer=requireViewer(request);const id=await routeId(context);const chat=authorizeChat(viewer,id);const messages=listMessages(id,viewer.id);
    if(new URL(request.url).searchParams.get('format')==='txt')return new Response(messages.map(m=>`${m.role==='user'?'Твой вопрос':'Ответ помощника'}\n${messageText(m)}`).join('\n\n'),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="msu-chat.txt"','Cache-Control':'no-store'}});
    const bytes=await exportWord(chat.title,messages);
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':'attachment; filename="msu-chat.docx"','Cache-Control':'no-store'}});
  }catch(error){return apiError(error);}
}
