import type {UIMessage} from 'ai';
import type {Viewer} from './types';
import {accessibleMaterial} from './platform';
export function messagesForClient(messages:UIMessage[]):UIMessage[]{return messages.map(message=>({...message,parts:message.parts.map((p:any)=>p.type.startsWith('tool-')||p.type==='dynamic-tool'?{...p,input:{},output:{reviewed:true},rawInput:undefined,preliminary:undefined}:p)})) as UIMessage[];}
/** Keep old answers visible, but never automatically resend revoked source content to a model. */
export function messagesForModel(viewer:Viewer,messages:UIMessage[]){return messages.filter(m=>{const refs=(m.metadata as any)?.contextSources as {id:string;version:number}[]|undefined;return !refs||refs.every(r=>!!accessibleMaterial(viewer,r.id,r.version));});}
