import { readdir, readFile } from 'node:fs/promises'
export async function applyWorkersMigrations(db) {
  const directory = new URL('../server/workers/migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(
      (await readFile(new URL(file, directory), 'utf8')).replaceAll('--> statement-breakpoint', '').replaceAll(
        '\n',
        ' ',
      ),
    )
  }
}
