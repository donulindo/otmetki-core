import type {Subject} from './types';

/** Group comes from the authenticated profile, never from a catalog query or typed name. */
export function profileDirection(group:string):Subject['direction']|null {
  const normalized=group.trim().toUpperCase();
  if(/^[MМ]\d+$/u.test(normalized))return 'management';
  if(/^[EЭ]\d+$/u.test(normalized))return 'economics';
  return null;
}
export function subjectsForProfile(subjects:Subject[],group:string) {
  const direction=profileDirection(group);
  return direction?subjects.filter(subject=>subject.direction===direction):[];
}
