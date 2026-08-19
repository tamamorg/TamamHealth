export type ShellHistoryKind = 'chart' | 'sheet';

const entries: Partial<Record<ShellHistoryKind, string>> = {};

/** Mark a URL entry created by the shell so its close action can pop it. */
export function recordShellHistoryEntry(kind: ShellHistoryKind, target: string): void {
  entries[kind] = target;
}

/**
 * Consume a matching shell-created entry. A direct deep link has no marker and
 * must be closed with `replace`, otherwise `back()` could leave the platform.
 */
export function consumeShellHistoryEntry(kind: ShellHistoryKind, current: string): boolean {
  if (entries[kind] !== current) return false;
  delete entries[kind];
  return true;
}
