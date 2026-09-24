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

/*
 * RECENT ACTIVITY (group_message_actions) — a much shorter retention
 * than the 5-day storage-file cutoff above. This table is a moderation
 * audit trail (who edited/deleted what, shown in a group's "Recent
 * activity" panel) that grows forever otherwise; Jasur only needs the
 * last couple of days of it, not permanent history, and asked for it
 * to piggyback on this same cleanup call rather than needing its own
 * separate cron trigger.
 */
const RECENT_ACTIVITY_TABLE = 'group_message_actions'
const RECENT_ACTIVITY_RETENTION_HOURS = 48

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

/*
 * RECENT ACTIVITY ROW CLEANUP
 *
 * Unlike the storage buckets above, this is a plain table of rows, and
 * this function already runs with the service-role key, so no RLS
 * bypass / RPC helper is needed the way `get_old_storage_files` was for
 * Storage — a normal `.delete()` filtered by `created_at` is enough.
 */
async function cleanRecentActivity(
  cutoff: string,
  dryRun: boolean
) {
  /*
   * DRY RUN:
   * Count old rows but do NOT delete them.
   */
  if (dryRun) {
    const {
      count,
      error,
    } = await supabase
      .from(RECENT_ACTIVITY_TABLE)
      .select('id', { count: 'exact', head: true })
      .lt('created_at', cutoff)

    if (error) {
      throw new Error(
        `Failed to count old rows in ${RECENT_ACTIVITY_TABLE}: ${error.message}`
      )
    }

    return {
      table: RECENT_ACTIVITY_TABLE,
      candidates: count ?? 0,
      deleted: 0,
    }
  }

  /*
   * REAL DELETE
   */
  const {
    data,
    error,
  } = await supabase
    .from(RECENT_ACTIVITY_TABLE)
    .delete()
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    throw new Error(
      `Failed to delete old rows from ${RECENT_ACTIVITY_TABLE}: ${error.message}`
    )
  }

  return {
    table: RECENT_ACTIVITY_TABLE,
    candidates: data?.length ?? 0,
    deleted: data?.length ?? 0,
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

    /*
     * RECENT ACTIVITY — separate, much shorter retention window
     * (hours, not days), same dry_run flag, same call.
     */
    const activityCutoffDate =
      new Date()

    activityCutoffDate.setUTCHours(
      activityCutoffDate.getUTCHours() -
        RECENT_ACTIVITY_RETENTION_HOURS
    )

    const activityCutoff =
      activityCutoffDate.toISOString()

    const recentActivity =
      await cleanRecentActivity(
        activityCutoff,
        dryRun
      )

    console.log(
      `${recentActivity.table}: candidates=${recentActivity.candidates}, deleted=${recentActivity.deleted}`
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
      recent_activity_retention_hours:
        RECENT_ACTIVITY_RETENTION_HOURS,
      recent_activity_cutoff:
        activityCutoff,
      recent_activity: recentActivity,
      message: dryRun
        ? 'Dry run complete. Nothing was deleted.'
        : `Deleted ${totalDeleted} files older than ${RETENTION_DAYS} days and ${recentActivity.deleted} recent-activity rows older than ${RECENT_ACTIVITY_RETENTION_HOURS}h.`,
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