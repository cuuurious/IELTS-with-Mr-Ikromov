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
const PAGE_SIZE = 1000
const REMOVE_BATCH_SIZE = 1000

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
    for (const item of Object.values(
      value as Record<string, unknown>
    )) {
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
   * Also accept raw Storage paths.
   *
   * Our submission paths normally contain
   * multiple folders, so a single filename
   * is intentionally ignored.
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

async function loadReferencedPaths() {
  const referenced =
    new Set<string>()

  let from = 0

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

async function listAllFiles(
  path = ''
): Promise<string[]> {
  const files: string[] = []
  let offset = 0

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
      break
    }

    for (const item of data) {
      /*
       * Folders have id === null.
       * Actual files have a non-null id.
       */
      if (item.id === null) {
        const childPath =
          path
            ? `${path}/${item.name}`
            : item.name

        const nested =
          await listAllFiles(
            childPath
          )

        files.push(...nested)
      } else {
        const fullPath =
          path
            ? `${path}/${item.name}`
            : item.name

        files.push(fullPath)
      }
    }

    if (
      data.length < PAGE_SIZE
    ) {
      break
    }

    offset += PAGE_SIZE
  }

  return files
}

function chunk<T>(
  array: T[],
  size: number
): T[][] {
  const result: T[][] = []

  for (
    let i = 0;
    i < array.length;
    i += size
  ) {
    result.push(
      array.slice(
        i,
        i + size
      )
    )
  }

  return result
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
       * ------------------------------------------------
       * PRIVATE TOKEN CHECK
       * ------------------------------------------------
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
       * SAFETY DEFAULT:
       *
       * If dry_run is omitted,
       * NOTHING is deleted.
       */
      const dryRun =
        body?.dry_run !== false

      console.log(
        `Storage cleanup started. dry_run=${dryRun}`
      )

      /*
       * ------------------------------------------------
       * 1. Find files referenced by submissions
       * ------------------------------------------------
       */

      const referenced =
        await loadReferencedPaths()

      console.log(
        `Referenced files: ${referenced.size}`
      )

      /*
       * ------------------------------------------------
       * 2. List physical Storage files
       * ------------------------------------------------
       */

      const allFiles =
        await listAllFiles()

      console.log(
        `Physical Storage files: ${allFiles.length}`
      )

      /*
       * ------------------------------------------------
       * 3. Find orphaned files
       * ------------------------------------------------
       */

      const orphaned =
        allFiles.filter(
          (path) =>
            !referenced.has(path)
        )

      console.log(
        `Orphaned files: ${orphaned.length}`
      )

      /*
       * ------------------------------------------------
       * 4. DRY RUN
       * ------------------------------------------------
       */

      if (dryRun) {
        return jsonResponse({
          ok: true,
          dry_run: true,
          total_storage_files:
            allFiles.length,
          referenced_files:
            referenced.size,
          orphaned_files:
            orphaned.length,
          sample:
            orphaned.slice(0, 20),
          message:
            'Dry run only. No files were deleted.',
        })
      }

      /*
       * ------------------------------------------------
       * 5. REAL DELETION
       * ------------------------------------------------
       */

      let deleted = 0

      const batches =
        chunk(
          orphaned,
          REMOVE_BATCH_SIZE
        )

      for (
        let i = 0;
        i < batches.length;
        i++
      ) {
        const batch =
          batches[i]

        const {
          data,
          error,
        } =
          await supabase.storage
            .from(BUCKET)
            .remove(batch)

        if (error) {
          throw new Error(
            `Deletion failed on batch ${
              i + 1
            }/${batches.length}: ${
              error.message
            }`
          )
        }

        deleted +=
          data?.length ??
          batch.length

        console.log(
          `Deleted batch ${
            i + 1
          }/${batches.length}: ${
            batch.length
          } files`
        )
      }

      return jsonResponse({
        ok: true,
        dry_run: false,
        total_storage_files:
          allFiles.length,
        referenced_files:
          referenced.size,
        orphaned_files:
          orphaned.length,
        deleted_files:
          deleted,
        remaining_expected:
          allFiles.length -
          deleted,
        message:
          'Orphaned submission files deleted successfully.',
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