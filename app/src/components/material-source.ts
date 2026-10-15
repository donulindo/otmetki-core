import type { Material } from '../lib/types';

/** A downloaded document may retain its attribution URL without becoming a link-only entry. */
export function isLinkOnly(material: Pick<Material, 'mimeType'>) {
  return material.mimeType === 'text/uri-list';
}

export function hasOriginal(material:Pick<Material,'hasOriginal'|'filename'|'mimeType'>){return !isLinkOnly(material)&&(material.hasOriginal??Boolean(material.filename));}
