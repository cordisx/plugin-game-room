import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'game-agents-consumer-'));
const consumer = join(root, 'client');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: consumer, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} consumer check failed`);
}
try {
  await mkdir(join(root, 'agents'));
  await mkdir(consumer);
  // Copy source exports only. Neither checkout's node_modules can participate in resolution.
  for (const name of await readdir(source)) {
    if (name.endsWith('.ts') || name === 'package.json') {
      await copyFile(join(source, name), join(root, 'agents', name));
    }
  }
  await writeFile(join(consumer, '.npmrc'), 'install-links=true\n');
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@cordisx/game-room-agents': 'file:../agents' },
      devDependencies: { typescript: '5.9.3' },
    }),
  );
  await writeFile(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        lib: ['ES2023', 'DOM'],
        types: [],
        skipLibCheck: false,
      },
      include: ['smoke.ts'],
    }),
  );
  await writeFile(
    join(consumer, 'smoke.ts'),
    `
import { createAgentLoopProvider, createDispatchService, createSeatHttpTransport,
  type AgentLoopProviderOptions } from '@cordisx/game-room-agents';
const options: AgentLoopProviderOptions = { providerId: 'test' };
const provider = createAgentLoopProvider(options);
const transport = createSeatHttpTransport({ async request() { return { status: 503, body: {} }; } });
const service = createDispatchService({ provider, transport, automatic: false });
void service.list();
`,
  );
  run('npm', ['install', '--ignore-scripts']);
  assert.equal(
    (await lstat(join(consumer, 'node_modules/@cordisx/game-room-agents'))).isSymbolicLink(),
    false,
  );
  await rm(join(consumer, 'node_modules'), { recursive: true });
  // Frozen reinstall must materialize the same package and transitive Protocol types.
  run('npm', ['ci', '--ignore-scripts']);
  run(process.execPath, [resolve(consumer, 'node_modules/typescript/bin/tsc')]);
  console.log(
    'Clean file:../agents consumer install, frozen reinstall and strict typecheck passed.',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
