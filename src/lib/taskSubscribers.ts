import { appendFile } from 'fs/promises'
import { loadConfig } from './config.ts'
import { consumeGlobalTaskEvents, getSubscriberOutboxPath } from './taskEventStream.ts'
import type { PortTaskEvent } from './taskStore.ts'

export interface TaskEventSubscriber {
  id: string
  render(event: PortTaskEvent): string
}

class OpenCodeTaskSubscriber implements TaskEventSubscriber {
  readonly id = 'opencode'

  render(event: PortTaskEvent): string {
    const message = event.message ?? event.type
    return `<task-notification task-id="${event.taskId}" event="${event.type}">${message}</task-notification>`
  }
}

const SUBSCRIBERS: Record<string, TaskEventSubscriber> = {
  opencode: new OpenCodeTaskSubscriber(),
}

function getConfiguredSubscriberIds(config: Awaited<ReturnType<typeof loadConfig>>): string[] {
  const subs = config.task?.subscriptions
  if (!subs?.enabled) {
    return []
  }

  if (subs.consumers && subs.consumers.length > 0) {
    return subs.consumers
  }

  return ['opencode']
}

async function dispatchEventToSubscriber(
  repoRoot: string,
  subscriber: TaskEventSubscriber,
  event: PortTaskEvent
): Promise<void> {
  const outboxPath = getSubscriberOutboxPath(repoRoot, subscriber.id)
  await appendFile(outboxPath, `${subscriber.render(event)}\n`)
}

export async function dispatchConfiguredTaskSubscribers(repoRoot: string): Promise<void> {
  const config = await loadConfig(repoRoot)
  const subscriberIds = getConfiguredSubscriberIds(config)

  for (const id of subscriberIds) {
    const subscriber = SUBSCRIBERS[id]
    if (!subscriber) {
      continue
    }

    await consumeGlobalTaskEvents(repoRoot, id, async event => {
      await dispatchEventToSubscriber(repoRoot, subscriber, event)
    })
  }
}
