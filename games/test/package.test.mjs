import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build, canonical, validate } from '../tools/package.mjs'
import { smoke } from '../tools/smoke.mjs'
test('canonical build is reproducible and both artifacts smoke in real QuickJS', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-build-'))
  try {
    for (const name of ['gomoku', 'holdem']) {
      const a = await build(name, dir), b = await build(name, dir)
      assert.equal(a.hash, b.hash)
      assert.equal(canonical(a.pkg), canonical(b.pkg))
      await smoke(a.pkg)
      const changed = structuredClone(a.pkg)
      changed.manifest.version = '1.0.1'
      assert.notEqual(validate(changed), a.hash)
      changed.manifest.settlementPolicies = ['mint-coins']
      assert.throws(() => validate(changed), /Invalid GamePackage/)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
