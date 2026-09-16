import { access } from 'node:fs/promises'
export async function load(url, context, nextLoad) {
  if (/\.(png|css)$/.test(new URL(url).pathname)) {
    await access(new URL(url))
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)}` }
  }
  return nextLoad(url, context)
}
