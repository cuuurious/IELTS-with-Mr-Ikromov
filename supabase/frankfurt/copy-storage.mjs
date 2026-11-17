// FRANKFURT MOVE — copy every stored file from the old project to the new one.
// Updated 2026-11-17 (today: ~6,600 files / ~5.2 GB, 10 buckets).
//
// The database dump carries the list of files, not the files themselves.
// This script downloads each file from the old project and uploads it to the
// same bucket + path in the new project.
//
// * Files that already exist in the new project with the same size are
//   SKIPPED, so you can run it days before the move (the long run, ~1-2 h)
//   and again on the night (only the few new files, a minute or two).
// * Nothing is ever deleted. Safe to run as many times as you like.
// * At the end it compares file counts per bucket old vs new and says
//   plainly if anything is missing.
//
//   PowerShell (from the ielts-app folder):
//     $env:OLD_URL="https://grdfwleehlgoooizyowz.supabase.co"
//     $env:OLD_SERVICE_KEY="<old service_role key>"
//     $env:NEW_URL="https://NEWREF.supabase.co"
//     $env:NEW_SERVICE_KEY="<new service_role key>"
//     node supabase/frankfurt/copy-storage.mjs
//
// Service-role keys: Project Settings -> API keys (secret). Never put them
// in the website's .env or commit them.

import { createClient } from '@supabase/supabase-js'

const { OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY } = process.env
if (!OLD_URL || !OLD_SERVICE_KEY || !NEW_URL || !NEW_SERVICE_KEY) {
  console.error('Set OLD_URL, OLD_SERVICE_KEY, NEW_URL and NEW_SERVICE_KEY first (see the top of this file).')
  process.exit(1)
}
if (OLD_URL === NEW_URL) {
  console.error('OLD_URL and NEW_URL are the same. Stopping so nothing is overwritten.')
  process.exit(1)
}

const opts = { auth: { persistSession: false } }
const oldDb = createClient(OLD_URL, OLD_SERVICE_KEY, opts)
const newDb = createClient(NEW_URL, NEW_SERVICE_KEY, opts)
const CONCURRENCY = 4

async function listAll(db, bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) out.push(...(await listAll(db, bucket, path))) // a folder
      else out.push({ path, size: entry.metadata?.size, mimetype: entry.metadata?.mimetype })
    }
    if (data.length < 1000) break
  }
  return out
}

async function ensureBucket(bucket) {
  const { data: existing } = await newDb.storage.getBucket(bucket.name)
  if (existing) return
  const { error } = await newDb.storage.createBucket(bucket.name, {
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? undefined,
    allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
  })
  if (error) throw new Error(`create bucket ${bucket.name}: ${error.message}`)
}

const { data: buckets, error: bucketError } = await oldDb.storage.listBuckets()
if (bucketError) throw bucketError

let copied = 0
let skipped = 0
let failed = 0
const problems = []

for (const bucket of buckets) {
  await ensureBucket(bucket)
  const files = await listAll(oldDb, bucket.name)
  const have = new Map((await listAll(newDb, bucket.name)).map((f) => [f.path, f.size]))
  console.log(`\n${bucket.name}: ${files.length} files (${have.size} already in the new project)`)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      try {
        if (have.has(file.path) && have.get(file.path) === file.size) {
          skipped++
        } else {
          let blob
          for (let attempt = 1; ; attempt++) {
            const { data, error } = await oldDb.storage.from(bucket.name).download(file.path)
            if (!error) {
              blob = data
              break
            }
            if (attempt >= 3) throw error
            await new Promise((r) => setTimeout(r, 1500 * attempt))
          }
          const { error: upError } = await newDb.storage
            .from(bucket.name)
            .upload(file.path, blob, { upsert: true, contentType: file.mimetype || blob.type || undefined })
          if (upError) throw upError
          copied++
        }
      } catch (err) {
        failed++
        problems.push(`${bucket.name}/${file.path}: ${err.message || err}`)
        console.error(`  FAILED ${bucket.name}/${file.path}: ${err.message || err}`)
      }
      done++
      if (done % 100 === 0) console.log(`  ${done}/${files.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

console.log(`\nCopied ${copied}, already there ${skipped}, failed ${failed}.`)

// Final check: same number of files per bucket?
let mismatch = 0
for (const bucket of buckets) {
  const a = (await listAll(oldDb, bucket.name)).length
  const b = (await listAll(newDb, bucket.name)).length
  const flag = b < a ? '  <-- MISSING FILES, run again' : ''
  if (b < a) mismatch++
  console.log(`${bucket.name.padEnd(22)} old ${String(a).padStart(5)}  new ${String(b).padStart(5)}${flag}`)
}
if (failed || mismatch) {
  console.log('\nNOT FINISHED. Run the script again; it only retries what is missing.')
  process.exit(2)
}
console.log('\nAll files are in the new project.')
