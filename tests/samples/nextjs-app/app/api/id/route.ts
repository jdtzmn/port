import { serverId } from '../../../lib/server-id'

export async function GET() {
  return Response.json({ id: serverId })
}
