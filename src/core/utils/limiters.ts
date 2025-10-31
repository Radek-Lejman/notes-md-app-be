export function createPerKeyLimiter(maxPerKey: number) {
  const counters = new Map<string, number>();

  function allow(key: string | null | undefined): boolean {
    if (!key) return false;

    const current = counters.get(key) ?? 0;
    if (current >= maxPerKey) {
      return false;
    }

    counters.set(key, current + 1);
    return true;
  }

  return { allow };
}
