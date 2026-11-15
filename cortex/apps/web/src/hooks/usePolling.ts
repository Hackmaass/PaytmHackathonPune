import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll an endpoint on an interval.
 * `enabled` lets a caller keep the hook order stable while only paying for the
 * request on the surface that actually renders the data (mobile counter vs the
 * desktop dashboard, which has its own pollers).
 */
export function usePolling<T>(fetchFn: () => Promise<T>, intervalMs = 5000, enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const refresh = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      setData(result);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs, enabled]);

  return { data, loading, error, refresh };
}
