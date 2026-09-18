/**
 * Process-wide singletons keyed on globalThis. Next.js may instantiate a module more than once
 * (per route chunk, on hot reload); registries, caches and AsyncLocalStorage instances must be
 * shared by every copy or contexts and registrations silently diverge.
 */
export function globalSingleton<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T | undefined>;
  const k = `__deptts_${key}`;
  if (g[k] === undefined) g[k] = init();
  return g[k] as T;
}
