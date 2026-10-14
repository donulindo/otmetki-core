import 'server-only';
import {createOpenAI} from '@ai-sdk/openai';
import type {ModelId} from './types';

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
export function languageModel(model: ModelId) {
  if (!aiConfigured()) throw new Error('AI_UNAVAILABLE');
  if (!['gpt-6.1-sol', 'gpt-6-luna'].includes(model)) throw new Error('INVALID_MODEL');
  return createOpenAI({baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY}).responses((model==='gpt-6.1-sol'?process.env.MODEL_SOL_ID:process.env.MODEL_LUNA_ID)||model);
}

type Waiter = {priority: 'foreground' | 'background'; resolve: (release: () => void) => void; reject: (error: Error) => void; signal?: AbortSignal};
const globalQueue = globalThis as typeof globalThis & {__otmetkiAI?: {active: number; waiters: Waiter[]}};
const queue = globalQueue.__otmetkiAI ??= {active: 0, waiters: []};
function drain() {
  queue.waiters.sort((a,b) => Number(a.priority === 'background') - Number(b.priority === 'background'));
  while (queue.active < 2 && queue.waiters.length) {
    const waiter = queue.waiters.shift()!;
    if (waiter.signal?.aborted) {waiter.reject(new Error('ABORTED')); continue;}
    queue.active++;
    let released = false;
    waiter.resolve(() => {if (!released) {released = true; queue.active--; drain();}});
  }
}
export function acquireAI(priority: 'foreground' | 'background', signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve,reject) => {
    if (signal?.aborted) {reject(new Error('ABORTED')); return;}
    const waiter: Waiter = {priority,resolve,reject,signal};
    queue.waiters.push(waiter);
    signal?.addEventListener('abort', () => {
      const i = queue.waiters.indexOf(waiter);
      if (i >= 0) {queue.waiters.splice(i,1);reject(new Error('ABORTED'));}
    }, {once: true});
    drain();
  });
}
