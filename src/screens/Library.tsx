import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { createCollection, setSetting } from '../db/repo';
import { MOODS, type Collection, type CollectionSortKey, type SortKey } from '../db/types';
import { CollectionCover } from '../components/CollectionCover';
import { Icon } from '../components/Icon';
import { LibrarySkeleton } from '../components/Skeleton';
import { Sheet } from '../components/Sheet';
import { VoicemailCard, VoicemailRow } from '../components/VoicemailItem';
import { useSettings } from '../hooks/useSettings';
import { formatDuration, plural } from '../lib/format';
import { activeFilterCount, allTags, EMPTY_FILTERS, filterVoicemails, SORT_LABELS, sortVoicemails, type LibraryFilters } from '../lib/library';
import { PageHeader } from './parts';

// remembered while the app is open, so opening a voicemail and coming back keeps your search and filters
let rememberedFilters: LibraryFilters = EMPTY_FILTERS;

const COLLECTION_SORT_LABELS: Record<CollectionSortKey, string> = { recent: 'recently changed', title: 'a → z', size: 'most voicemails' };

export function sortCollections(list: Collection[], sort: CollectionSortKey): Collection[] {
  const by: Record<CollectionSortKey, (a: Collection, b: Collection) => number> = {
    recent: (a, b) => b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    size: (a, b) => b.voicemailIds.length - a.voicemailIds.length || a.title.localeCompare(b.title),
  };
  return [...list].sort((a, b) => by[sort](a, b) || a.id.localeCompare(b.id));
}

