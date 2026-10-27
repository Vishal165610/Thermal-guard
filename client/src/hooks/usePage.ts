import { useCallback, useEffect, useState } from 'react';

export type PageId = 'overview' | 'twin' | 'fix' | 'analytics' | 'alerts';
export const PAGES: PageId[] = ['overview', 'twin', 'fix', 'analytics', 'alerts'];

const read = (): PageId => {
  const h = window.location.hash.replace('#/', '');
  return (PAGES as string[]).includes(h) ? (h as PageId) : 'overview';
};

/** Tiny hash router: #/overview, #/twin, ... No extra library needed. */
export function usePage(): [PageId, (p: PageId) => void] {
  const [page, setPage] = useState<PageId>(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((p: PageId) => {
    window.location.hash = `#/${p}`;
  }, []);
  return [page, go];
}
