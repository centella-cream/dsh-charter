import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Read the historical event snapshot of a restored Session.
 *
 * DSH 0.2.1-rc.2 marks `snapshotEvents()` deprecated for new production code
 * but does not expose a non-deprecated public reader for a Session that was
 * already restored before this plugin mounted. Keep that dependency at one
 * boundary so migration is a single-file change when DSH publishes one.
 */
export function readSessionEvents(session: Session): ReturnType<Session['snapshotEvents']> {
  return session.snapshotEvents()
}
