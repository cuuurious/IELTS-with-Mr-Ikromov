/*
 * Read every row of a query, 1000 at a time (2026-10-06).
 *
 * The API returns at most 1000 rows per request, so a plain
 * `.select()` on a table that has grown past that (submissions,
 * mock attempts, messages…) silently drops the rest. Pass a function
 * that BUILDS the query (it is called once per page) and give it a
 * stable order so pages don't overlap:
 *
 *   const { data, error } = await fetchAll(() =>
 *     supabase.from('submissions').select('id, status').eq('group_id', id).order('id')
 *   )
 *
 * Stops early after `maxRows` (default 20 000) so a runaway query can't
 * freeze the page.
 */
export async function fetchAll(buildQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  const rows = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return { data: rows, error: null }
}
