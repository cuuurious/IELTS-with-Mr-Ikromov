-- FRANKFURT MOVE — row counts of every table. Run in BOTH projects (old Sydney
-- one and the new one) and compare the two result sets: every row must match.
-- (Rows written to Sydney after the dump will differ; that is why the site is
-- closed between the dump and the switch.)
select table_schema || '.' || table_name as tbl,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as rows
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users', 'identities')))
 order by 1;
