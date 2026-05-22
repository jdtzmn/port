import { getRunningWorktrees } from '@/lib/docker'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const worktrees = await getRunningWorktrees()
  return NextResponse.json(worktrees)
}
