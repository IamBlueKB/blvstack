/** Shared thread model for the JANET panel — one thread, two presentations
 *  (docked command stream + expanded spatial canvas). */
export type ThreadItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; status: 'running' | 'done'; ok?: boolean; summary?: string }
  | { kind: 'error'; text: string };
