export type ModelId = 'gpt-6.1-sol' | 'gpt-6-luna';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type MaterialKind = 'lecture' | 'seminar' | 'homework' | 'rules' | 'notes';
export type MaterialStatus = 'queued' | 'extracting' | 'ready' | 'limited' | 'error';
export interface Viewer { id: string; displayName: string; group: string; role: 'owner'|'student'; faculty?:string; direction?:string; course?:number; academicYear?:string; semester?:number; }
export interface Subject { id: string; name: string; shortName: string; direction: 'management' | 'economics'; group: string; semester: number; color: string; }
export interface TextBlock { id: string; text: string; kind: 'text' | 'table' | 'formula' | 'image'; page?: number; slide?: number; warning?: string; imageFile?: string; }
export interface Material {
  hasOriginal?:boolean;
  access?: {scope:string;canEdit:boolean;canArchive:boolean;audienceId:string|null;audienceLabel?:string};
  id: string; ownerId: string; title: string; subjectId: string; kind: MaterialKind; topic: string;
  filename: string; mimeType: string; size: number; version: number; status: MaterialStatus;
  warnings: string[]; blocks: TextBlock[]; pageCount: number; sourceUrl: string | null;
  createdAt: string; updatedAt: string; hash: string; duplicateOf: string | null; isExample: boolean;
}
export interface Chat {
  id: string; ownerId: string; title: string; subjectId: string; kind: 'work' | 'tutor';
  model: ModelId; effort: Effort; contextIds: string[]; createdAt: string; updatedAt: string;
  generationState: 'idle' | 'submitted' | 'streaming' | 'completed' | 'stopped' | 'error';
}
export type FeedbackStatus = 'received' | 'clarification' | 'in_progress' | 'resolved';
export interface FeedbackMessage { id: string; author: 'user' | 'owner'; text: string; createdAt: string; }
export interface Feedback {
  id: string; ownerId: string; subject: string; message: string; status: FeedbackStatus;
  targetType: 'general' | 'material' | 'chat'; targetId: string | null; targetVersion: number | null;
  attachmentText: string | null; attachmentFilename: string | null; messages: FeedbackMessage[];
  createdAt: string; updatedAt: string;
}
