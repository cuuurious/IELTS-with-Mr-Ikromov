// Writing Lab builder (2026-11-07).
// Puts the shared look (lab.css), the Writing Coach (coach.js) and the
// screen (lab-ui.js) together with one chapter's content into ONE page,
// because practice pages are opened inside the site as a single file.
//
//   node tools/writing-lab/build.mjs              → builds every chapter
//   node tools/writing-lab/build.mjs wt1-ch04     → builds one chapter
//
// Output: public/practice/writing-lab/<file>.html
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../public/practice/writing-lab')
const NAMES = { 'wt1-ch03': 'task1-ch03', 'wt1-ch04': 'task1-ch04' } // chapter id → page file name

const read = (f) => fs.readFileSync(path.join(here, f), 'utf8')
const css = read('lab.css')
const coach = read('coach.js')
const ui = read('lab-ui.js')

const only = process.argv[2]
fs.mkdirSync(out, { recursive: true })
for (const file of fs.readdirSync(path.join(here, 'chapters'))) {
  if (!file.endsWith('.js')) continue
  const id = file.replace(/\.js$/, '')
  if (only && only !== id) continue
  const chapter = read(path.join('chapters', file))
  const js = `${chapter}\n${coach}\n${ui}`
  // Old iPhones (iOS 15) stop the whole page on these patterns.
  if (/\(\?<[=!]/.test(js)) throw new Error(`${id}: look-behind pattern found — iOS 15 cannot run it`)
  new Function(js) // syntax check
  const title = (chapter.match(/kicker:"([^"]+)"/) || [])[1] || id
  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Mr Ikromov's IELTS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&family=Unbounded:wght@500;600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<script>
${js}
</script>
</body>
</html>
`
  const name = NAMES[id] || id
  fs.writeFileSync(path.join(out, `${name}.html`), html)
  console.log(`built ${name}.html  ${(html.length / 1024).toFixed(0)} KB`)
}
