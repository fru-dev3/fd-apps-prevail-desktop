// Keeping turns another writer appended to an open thread. A conversation
// schedule runs on the hub and appends its turn to the thread's .md file. If
// that thread is open here, the next autosave would write the in-memory copy
// over the file and lose the scheduled turn. Before saving, the chat re-reads
// the file: anything past the turn count it last loaded or saved is new from
// outside, and it is folded in rather than overwritten.
//
// Counting against the last synced size (rather than diffing content) keeps
// deliberate edits working: "edit from here" or "retry" shortens the open
// copy on purpose, and the file must follow it, not resurrect the old turns.

export type TurnLike = { role: string; content: string };

/**
 * `mem`: the open transcript. `disk`: the file's turns now. `synced`: how many
 * turns the file had when this view last loaded or saved it.
 * Returns the merged transcript when the file gained turns from outside, or
 * null when there is nothing to keep (save the open copy as is).
 */
export function mergeExternalTurns<T extends TurnLike>(mem: T[], disk: T[], synced: number): T[] | null {
  if (synced < 0 || disk.length <= synced) return null;
  const outside = disk.slice(synced);
  const head = mem.slice(0, Math.min(synced, mem.length));
  const tail = mem.slice(synced);
  // Already folded in (the open copy carries them in the same place).
  const same = (a: T, b: T) => a.role === b.role && a.content === b.content;
  if (tail.length >= outside.length && outside.every((t, k) => same(t, tail[k]))) return null;
  return [...head, ...outside, ...tail];
}
