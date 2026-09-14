/** Fences async reads/checks when the user edits, switches source, or leaves. */
export class Revision {
  private value = 0
  next() {
    return ++this.value
  }
  current(value: number) {
    return value === this.value
  }
}
