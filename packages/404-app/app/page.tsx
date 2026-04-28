'use client'

import { useEffect, useRef, useState } from 'react'
import type { WorktreeEntry, ServiceEntry } from '@/lib/docker'

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

// ---------------------------------------------------------------------------
// Service row
// ---------------------------------------------------------------------------

function ServiceRow({ service, query }: { service: ServiceEntry; query: string }) {
  return (
    <div style={styles.serviceRow}>
      <a href={service.url} style={styles.serviceLink}>
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
}: {
  worktree: WorktreeEntry
  query: string
}) {
  return (
    <div style={styles.worktreeSection}>
      <div style={styles.worktreeName}>
        <Highlighted text={worktree.name} query={query} />
      </div>
      {worktree.services.map(service => (
        <ServiceRow key={`${service.name}-${service.port}`} service={service} query={query} />
      ))}
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
  const inputRef = useRef<HTMLInputElement>(null)

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

  const filtered = filterWorktrees(worktrees, query)

  return (
    <div style={styles.page}>
      <style>{cssString}</style>

      <div style={styles.searchWrapper}>
        <div style={styles.searchContainer}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Filter worktrees and services…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={styles.searchInput}
            className="search-input"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd style={styles.kbdHint} className="kbd-hint">⌘K</kbd>
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
          filtered.map(wt => <WorktreeSection key={wt.name} worktree={wt} query={query} />)
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
  a[href]:hover {
    color: #60a5fa !important;
  }
`
