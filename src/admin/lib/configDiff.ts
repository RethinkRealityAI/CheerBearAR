// Pure helpers for the editing model: one draft of the whole config, compared with the last saved copy.
// Arrays are treated as single values (a changed keyword list is one change and is sent whole).

type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ak = Object.keys(a as Obj).filter((k) => (a as Obj)[k] !== undefined);
  const bk = Object.keys(b as Obj).filter((k) => (b as Obj)[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual((a as Obj)[k], (b as Obj)[k]));
}

/** Dotted paths of every changed leaf (arrays and primitives are leaves). */
export function changedPaths(saved: unknown, draft: unknown, prefix = ''): string[] {
  if (isPlainObject(saved) && isPlainObject(draft)) {
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    const out: string[] = [];
    for (const k of keys) out.push(...changedPaths(saved[k], draft[k], prefix ? `${prefix}.${k}` : k));
    return out;
  }
  if ((saved === undefined || saved === '') && (draft === undefined || draft === '')) return [];
  return deepEqual(saved, draft) ? [] : [prefix];
}

/**
 * Maps the server REPLACES instead of merging (src/shared/config.ts REPLACE_PATHS), so a deleted synonym really goes.
 * When anything inside one of these changes, the whole map is sent.
 */
export const ATOMIC_PATHS = ['localClassifier.synonyms', 'localClassifier.examples'];

/**
 * The smallest patch that turns `saved` into `draft` under the server's deep merge (objects merge, lists and the
 * ATOMIC_PATHS maps are replaced). A key removed from any other map cannot be expressed by a merge, so a removed
 * list-valued key is sent as an empty list (harmless).
 */
export function diffPatch(saved: unknown, draft: unknown, path = ''): unknown {
  if (ATOMIC_PATHS.includes(path)) return deepEqual(saved, draft) ? undefined : draft;
  if (isPlainObject(saved) && isPlainObject(draft)) {
    const out: Obj = {};
    for (const k of Object.keys(draft)) {
      if (!(k in saved)) {
        if (draft[k] !== undefined) out[k] = draft[k];
        continue;
      }
      const sub = diffPatch(saved[k], draft[k], path ? `${path}.${k}` : k);
      if (sub !== undefined) out[k] = sub;
    }
    for (const k of Object.keys(saved)) {
      if (!(k in draft) && Array.isArray(saved[k])) out[k] = [];
    }
    return Object.keys(out).length ? out : undefined;
  }
  if ((saved === undefined || saved === '') && (draft === undefined || draft === '')) return undefined;
  return deepEqual(saved, draft) ? undefined : draft;
}

/** Deep merge: objects merge, arrays and primitives replace. Returns a new object. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T));
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function getIn(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), obj);
}

export function setIn<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const base = (isPlainObject(obj) ? obj : {}) as Obj;
  return { ...base, [head]: rest.length ? setIn(base[head], rest.join('.'), value) : value } as T;
}

export function pathIn(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '.');
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
