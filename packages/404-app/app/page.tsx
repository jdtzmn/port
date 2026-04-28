'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { WorktreeEntry, ServiceEntry } from '@/lib/docker'

const ASCII_LOGO = `\
                   ██
████▄ ▄███▄ ████▄ ▀██▀▀
██ ██ ██ ██ ██ ▀▀  ██
████▀ ▀███▀ ██     ██
██
▀▀`

// ---------------------------------------------------------------------------
// Highlight helpers
// ---------------------------------------------------------------------------

interface Segment {
  text: string
  match: boolean
}

function highlight(text: string, query: string): Segment[] {
  if (!query) return [{ text, match: false }]

  const segments: Segment[] = []
  const lower = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let i = 0

  while (i < text.length) {
    const idx = lower.indexOf(lowerQuery, i)
    if (idx === -1) {
      segments.push({ text: text.slice(i), match: false })
      break
    }
    if (idx > i) {
      segments.push({ text: text.slice(i, idx), match: false })
    }
    segments.push({ text: text.slice(idx, idx + lowerQuery.length), match: true })
    i = idx + lowerQuery.length
  }

  return segments
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlight(text, query)
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} style={{ background: 'transparent', color: '#60a5fa' }}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Filter logic
// ---------------------------------------------------------------------------

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}

function filterWorktrees(worktrees: WorktreeEntry[], query: string): WorktreeEntry[] {
  if (!query) return worktrees

  return worktrees
    .map(wt => {
      const worktreeMatches = matchesQuery(wt.name, query)
      const filteredServices = worktreeMatches
        ? wt.services
        : wt.services.filter(s => matchesQuery(s.name, query))

      return { ...wt, services: filteredServices }
    })
    .filter(wt => wt.services.length > 0)
}

// Flatten filtered worktrees into an ordered list of services for arrow nav
function flattenServices(worktrees: WorktreeEntry[]): ServiceEntry[] {
  return worktrees.flatMap(wt => wt.services)
}

// ---------------------------------------------------------------------------
// Service row
// ---------------------------------------------------------------------------

function ServiceRow({
  service,
  query,
  isActive,
  anchorRef,
}: {
  service: ServiceEntry
  query: string
  isActive: boolean
  anchorRef: React.RefCallback<HTMLAnchorElement>
}) {
  return (
    <div style={styles.serviceRow}>
      <a
        href={service.url}
        ref={anchorRef}
        style={{
          ...styles.serviceLink,
          ...(isActive ? styles.serviceLinkActive : {}),
        }}
        className={isActive ? 'service-link active' : 'service-link'}
        tabIndex={-1}
      >
        <Highlighted text={service.name} query={query} />
      </a>
      <span style={styles.servicePort}>:{service.port}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Worktree section
// ---------------------------------------------------------------------------

function WorktreeSection({
  worktree,
  query,
  activeIndex,
  globalOffset,
  anchorRefs,
}: {
  worktree: WorktreeEntry
  query: string
  activeIndex: number
  globalOffset: number
  anchorRefs: React.MutableRefObject<(HTMLAnchorElement | null)[]>
}) {
  return (
    <div style={styles.worktreeSection}>
      <div style={styles.worktreeName}>
        <Highlighted text={worktree.name} query={query} />
      </div>
      {worktree.services.map((service, i) => {
        const flatIdx = globalOffset + i
        return (
          <ServiceRow
            key={`${service.name}-${service.port}`}
            service={service}
            query={query}
            isActive={flatIdx === activeIndex}
            anchorRef={el => {
              anchorRefs.current[flatIdx] = el
            }}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DirectoryPage() {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  // Flat array of anchor refs matching the flat service order
  const anchorRefs = useRef<(HTMLAnchorElement | null)[]>([])

  useEffect(() => {
    fetch('/api/worktrees')
      .then(r => r.json())
      .then((data: WorktreeEntry[]) => {
        setWorktrees(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Reset active index whenever filter changes
  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  const filtered = filterWorktrees(worktrees, query)
  const flat = flattenServices(filtered)
  const total = flat.length

  // Single keydown handler on the input — input stays focused at all times.
  // Arrow up/down navigate the list (preventDefault stops cursor movement).
  // Left/right are left alone for normal text cursor navigation.
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (total === 0) return
        const next = activeIndex < total - 1 ? activeIndex + 1 : activeIndex
        setActiveIndex(next)
        anchorRefs.current[next]?.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (activeIndex <= 0) {
          setActiveIndex(-1)
        } else {
          const next = activeIndex - 1
          setActiveIndex(next)
          anchorRefs.current[next]?.scrollIntoView({ block: 'nearest' })
        }
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0) {
          e.preventDefault()
          const anchor = anchorRefs.current[activeIndex]
          if (anchor) window.location.href = anchor.href
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (activeIndex >= 0) {
          setActiveIndex(-1)
        } else if (query) {
          setQuery('')
        }
      }
    },
    [activeIndex, total, query]
  )

  // Window-level handler only for Cmd/Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Compute per-worktree offsets into the flat array
  let offset = 0
  const offsets: number[] = []
  for (const wt of filtered) {
    offsets.push(offset)
    offset += wt.services.length
  }

  return (
    <div style={styles.page}>
      <style>{cssString}</style>

      <div style={styles.logoWrapper}>
        <pre style={styles.logo}>{ASCII_LOGO}</pre>
      </div>

      <div style={styles.searchWrapper}>
        <div style={styles.searchContainer}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter worktrees and services…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            style={styles.searchInput}
            className="search-input"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd style={styles.kbdHint} className="kbd-hint">
            ⌘K
          </kbd>
        </div>
      </div>

      <div style={styles.list}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : filtered.length === 0 && query ? (
          <p style={styles.empty}>No matches for &ldquo;{query}&rdquo;</p>
        ) : filtered.length === 0 ? (
          <p style={styles.empty}>No worktrees are currently running.</p>
        ) : (
          filtered.map((wt, i) => (
            <WorktreeSection
              key={wt.name}
              worktree={wt}
              query={query}
              activeIndex={activeIndex}
              globalOffset={offsets[i]!}
              anchorRefs={anchorRefs}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '48px 24px 80px',
  },
  logoWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 32,
  },
  logo: {
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 1.2,
    userSelect: 'none',
    margin: 0,
  },
  searchWrapper: {
    position: 'sticky',
    top: 0,
    background: '#0f0f0f',
    paddingBottom: 24,
    paddingTop: 8,
    zIndex: 10,
  },
  searchContainer: {
    position: 'relative',
  },
  searchInput: {
    width: '100%',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 15,
    padding: '10px 52px 10px 14px',
    outline: 'none',
  },
  kbdHint: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#666',
    fontSize: 11,
    fontFamily: 'inherit',
    padding: '2px 5px',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },
  worktreeSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  worktreeName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  },
  serviceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #1c1c1c',
  },
  serviceLink: {
    color: '#fff',
    textDecoration: 'none',
    fontSize: 15,
    borderRadius: 3,
    padding: '1px 4px',
    marginLeft: -4,
  },
  serviceLinkActive: {
    background: '#1e3a5f',
    color: '#93c5fd',
  },
  servicePort: {
    color: '#555',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    color: '#555',
    fontSize: 14,
    fontStyle: 'italic',
  },
}

// Focus ring and kbd hint visibility via CSS classes
const cssString = `
  .search-input:focus {
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
  }
  .search-input:focus ~ .kbd-hint {
    opacity: 0;
  }
  .service-link:hover {
    color: #60a5fa !important;
  }
  .service-link.active {
    background: #1e3a5f !important;
    color: #93c5fd !important;
  }
`
