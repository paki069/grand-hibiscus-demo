do $$
declare
  old_constraint record;
begin
  for old_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.spa_service_availability'::regclass
      and contype = 'x'
  loop
    execute format('alter table public.spa_service_availability drop constraint %I', old_constraint.conname);
  end loop;
end $$;
