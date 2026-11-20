import { useVault } from '../store/vault';
import { getIndex } from '../store/vaultIndex';
import type { RenderContext } from '../lib/markdown';

const urls = new Map<string, { blob: Blob; url: string }>();

/** Object URL for an attachment, created once per blob. */
export function resourceUrl(path: string) {
  const blob = useVault.getState().files[path]?.blob;
  if (!blob) return null;
  const hit = urls.get(path);
  if (hit?.blob === blob) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(blob);
  urls.set(path, { blob, url });
  return url;
}

export function renderContext(): RenderContext {
  const index = getIndex();
  return {
    resolve: index.resolve,
    resourceUrl,
    noteContent: (p) => index.byPath.get(p)?.content ?? null,
  };
}
