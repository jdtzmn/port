import { getRunningWorktrees } from '@/lib/docker'

export const dynamic = 'force-dynamic'

export default async function NotFoundPage() {
  const worktrees = await getRunningWorktrees()

  return (
    <>
      <style>{`
        body {
          font-family: system-ui, sans-serif;
          max-width: 600px;
          margin: 80px auto;
          padding: 0 24px;
          color: #1a1a1a;
        }
        h1 { font-size: 2rem; margin-bottom: 0.25rem; }
        p { color: #555; margin-top: 0; }
        ul { padding: 0; list-style: none; margin-top: 1.5rem; }
        li { margin-bottom: 0.75rem; }
        a {
          color: #0070f3;
          text-decoration: none;
          font-weight: 500;
        }
        a:hover { text-decoration: underline; }
        .empty { color: #888; font-style: italic; }
      `}</style>

      <h1>404 — Worktree Not Found</h1>
      <p>This host doesn&apos;t match any running worktree.</p>

      {worktrees.length > 0 ? (
        <>
          <p>Running worktrees:</p>
          <ul>
            {worktrees.map(wt => (
              <li key={wt.name}>
                <a href={wt.url}>{wt.name}</a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">No worktrees are currently running.</p>
      )}
    </>
  )
}
