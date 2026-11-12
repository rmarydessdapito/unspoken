import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Collection, Voicemail } from '../db/types';
import { isLocked } from '../lib/library';
import { useImageUrl } from '../hooks/useImageUrl';
import { Cover } from './Cover';

function Tile({ vm }: { vm: Voicemail }) {
  const url = useImageUrl(vm.coverId);
  return url ? <img src={url} alt="" draggable={false} /> : <Cover imageId={null} seed={vm.id} title="" peaks={vm.peaks} size="sm" className="mosaic-gen" />;
}

/**
 * A collection's cover: the picture you chose, or — like a playlist — a 2×2 mosaic of the voicemails inside.
 * Sealed voicemails never appear in the mosaic.
 */
export function CollectionCover({ collection, size = 'md' }: { collection: Collection; size?: 'md' | 'lg' }) {
  const members = useLiveQuery(async () => {
    const list = await db.voicemails.bulkGet(collection.voicemailIds.slice(0, 12));
    return list.filter((v): v is Voicemail => !!v && v.status === 'saved' && !isLocked(v)).slice(0, 4);
  }, [collection.voicemailIds.join(',')]);

  if (collection.coverId || !members || members.length < 4) {
    const withImage = members?.find((m) => m.coverId);
    return (
      <Cover
        imageId={collection.coverId ?? withImage?.coverId ?? null}
        seed={collection.id + 'c'}
        title={collection.title}
        size={size}
      />
    );
  }
  return (
    <div className={`cover cover-${size} cover-mosaic`} aria-hidden="true">
      {members.map((m) => (
        <Tile key={m.id} vm={m} />
      ))}
    </div>
  );
}
