export interface VaultFile {
  path: string;
  kind: 'note' | 'binary';
  /** Markdown text for notes, '' for binaries. */
  content: string;
  blob?: Blob;
  mtime: number;
  hash: string;
  /** Server revision this copy is based on; 0 when the server has never seen it. */
  baseRev: number;
  /** Changed locally since the last sync. */
  dirty: boolean;
  /** Tombstone waiting to be synced. */
  deleted: boolean;
}

/** live: rendered while you type; source: raw markdown; preview: reading view. */
export type EditorMode = 'live' | 'source' | 'preview' | 'split';

export interface Settings {
  syncUrl: string;
  token: string;
  dailyFolder: string;
  dailyTemplate: string;
  templateFolder: string;
  attachmentFolder: string;
  editorMode: EditorMode;
}
