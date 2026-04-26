-- =====================================================
-- Migration 02: Fjern auth-krav for PoC
-- =====================================================
-- Vi kører uden login i første fase. Det betyder:
-- - RLS skal tillade anon-rollen
-- - oprettet_af kan være NULL
-- - audit-triggeren skal ikke kalde auth.uid()
--
-- VIGTIGT: Dette er KUN til PoC. Skal strammes op før produktion.
-- =====================================================

-- 1. Drop eksisterende policies
drop policy if exists "Authenticated kan læse fakturaer" on public.fakturaer;
drop policy if exists "Authenticated kan oprette fakturaer" on public.fakturaer;
drop policy if exists "Authenticated kan opdatere fakturaer" on public.fakturaer;
drop policy if exists "Authenticated kan læse audit log" on public.audit_log;

-- 2. Opret nye åbne policies (PoC - alle kan alt)
create policy "PoC: alle kan læse fakturaer"
  on public.fakturaer for select
  to anon, authenticated
  using (true);

create policy "PoC: alle kan oprette fakturaer"
  on public.fakturaer for insert
  to anon, authenticated
  with check (true);

create policy "PoC: alle kan opdatere fakturaer"
  on public.fakturaer for update
  to anon, authenticated
  using (true);

create policy "PoC: alle kan læse audit log"
  on public.audit_log for select
  to anon, authenticated
  using (true);

-- 3. Opdater audit-trigger så den ikke crasher uden auth.uid()
create or replace function public.log_audit_fakturaer()
returns trigger
language plpgsql
security definer
as $$
declare
  v_aendringer jsonb := '{}'::jsonb;
  v_felt text;
  v_gammel_vaerdi jsonb;
  v_ny_vaerdi jsonb;
  v_bruger_id uuid;
begin
  -- Prøv at hente bruger-ID, men fald tilbage til NULL hvis ikke logget ind
  begin
    v_bruger_id := auth.uid();
  exception when others then
    v_bruger_id := null;
  end;
  
  if (tg_op = 'INSERT') then
    insert into public.audit_log (
      tabel_navn, raekke_id, handling,
      fuldt_billede_efter, bruger_id
    ) values (
      'fakturaer', new.id, 'INSERT',
      to_jsonb(new), v_bruger_id
    );
    return new;
    
  elsif (tg_op = 'UPDATE') then
    for v_felt in 
      select key from jsonb_each(to_jsonb(new))
      where to_jsonb(new) -> key is distinct from to_jsonb(old) -> key
        and key not in ('opdateret_dato')
    loop
      v_gammel_vaerdi := to_jsonb(old) -> v_felt;
      v_ny_vaerdi := to_jsonb(new) -> v_felt;
      v_aendringer := v_aendringer || jsonb_build_object(
        v_felt, jsonb_build_object('gammel', v_gammel_vaerdi, 'ny', v_ny_vaerdi)
      );
    end loop;
    
    if v_aendringer != '{}'::jsonb then
      insert into public.audit_log (
        tabel_navn, raekke_id, handling,
        aendret_felter, fuldt_billede_for, fuldt_billede_efter, bruger_id
      ) values (
        'fakturaer', new.id, 'UPDATE',
        v_aendringer, to_jsonb(old), to_jsonb(new), v_bruger_id
      );
    end if;
    
    new.opdateret_dato := now();
    return new;
    
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log (
      tabel_navn, raekke_id, handling,
      fuldt_billede_for, bruger_id
    ) values (
      'fakturaer', old.id, 'DELETE',
      to_jsonb(old), v_bruger_id
    );
    return old;
  end if;
  
  return null;
end;
$$;

-- 4. Storage policies for fakturaer-bucket
-- Disse skal også køres - alle kan upload og læse i PoC
-- (kør i SQL editor, men kan også gøres via UI under Storage > Policies)

-- Drop eksisterende hvis de findes
drop policy if exists "PoC: alle kan upload" on storage.objects;
drop policy if exists "PoC: alle kan læse" on storage.objects;

create policy "PoC: alle kan upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'fakturaer');

create policy "PoC: alle kan læse"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'fakturaer');
