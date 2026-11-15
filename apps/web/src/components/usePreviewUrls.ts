import { useEffect, useRef, useState, type DependencyList } from "react";

export type Urls = Record<string, string | null | undefined>;

/** Picture URLs made by `make`, remade when `deps` change. Blob URLs are released once replaced. */
export function useUrls(make: (signal: AbortSignal) => Promise<Urls> | null, deps: DependencyList): Urls {
  const [urls, setUrls] = useState<Urls>({});
  const held = useRef<Urls>({});
  const release = () => Object.values(held.current).forEach((u) => u?.startsWith("blob:") && URL.revokeObjectURL(u));
  useEffect(() => {
    const ac = new AbortController();
    const keep = (r: Urls) => {
      if (ac.signal.aborted) return;
      release();
      held.current = r;
      setUrls(r);
    };
    const job = make(ac.signal);
    if (job) job.then(keep, () => {});
    else keep({});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => release, []);
  return urls;
}
