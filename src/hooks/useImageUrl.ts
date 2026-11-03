import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

/** Object URL for a stored image id (cover art, photos). Revoked automatically. */
export function useImageUrl(id: string | null | undefined): string | null {
  const blob = useLiveQuery(async () => (id ? ((await db.images.get(id))?.blob ?? null) : null), [id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
