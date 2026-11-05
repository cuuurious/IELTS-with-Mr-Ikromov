-- supabase/tests/core_flows.sql (2026-11-05)
-- Automatic checks of the main database steps. Paste into the Supabase
-- SQL editor and run. NOTHING IS SAVED: everything is undone at the end.
-- The result appears as a red "error" box — that box IS the report:
--   ✓ = works, ✗ = broken (tell Claude which line).
-- It plays one real student (the newest one) inside the test.

do $$
declare
  r text[] := '{}';
  v_student uuid;
  v_teacher uuid;
  v_before integer;
  v_after integer;
  v_id uuid;
  v_n integer;
  v_left integer[];
  v_ok boolean;
  v_url text := '/practice/reading/__test__/page.html';
  v_mat uuid;
begin
  select id into v_student from public.profiles where role = 'student' order by created_at desc limit 1;
  select id into v_teacher from public.profiles where role = 'teacher' order by created_at limit 1;
  if v_student is null or v_teacher is null then
    raise exception 'TEST REPORT: needs at least one student and one teacher.';
  end if;

  -- Act as the student.
  perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);

  -- 1. Coins: the daily warm-up pays once a day.
  begin
    delete from public.coin_ledger where user_id = v_student and ref_type = 'warmup';
    v_before := public.coin_balance_of(v_student);
    perform public.claim_warmup_coins();
    perform public.claim_warmup_coins();
    v_after := public.coin_balance_of(v_student);
    r := array_append(r, case when v_after - v_before = coalesce((select case when speaking_warmup then warmup_coins else 0 end from public.coin_settings where id = 1), 0)
                   then '✓ warm-up coins paid once' else format('✗ warm-up coins: %s → %s', v_before, v_after) end);
  exception when others then r := array_append(r, ('✗ warm-up coins: ' || sqlerrm));
  end;

  -- 2. Shop: an order with too few coins is refused.
  begin
    insert into public.shop_items (title, price, is_active) values ('__test__', least(100000, public.coin_balance_of(v_student) + 1), true) returning id into v_id;
    begin
      perform public.shop_order(v_id);
      r := array_append(r, '✗ shop let a student buy without enough coins');
    exception when others then r := array_append(r, '✓ shop refuses without enough coins');
    end;
  exception when others then r := array_append(r, ('✗ shop: ' || sqlerrm));
  end;

  -- 3. Mistake notebook: wrong answers go in, right answers come out.
  begin
    insert into public.materials (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection)
    values ('__test__', '__test__', v_url, v_url, 'text/html', 0, 'upload', 'reading', 'tfng', '__test__') returning id into v_mat;
    insert into public.book_practice (user_id, material_id, score, max_score, details)
    values (v_student, v_mat, 1, 3, '{"qs":[{"n":1,"ok":true},{"n":2,"ok":false},{"n":3,"ok":false}]}');
    select wrong into v_left from public.mistake_pages where user_id = v_student and url = v_url;
    r := array_append(r, case when v_left = '{2,3}' then '✓ notebook keeps wrong answers' else format('✗ notebook after practice: %s', v_left) end);
    v_left := public.mistake_retest(v_url, '[{"n":2,"ok":true},{"n":3,"ok":false},{"n":5,"ok":false}]');
    r := array_append(r, case when v_left = '{3}' then '✓ notebook re-test removes fixed ones only' else format('✗ notebook after re-test: %s', v_left) end);
  exception when others then r := array_append(r, ('✗ notebook: ' || sqlerrm));
  end;

  -- 4. Grammar bank: AI corrections become cards; a right answer moves the card on.
  begin
    v_n := public.grammar_cards_from(v_student, gen_random_uuid(),
      '{"status":"done","corrections":[{"original":"peoples is","better":"people are","why":"plural"},{"original":"same","better":"same"}]}');
    r := array_append(r, case when v_n = 1 then '✓ grammar cards made from corrections' else format('✗ grammar cards made: %s (expected 1)', v_n) end);
    select id into v_id from public.grammar_cards where user_id = v_student and original = 'peoples is' order by created_at desc limit 1;
    perform public.review_grammar_card(v_id, true);
    select due_at > now() + interval '20 hours' into v_ok from public.grammar_cards where id = v_id;
    r := array_append(r, case when v_ok then '✓ grammar review moves the card to tomorrow' else '✗ grammar review did not move the card' end);
  exception when others then r := array_append(r, ('✗ grammar bank: ' || sqlerrm));
  end;

  -- 5. Speaking mock: one request at a time.
  begin
    delete from public.speaking_mocks where user_id = v_student and status in ('requested', 'unlocked');
    perform public.request_speaking_mock();
    begin
      perform public.request_speaking_mock();
      r := array_append(r, '✗ two speaking mock requests were allowed');
    exception when others then r := array_append(r, '✓ speaking mock: one request at a time');
    end;
  exception when others then r := array_append(r, ('✗ speaking mock: ' || sqlerrm));
  end;

  -- 6. A student cannot use teacher tools.
  begin
    perform public.give_speaking_mock(v_student);
    r := array_append(r, '✗ a student could open a speaking mock (teacher tool)');
  exception when others then r := array_append(r, '✓ teacher tools closed to students');
  end;

  -- 7. Act as the teacher: the Monday report is made.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role', 'authenticated')::text, true);
    perform public.group_common_mistakes((select id from public.groups order by created_at limit 1), 14);
    r := array_append(r, '✓ common mistakes open for the teacher');
    v_n := public.weekly_teacher_report();
    r := array_append(r, case when v_n >= 1 then '✓ Monday report made' else '✗ Monday report: nothing made' end);
  exception when others then r := array_append(r, ('✗ teacher tools: ' || sqlerrm));
  end;

  -- Undo everything and show the report.
  raise exception E'TEST REPORT (nothing was saved)\n%', array_to_string(r, E'\n');
end;
$$;
