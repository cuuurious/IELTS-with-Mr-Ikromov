// FRANKFURT MOVE — copy every stored file from the old project to the new one.
// Prepared 2026-10-02.
//
// The database dump carries the list of files, not the files themselves.
// This script downloads each file from the old project and uploads it to
// the same bucket + path in the new project (≈ 1,230 files / ~0.8 GB today).
// Safe to run again: files are overwritten, nothing is deleted.
//
// Run from the ielts-app folder (it uses the app's own @supabase/supabase-js):
//
//   PowerShell:
//     $env:OLD_URL="https://grdfwleehlgoooizyowz.supabase.co"
//     $env:OLD_SERVICE_KEY="<old service_role key>"
//     $env:NEW_URL="https://NEWREF.supabase.co"
//     $env:NEW_SERVICE_KEY="<new service_role key>"
//     node supabase/frankfurt/copy-storage.mjs
//
// Service-role keys: Project Settings → API keys (secret). Never put them
// in the website's .env or commit them.

import { createClient } from '@supabase/supabase-js'

const { OLD_URL, OLD_SERVICE_KEY, NEW_URL, NEW_SERVICE_KEY } = process.env
if (!OLD_URL || !OLD_SERVICE_KEY || !NEW_URL || !NEW_SERVICE_KEY) {
  console.error('Set OLD_URL, OLD_SERVICE_KEY, NEW_URL and NEW_SERVICE_KEY first (see the top of this file).')
  process.exit(1)
}

const opts = { auth: { persistSession: false } }
const oldDb = createClient(OLD_URL, OLD_SERVICE_KEY, opts)
const newDb = createClient(NEW_URL, NEW_SERVICE_KEY, opts)

async function listAll(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await oldDb.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) out.push(...(await listAll(bucket, path))) // a folder
      else out.push({ path, mimetype: entry.metadata?.mimetype })
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
let failed = 0
for (const bucket of buckets) {
  await ensureBucket(bucket)
  const files = await listAll(bucket.name)
  console.log(`\n${bucket.name}: ${files.length} files`)
  for (const [i, file] of files.entries()) {
    try {
      const { data: blob, error: dlError } = await oldDb.storage.from(bucket.name).download(file.path)
      if (dlError) throw dlError
      const { error: upError } = await newDb.storage
        .from(bucket.name)
        .upload(file.path, blob, { upsert: true, contentType: file.mimetype || blob.type || undefined })
      if (upError) throw upError
      copied++
    } catch (err) {
      failed++
      console.error(`  FAILED ${bucket.name}/${file.path}: ${err.message || err}`)
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${files.length}`)
  }
}

console.log(`\nDone. Copied ${copied} files, ${failed} failed.${failed ? ' Run the script again to retry the failed ones.' : ''}`)
