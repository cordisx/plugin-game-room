import type { Seat } from './model.js'
import type { CurrentUserState } from './current-user-sync.js'

/** Keeps only a recovery candidate; it is never shown before an authenticated refresh. */
export class RoomRecovery {
  private candidate?: { subject: string; seat: Seat }
  update(previous: CurrentUserState, next: CurrentUserState, seat?: Seat) {
    if (next.status === 'unavailable') {
      if (next.reason === 'signed-out') this.candidate = undefined
      else if (previous.status === 'available' && seat) this.candidate = { subject: previous.subject, seat }
      return undefined
    }
    if (this.candidate?.subject !== next.subject) this.candidate = undefined
    return this.candidate?.seat
  }
  get pending() {
    return !!this.candidate
  }
  clear() {
    this.candidate = undefined
  }
}
