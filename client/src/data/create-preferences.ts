import { CORDISX_OWNER_DOCUMENT_SERVICE_V1, type CordisXOwnerDocumentsV1 } from 'cordisx/contracts'
import { type CreateSourceChoice, sourceOrigin } from './create-source-selection.js'
import type { Source } from './model.js'
const documentId = 'create-room-preferences'
/** Only this plugin's non-secret room-creation preference, through the public owner document service. */
export class CreatePreferences {
  current?: CreateSourceChoice
  private listeners = new Set<() => void>()
  private disposed = false
  private edit = 0
  private revision?: number
  private pending: Promise<void> = Promise.resolve()
  private loading?: Promise<void>
  private generation = 0
  private savedEdit = 0
  constructor(private documents?: CordisXOwnerDocumentsV1) {}
  attach(documents: CordisXOwnerDocumentsV1) {
    if (this.disposed || this.documents === documents) return
    this.documents = documents
    this.generation++
    this.loading = undefined
    this.revision = undefined
    this.savedEdit = 0
    const edit = this.edit
    void this.load().then(async () => {
      await this.pending.catch(() => {})
      if (!this.disposed && edit > 0 && edit === this.edit && this.current && this.savedEdit < edit) {
        this.save(this.current, edit)
      }
    })
  }
  detach(documents: CordisXOwnerDocumentsV1) {
    if (this.documents !== documents) return
    this.documents = undefined
    this.generation++
    this.loading = undefined
    this.revision = undefined
  }
  load() {
    return this.loading ??= this.read()
  }
  private async read() {
    if (!this.documents || this.disposed) return
    const edit = this.edit, generation = this.generation
    const result = await this.documents.load(documentId).catch(() => undefined)
    if (!result || this.disposed || generation !== this.generation) return
    if (result.status === 'missing') this.revision = 0
    if (result.status === 'loaded') {
      if (result.snapshot.schemaVersion !== 1) return
      this.revision = result.snapshot.revision
      const value = result.snapshot.value
      if (
        edit === 0 && this.edit === 0 && result.snapshot.schemaVersion === 1 && value && typeof value === 'object'
        && !Array.isArray(value) && 'sourceId' in value && 'origin' in value
        && typeof value.sourceId === 'string' && typeof value.origin === 'string'
        && sourceOrigin(value.origin) === value.origin
      ) {
        this.current = { sourceId: value.sourceId, origin: value.origin }
        this.emit()
      }
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  remember(source: Source) {
    const origin = sourceOrigin(source.url)
    if (!origin || this.disposed) return
    const choice = { sourceId: source.id, origin }
    this.current = choice
    const edit = ++this.edit
    this.emit()
    this.save(choice, edit)
  }
  private save(choice: CreateSourceChoice, edit: number) {
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (this.disposed || !this.documents) return
      if (this.revision === undefined) await this.load()
      if (this.disposed || this.revision === undefined || edit !== this.edit) return
      const documents = this.documents, generation = this.generation
      const command = {
        contract: CORDISX_OWNER_DOCUMENT_SERVICE_V1,
        documentId,
        expectedRevision: this.revision,
        schemaVersion: 1,
        value: choice,
      }
      let result = await documents.replace(command).catch(() => undefined)
      if (this.disposed || generation !== this.generation) return
      if (result?.status === 'conflict') {
        this.revision = result.actualRevision
        if (edit !== this.edit) return
        result = await documents.replace({ ...command, expectedRevision: result.actualRevision }).catch(() => undefined)
      }
      if (this.disposed || generation !== this.generation) return
      if (result?.status === 'accepted') {
        this.revision = result.snapshot.revision
        this.savedEdit = edit
      }
      if (result?.status === 'conflict') this.revision = result.actualRevision
    })
  }
  private emit() {
    for (const listener of this.listeners) listener()
  }
  dispose() {
    this.disposed = true
    this.listeners.clear()
  }
}
