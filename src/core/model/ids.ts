let counter = 0;

/** Short, sortable, collision-resistant ids (good enough for client-side models). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const t = Date.now().toString(36).slice(-5);
  const c = counter.toString(36).padStart(4, '0');
  const r = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return `${prefix}${t}${c}${r}`;
}

/** Deterministic id generator for reproducible model generation and tests. */
export function seededIds(prefix: string) {
  let n = 0;
  return (kind: string) => `${prefix}${kind}${(++n).toString(36)}`;
}
