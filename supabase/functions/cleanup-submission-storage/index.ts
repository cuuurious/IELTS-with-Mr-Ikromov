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

const BUCKETS = [
  'submissions',
  'homework-files',
]

const RETENTION_DAYS = 5
const BATCH_SIZE = 500

function jsonResponse(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

async function getOldFiles(
  bucket: string,
  cutoff: string
) {
  const {
    data,
    error,
  } = await supabase.rpc(
    'get_old_storage_files',
    {
      p_bucket: bucket,
      p_cutoff: cutoff,
      p_limit: BATCH_SIZE,
    }
  )

  if (error) {
    throw new Error(
      `Failed to find old files in ${bucket}: ${error.message}`
    )
  }

  return (data ?? [])
    .map(
      (row: { name?: string }) =>
        row.name
    )
    .filter(
      (name): name is string =>
        typeof name === 'string' &&
        name.length > 0
    )
}

async function cleanBucket(
  bucket: string,
  cutoff: string,
  dryRun: boolean
) {
  const paths =
    await getOldFiles(
      bucket,
      cutoff
    )

  if (!paths.length) {
    return {
      bucket,
      candidates: 0,
      deleted: 0,
      sample: [],
    }
  }

  /*
   * DRY RUN:
   * Find old files but do NOT delete them.
   */
  if (dryRun) {
    return {
      bucket,
      candidates: paths.length,
      deleted: 0,
      sample: paths.slice(0, 20),
    }
  }

  /*
   * REAL DELETE:
   * Always use the Storage API.
   */
  const {
    data,
    error,
  } =
    await supabase.storage
      .from(bucket)
      .remove(paths)

  if (error) {
    throw new Error(
      `Failed to delete files from ${bucket}: ${error.message}`
    )
  }

  return {
    bucket,
    candidates: paths.length,
    deleted:
      data?.length ?? paths.length,
    sample:
      paths.slice(0, 20),
  }
}

Deno.serve(async (req) => {
  try {
    /*
     * TOKEN
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

    /*
     * METHOD
     */
    if (req.method !== 'POST') {
      return jsonResponse(
        {
          ok: false,
          error:
            'POST required.',
        },
        405
      )
    }

    /*
     * BODY
     *
     * Default = DRY RUN.
     *
     * Real deletion:
     * { "dry_run": false }
     */
    const body =
      await req
        .json()
        .catch(() => ({}))

    const dryRun =
      body?.dry_run !== false

    /*
     * FIVE DAYS
     */
    const cutoffDate =
      new Date()

    cutoffDate.setUTCDate(
      cutoffDate.getUTCDate() -
        RETENTION_DAYS
    )

    const cutoff =
      cutoffDate.toISOString()

    console.log(
      `Cleanup started. dry_run=${dryRun}`
    )

    console.log(
      `Cutoff: ${cutoff}`
    )

    /*
     * CLEAN BOTH BUCKETS
     */
    const results = []

    for (const bucket of BUCKETS) {
      const result =
        await cleanBucket(
          bucket,
          cutoff,
          dryRun
        )

      results.push(result)

      console.log(
        `${bucket}: candidates=${result.candidates}, deleted=${result.deleted}`
      )
    }

    const totalCandidates =
      results.reduce(
        (sum, result) =>
          sum + result.candidates,
        0
      )

    const totalDeleted =
      results.reduce(
        (sum, result) =>
          sum + result.deleted,
        0
      )

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      retention_days:
        RETENTION_DAYS,
      cutoff,
      buckets: results,
      total_candidates:
        totalCandidates,
      total_deleted:
        totalDeleted,
      message: dryRun
        ? 'Dry run complete. Nothing was deleted.'
        : `Deleted ${totalDeleted} files older than ${RETENTION_DAYS} days.`,
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
})