import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cleanupToken = Deno.env.get('CLEANUP_TOKEN')!

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

const BUCKET = 'submissions'

/*
 * IMPORTANT:
 *
 * We intentionally process only a SMALL number of files
 * per invocation.
 *
 * This prevents the Edge Function from timing out while
 * cleaning thousands of orphaned files.
 */
const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 200

function collectStrings(
  value: unknown,
  output: string[] = []
) {
  if (typeof value === 'string') {
    output.push(value)
    return output
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output)
    }

    return output
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    for (
      const item of Object.values(
        value as Record<string, unknown>
      )
    ) {
      collectStrings(item, output)
    }
  }

  return output
}

function storagePathFromValue(
  value: string
) {
  const markers = [
    `/storage/v1/object/public/${BUCKET}/`,
    `/storage/v1/object/sign/${BUCKET}/`,
    `/storage/v1/object/authenticated/${BUCKET}/`,
  ]

  for (const marker of markers) {
    const index =
      value.indexOf(marker)

    if (index >= 0) {
      return decodeURIComponent(
        value
          .slice(
            index + marker.length
          )
          .split('?')[0]
      )
    }
  }

  /*
   * Also support raw Storage paths.
   */
  if (
    value.split('/').length >= 3 &&
    !value.startsWith('http://') &&
    !value.startsWith('https://')
  ) {
    return value
  }

  return null
}

/*
 * Build a Set containing every file path that is STILL
 * referenced by an existing submission.
 */
async function loadReferencedPaths() {
  const referenced =
    new Set<string>()

  let from = 0
  const PAGE_SIZE = 500

  while (true) {
    const {
      data,
      error,
    } = await supabase
      .from('submissions')
      .select(
        `
        screenshot_urls,
        audio_part1_url,
        audio_part2_url,
        audio_part3_url,
        submission_files
        `
      )
      .range(
        from,
        from + PAGE_SIZE - 1
      )

    if (error) {
      throw new Error(
        `Failed to read submissions: ${error.message}`
      )
    }

    if (!data?.length) {
      break
    }

    for (const submission of data) {
      const strings =
        collectStrings(submission)

      for (const value of strings) {
        const path =
          storagePathFromValue(value)

        if (path) {
          referenced.add(path)
        }
      }
    }

    if (
      data.length < PAGE_SIZE
    ) {
      break
    }

    from += PAGE_SIZE
  }

  return referenced
}

/*
 * Recursively find orphan files, BUT STOP as soon as
 * we have enough candidates for this invocation.
 *
 * We do NOT scan the entire bucket every time.
 */
async function findOrphanBatch(
  referenced: Set<string>,
  limit: number
) {
  const orphaned: string[] = []

  async function scan(
    path = ''
  ): Promise<boolean> {

    let offset = 0
    const PAGE_SIZE = 100

    while (true) {
      const {
        data,
        error,
      } = await supabase.storage
        .from(BUCKET)
        .list(path, {
          limit: PAGE_SIZE,
          offset,
          sortBy: {
            column: 'name',
            order: 'asc',
          },
        })

      if (error) {
        throw new Error(
          `Failed to list Storage path "${path}": ${error.message}`
        )
      }

      if (!data?.length) {
        return false
      }

      for (const item of data) {

        /*
         * Folder.
         */
        if (item.id === null) {
          const childPath =
            path
              ? `${path}/${item.name}`
              : item.name

          const shouldStop =
            await scan(childPath)

          if (shouldStop) {
            return true
          }

          continue
        }

        /*
         * Actual file.
         */
        const fullPath =
          path
            ? `${path}/${item.name}`
            : item.name

        if (
          !referenced.has(fullPath)
        ) {
          orphaned.push(fullPath)

          if (
            orphaned.length >= limit
          ) {
            return true
          }
        }
      }

      if (
        data.length < PAGE_SIZE
      ) {
        return false
      }

      offset += PAGE_SIZE
    }
  }

  await scan()

  return orphaned
}

function jsonResponse(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type':
          'application/json',
      },
    }
  )
}

Deno.serve(
  async (req) => {
    try {

      /*
       * ---------------------------------------------
       * TOKEN CHECK
       * ---------------------------------------------
       */

      const suppliedToken =
        req.headers.get(
          'x-cleanup-token'
        )

      if (
        !cleanupToken ||
        !suppliedToken ||
        suppliedToken !== cleanupToken
      ) {
        return jsonResponse(
          {
            ok: false,
            error:
              'Invalid cleanup credentials.',
          },
          401
        )
      }

      if (
        req.method !== 'POST'
      ) {
        return jsonResponse(
          {
            ok: false,
            error:
              'POST required.',
          },
          405
        )
      }

      const body =
        await req
          .json()
          .catch(() => ({}))

      /*
       * Default is STILL dry-run.
       *
       * Deletion only happens when:
       *
       * { "dry_run": false }
       */
      const dryRun =
        body?.dry_run !== false

      const requestedLimit =
        Number(
          body?.limit ??
          DEFAULT_BATCH_SIZE
        )

      const limit =
        Math.min(
          Math.max(
            Number.isFinite(
              requestedLimit
            )
              ? requestedLimit
              : DEFAULT_BATCH_SIZE,
            1
          ),
          MAX_BATCH_SIZE
        )

      console.log(
        `Cleanup started. dry_run=${dryRun}, limit=${limit}`
      )

      /*
       * ---------------------------------------------
       * 1. LOAD CURRENTLY REFERENCED FILES
       * ---------------------------------------------
       */

      const referenced =
        await loadReferencedPaths()

      console.log(
        `Referenced files: ${referenced.size}`
      )

      /*
       * ---------------------------------------------
       * 2. FIND ONLY A SMALL ORPHAN BATCH
       * ---------------------------------------------
       */

      const orphaned =
        await findOrphanBatch(
          referenced,
          limit
        )

      console.log(
        `Orphan candidates found: ${orphaned.length}`
      )

      /*
       * ---------------------------------------------
       * 3. DRY RUN
       * ---------------------------------------------
       */

      if (dryRun) {
        return jsonResponse({
          ok: true,
          dry_run: true,
          batch_size: limit,
          referenced_files:
            referenced.size,
          orphan_candidates:
            orphaned.length,
          sample:
            orphaned.slice(0, 20),
          message:
            'Dry run only. No files were deleted.',
        })
      }

      /*
       * ---------------------------------------------
       * 4. DELETE ONLY THIS SMALL BATCH
       * ---------------------------------------------
       */

      if (!orphaned.length) {
        return jsonResponse({
          ok: true,
          dry_run: false,
          deleted_files: 0,
          remaining_candidates: 0,
          message:
            'No orphaned files were found in this scan.',
        })
      }

      const {
        data,
        error,
      } =
        await supabase.storage
          .from(BUCKET)
          .remove(orphaned)

      if (error) {
        throw new Error(
          `Storage deletion failed: ${error.message}`
        )
      }

      const deleted =
        data?.length ??
        orphaned.length

      return jsonResponse({
        ok: true,
        dry_run: false,
        batch_requested:
          orphaned.length,
        deleted_files:
          deleted,
        sample_deleted:
          orphaned.slice(0, 20),
        message:
          `Deleted ${deleted} orphaned submission files. Run again to continue.`,
      })

    } catch (error) {

      console.error(
        'Cleanup failed:',
        error
      )

      return jsonResponse(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        500
      )
    }
  }
)