export function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'collections' ? 'collections' : 'voicemails';
  const settings = useSettings();
  const saved = useLiveQuery(() => db.voicemails.where('status').equals('saved').toArray(), []);
  const allCollectionsRaw = useLiveQuery(() => db.collections.toArray(), []);
  const allCollections = allCollectionsRaw ?? [];
  const collections = useMemo(() => sortCollections(allCollections, settings.collectionSort), [allCollections, settings.collectionSort]);
  const deletedCount = useLiveQuery(() => db.voicemails.where('status').equals('deleted').count(), []) ?? 0;
  // a #tag link opens the library filtered to that tag; otherwise pick up where you left off
  const [filters, setFilters] = useState<LibraryFilters>(() => (params.get('tag') ? { ...EMPTY_FILTERS, tag: params.get('tag') } : rememberedFilters));
  useEffect(() => {
    rememberedFilters = filters;
  }, [filters]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [newCol, setNewCol] = useState(false);
  const [colName, setColName] = useState('');
  const [colDesc, setColDesc] = useState('');

  const tags = useMemo(() => allTags(saved ?? []), [saved]);
  const results = useMemo(
    () => sortVoicemails(filterVoicemails(saved ?? [], filters, collections), settings.librarySort),
    [saved, filters, collections, settings.librarySort],
  );
  const totalMs = (saved ?? []).reduce((a, v) => a + v.durationMs, 0);
  const nFilters = activeFilterCount(filters);

  // tell screen-reader users how many matched — once, after they stop typing, not on every keystroke
  const [resultNote, setResultNote] = useState('');
  const resultCount = results.length;
  const searching = nFilters > 0 || filters.query.trim() !== '';
  useEffect(() => {
    if (saved === undefined || !searching) {
      setResultNote('');
      return;
    }
    const t = setTimeout(() => setResultNote(resultCount ? `${plural(resultCount, 'voicemail')} found.` : 'no voicemails match.'), 700);
    return () => clearTimeout(t);
  }, [saved, searching, resultCount]);

  return (
    <main className="screen library">
      <p className="sr-only" role="status">
        {resultNote}
      </p>
      <PageHeader title="my unspoken" eyebrow={saved ? `${plural(saved.length, 'voicemail')} · ${formatDuration(totalMs)} of you` : undefined} />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'voicemails'} className={`tab ${tab === 'voicemails' ? 'on' : ''}`} onClick={() => setParams({})}>
          voicemails
        </button>
        <button
          role="tab"
          aria-selected={tab === 'collections'}
          className={`tab ${tab === 'collections' ? 'on' : ''}`}
          onClick={() => setParams({ tab: 'collections' })}
        >
          collections
        </button>
      </div>

      {tab === 'voicemails' ? (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={18} />
              <input
                type="search"
                placeholder="search titles, words, moods, #tags…"
                value={filters.query}
                onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                aria-label="search voicemails"
              />
            </label>
            <button className={`icon-btn ${nFilters ? 'has-badge' : ''}`} onClick={() => setFilterOpen(true)} aria-label="filters">
              <Icon name="filter" />
              {nFilters > 0 && <span className="badge">{nFilters}</span>}
            </button>
            <button
              className="icon-btn"
              onClick={() => setSetting('libraryView', settings.libraryView === 'grid' ? 'list' : 'grid')}
              aria-label={settings.libraryView === 'grid' ? 'show as list' : 'show as grid'}
            >
              <Icon name={settings.libraryView === 'grid' ? 'list' : 'grid'} />
            </button>
          </div>

          <div className="sort-row">
            <label className="sort">
              <span className="muted small">sort</span>
              <select value={settings.librarySort} onChange={(e) => setSetting('librarySort', e.target.value as SortKey)} aria-label="sort by">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            {(nFilters > 0 || filters.query) && (
              <button className="link small" onClick={() => setFilters(EMPTY_FILTERS)}>
                clear · {results.length} found
              </button>
            )}
          </div>

          {saved && saved.length === 0 && (
            <div className="empty-big">
              <p className="serif display-sm">nothing here yet.</p>
              <p className="muted">every voicemail you keep becomes a little album cover on this shelf.</p>
              <Link to="/record?start=1" className="btn btn-gold">
                leave a voicemail
              </Link>
            </div>
          )}
          {saved && saved.length > 0 && results.length === 0 && (
            <div className="empty">
              <p>
                nothing matches {filters.query ? <>“{filters.query}”</> : 'that'}
                {nFilters > 0 ? ` with ${plural(nFilters, 'filter')} on` : ''}.
              </p>
              <button className="link" onClick={() => setFilters(EMPTY_FILTERS)}>
                clear search and filters
              </button>
            </div>
          )}

          {saved === undefined ? (
            <LibrarySkeleton view={settings.libraryView} />
          ) : settings.libraryView === 'grid' ? (
            <div className="grid">
              {results.map((vm) => (
                <VoicemailCard key={vm.id} vm={vm} />
              ))}
            </div>
          ) : (
            <div className="list">
              {results.map((vm) => (
                <VoicemailRow key={vm.id} vm={vm} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button className="new-col" onClick={() => setNewCol(true)}>
            <Icon name="plus" /> start a new collection
          </button>
          {collections.length > 1 && (
            <div className="sort-row">
              <label className="sort">
                <span className="muted small">sort</span>
                <select
                  value={settings.collectionSort}
                  onChange={(e) => setSetting('collectionSort', e.target.value as CollectionSortKey)}
                  aria-label="sort collections by"
                >
                  {(Object.keys(COLLECTION_SORT_LABELS) as CollectionSortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {COLLECTION_SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="grid">
            {collections.map((c) => (
              <Link key={c.id} to={`/collection/${c.id}`} className="col-card">
                <CollectionCover collection={c} />
                <span className="card-title">{c.title}</span>
                <span className="card-sub">{plural(c.voicemailIds.length, 'voicemail')}</span>
              </Link>
            ))}
          </div>
          {allCollectionsRaw !== undefined && !collections.length && <p className="empty">late night thoughts, people i love, letters to future me… make a home for them.</p>}
        </>
      )}

      {deletedCount > 0 && (
        <Link to="/deleted" className="deleted-link small">
          <Icon name="trash" size={14} /> recently deleted · {deletedCount}
        </Link>
      )}

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="filter">
        <div className="form">
          <div className="field">
            <span className="label">mood</span>
            <div className="chips">
              {MOODS.map((m) => (
                <button
                  key={m}
                  className={`chip ${filters.mood === m ? 'is-on' : ''}`}
                  onClick={() => setFilters({ ...filters, mood: filters.mood === m ? null : m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {tags.length > 0 && (
            <div className="field">
              <span className="label">tag</span>
              <div className="chips">
                {tags.map((t) => (
                  <button
                    key={t}
                    className={`chip ${filters.tag === t ? 'is-on' : ''}`}
                    onClick={() => setFilters({ ...filters, tag: filters.tag === t ? null : t })}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {collections.length > 0 && (
            <label className="field">
              <span className="label">collection</span>
              <select className="input" value={filters.collectionId ?? ''} onChange={(e) => setFilters({ ...filters, collectionId: e.target.value || null })}>
                <option value="">any</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field-row">
            <label className="field">
              <span className="label">from</span>
              <input type="date" className="input" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.target.value || null })} />
            </label>
            <label className="field">
              <span className="label">to</span>
              <input type="date" className="input" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.target.value || null })} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">at least (min)</span>
              <input
                type="number"
                min={0}
                className="input"
                value={filters.minMinutes ?? ''}
                onChange={(e) => setFilters({ ...filters, minMinutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
              />
            </label>
            <label className="field">
              <span className="label">at most (min)</span>
              <input
                type="number"
                min={0}
                className="input"
                value={filters.maxMinutes ?? ''}
                onChange={(e) => setFilters({ ...filters, maxMinutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
              />
            </label>
          </div>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => setFilters({ ...EMPTY_FILTERS, query: filters.query })}>
              reset
            </button>
            <button className="btn btn-gold" onClick={() => setFilterOpen(false)}>
              show {results.length}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={newCol} onClose={() => setNewCol(false)} title="a new collection">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            await createCollection(colName, colDesc.trim());
            setColName('');
            setColDesc('');
            setNewCol(false);
          }}
        >
          <label className="field">
            <span className="label">name</span>
            <input
              className="input input-serif"
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              placeholder="people i love"
              maxLength={60}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="label">what's it for? (optional)</span>
            <textarea className="input" rows={2} value={colDesc} onChange={(e) => setColDesc(e.target.value)} maxLength={500} />
          </label>
          <div className="sheet-actions">
            <button type="submit" className="btn btn-gold" disabled={!colName.trim()}>
              create
            </button>
          </div>
        </form>
      </Sheet>
    </main>
  );
}
