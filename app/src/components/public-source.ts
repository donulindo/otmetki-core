/** Only an explicitly reviewed repository in the neutral project organisation is publishable. */
export function publicRepositoryUrl(value: string | undefined, verified: string | undefined): string | null {
  if (verified !== 'true') return null;
  const url = value?.trim() ?? '';
  return /^https:\/\/github\.com\/donulindo\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/?$/.test(url) ? url.replace(/\/$/, '') : null;
}
