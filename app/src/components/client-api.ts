export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.location.assign('/');
    throw new Error(typeof data.error === 'string' ? data.error : 'Не получилось выполнить действие. Попробуйте ещё раз.');
  }
  return data as T;
}
export async function downloadContext(materialIds: string[], subjectId: string) {
  const response = await fetch('/api/context/export', { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({materialIds, subjectId}) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Не удалось собрать текст.'); }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'msu-context.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const kindNames: Record<string, string> = {lecture:'Лекция',seminar:'Семинар',homework:'Задание',rules:'Правила',notes:'Заметки'};
export const statusNames: Record<string,string> = {queued:'В очереди',extracting:'Читаем материал',ready:'Готов для ИИ',limited:'Есть ограничения',error:'Нужна проверка'};
export function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(value)); }
export function plural(count: number, one: string, few: string, many: string) { const ten=count%10, hundred=count%100; return hundred>=11&&hundred<=14?many:ten===1?one:ten>=2&&ten<=4?few:many; }
