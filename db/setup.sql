-- =====================================================
-- Fakturagodkendelsessystem - Komplet database setup
-- =====================================================
-- Denne fil opretter hele databasen i én kørsel.
-- Køres på en frisk Supabase-instans.
--
-- Indeholder:
--   - Tabeller: fakturaer, leverandor_skabeloner, audit_log
--   - Audit-triggers på alle data-tabeller
--   - Storage buckets: fakturaer (permanent), faktura-bridge (midlertidig)
--   - RLS-policies (PoC: åbne)
--
-- VIGTIGT - PoC vs. produktion:
--   PoC kører UDEN authentication. RLS-policies er åbne for anon-rollen
--   så alle kan læse og skrive. Dette skal strammes op før produktion:
--     - Tilføj Azure AD / Entra ID auth
--     - Stram RLS til at kræve authenticated user
--     - Implementer rolle-baseret adgang (uploader / godkender / bogfører)
--     - Implementer Segregation of Duties
-- =====================================================


-- =====================================================
-- 1. TABELLER
-- =====================================================

-- =====================================================
-- 1.1 leverandor_skabeloner - "kreditorkartoteket"
-- =====================================================
-- Skabelon med universelle data der genbruges per leverandør:
-- navn, CVR, adresse, bankkonto, default valuta/momssats/kontering.
-- CVR er primær matching-nøgle ved nye fakturaer.
-- =====================================================

create table public.leverandor_skabeloner (
  id uuid primary key default gen_random_uuid(),
  
  -- Identifikation
  cvr text unique,                              -- 8 cifre, kan være null for udenlandske
  leverandoer_navn text not null,
  leverandoer_adresse text,
  
  -- Bankoplysninger (universelle for leverandøren)
  bankkonto_iban text,
  bankkonto_bic text,
  bankkonto_regnr text,
  bankkonto_kontonr text,
  
  -- Standard-værdier
  standard_valuta text,                         -- ISO-kode, fx 'DKK', 'EUR'
  standard_momssats numeric(5,2),
  bogforingskonto varchar(20),                  -- Default kontonummer
  
  -- Status
  aktiv boolean not null default true,
  
  -- Tidsstempler
  oprettet_dato timestamptz not null default now(),
  oprettet_af uuid references auth.users(id),
  opdateret_dato timestamptz not null default now()
);

create index idx_leverandor_skabeloner_cvr on public.leverandor_skabeloner(cvr);
create index idx_leverandor_skabeloner_navn on public.leverandor_skabeloner(leverandoer_navn);

comment on table public.leverandor_skabeloner is 
  'Kreditorkartotek - universelle leverandørdata der genbruges på tværs af fakturaer.';
comment on column public.leverandor_skabeloner.cvr is 
  'Primær matching-nøgle. 8 cifre for danske leverandører. Kan være null for udenlandske.';
comment on column public.leverandor_skabeloner.bogforingskonto is 
  'Default bogføringskonto. Kontoplan importeres senere.';


-- =====================================================
-- 1.2 fakturaer - hovedtabel
-- =====================================================
-- Indeholder fil-reference, status og alle ekstraherede felter
-- direkte på rækken. PoC: ikke fuldt normaliseret, men struktureret
-- til at kunne udvides senere (linjer, godkendelsesflow, betalinger).
-- =====================================================

create table public.fakturaer (
  id uuid primary key default gen_random_uuid(),
  
  -- Fil-reference
  fil_sti text not null,                        -- sti i Supabase Storage
  fil_navn text not null,                       -- oprindeligt filnavn
  fil_type text not null,                       -- 'application/pdf', 'image/jpeg' etc.
  fil_storrelse_bytes bigint,
  
  -- Status og workflow
  status text not null default 'uploaded',      -- 'uploaded', 'extracting', 'extracted', 'extraction_failed'
  status_besked text,                           -- fejlbesked hvis extraction_failed
  
  -- Reference til skabelon (sættes ved CVR-match efter ekstraktion)
  skabelon_id uuid references public.leverandor_skabeloner(id) on delete set null,
  
  -- Bilags-specifikke felter (varierer per faktura)
  bogforingsbeskrivelse varchar(30),            -- Kort kontering (max 30 tegn)
  bogforingskonto varchar(20),                  -- Faktisk konto for denne faktura
  fakturanummer text,
  fakturadato date,
  forfaldsdato date,
  belob_eksk_moms numeric(15,2),
  momsbelob numeric(15,2),
  belob_inkl_moms numeric(15,2),
  betalingsreference text,
  
  -- Leverandørdata (kandidater til skabelon - bør synces når skabelon-funktionalitet bygges)
  leverandoer_cvr text,
  leverandoer_navn text,
  leverandoer_adresse text,
  betalingskonto_type text,                     -- 'dk', 'iban', 'fi'
  betalingskonto_regnr text,
  betalingskonto_kontonr text,
  betalingskonto_iban text,
  betalingskonto_bic text,
  valuta text,                                  -- ISO 4217
  momssats numeric(5,2),
  
  -- LLM-data
  llm_raa_svar jsonb,                           -- Hele Mistral-svaret til fejlsøgning
  llm_konfidensscore numeric(3,2),              -- 0.00-1.00 hvis modellen rapporterer det
  
  -- Tidsstempler
  oprettet_dato timestamptz not null default now(),
  oprettet_af uuid references auth.users(id),
  opdateret_dato timestamptz not null default now()
);

create index idx_fakturaer_status on public.fakturaer(status);
create index idx_fakturaer_oprettet_dato on public.fakturaer(oprettet_dato desc);
create index idx_fakturaer_leverandoer_cvr on public.fakturaer(leverandoer_cvr);
create index idx_fakturaer_skabelon on public.fakturaer(skabelon_id);

comment on table public.fakturaer is 
  'Fakturahoved med ekstraherede felter, status og fil-reference.';
comment on column public.fakturaer.skabelon_id is 
  'Reference til leverandørskabelon. Sættes automatisk ved CVR-match efter ekstraktion.';
comment on column public.fakturaer.bogforingsbeskrivelse is 
  'Kort kontering (max 30 tegn). Foreslås af AI, kan rettes af bogholder.';
comment on column public.fakturaer.llm_raa_svar is 
  'Hele Mistrals JSON-svar. Bruges til fejlsøgning og fremtidig genbearbejdning.';


-- =====================================================
-- 1.3 audit_log - revisionsspor
-- =====================================================
-- Generelt ændringsspor på alle datatabeller. Med fra dag 1.
-- Triggers fanger automatisk INSERT/UPDATE/DELETE og logger
-- både gamle og nye værdier samt hvilke felter der blev ændret.
-- =====================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  
  tabel_navn text not null,                     -- 'fakturaer', 'leverandor_skabeloner'
  raekke_id uuid not null,                      -- ID på den ændrede række
  handling text not null,                       -- 'INSERT', 'UPDATE', 'DELETE'
  
  aendret_felter jsonb,                         -- {felt: {gammel: x, ny: y}}
  fuldt_billede_for jsonb,                      -- snapshot før ændringen
  fuldt_billede_efter jsonb,                    -- snapshot efter ændringen
  
  bruger_id uuid references auth.users(id),
  tidsstempel timestamptz not null default now(),
  
  kontekst jsonb                                -- IP, user-agent, session osv. (fremtidig brug)
);

create index idx_audit_log_tabel_raekke on public.audit_log(tabel_navn, raekke_id);
create index idx_audit_log_tidsstempel on public.audit_log(tidsstempel desc);
create index idx_audit_log_bruger on public.audit_log(bruger_id);

comment on table public.audit_log is 
  'Generelt revisionsspor for alle datatabeller. Må aldrig ændres af brugere - kun via triggers.';


-- =====================================================
-- 2. AUDIT-TRIGGERS
-- =====================================================
-- Fanger automatisk alle INSERT/UPDATE/DELETE på datatabeller.
-- Tolerant overfor manglende auth.uid() (PoC kører uden login).
-- =====================================================

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

create trigger trg_audit_fakturaer
after insert or update or delete on public.fakturaer
for each row execute function public.log_audit_fakturaer();


create or replace function public.log_audit_leverandor_skabeloner()
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
      'leverandor_skabeloner', new.id, 'INSERT',
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
        'leverandor_skabeloner', new.id, 'UPDATE',
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
      'leverandor_skabeloner', old.id, 'DELETE',
      to_jsonb(old), v_bruger_id
    );
    return old;
  end if;
  
  return null;
end;
$$;

create trigger trg_audit_leverandor_skabeloner
after insert or update or delete on public.leverandor_skabeloner
for each row execute function public.log_audit_leverandor_skabeloner();


-- =====================================================
-- 3. STORAGE BUCKETS
-- =====================================================
-- Bemærk: Buckets oprettes via Supabase UI eller med disse statements.
-- Hvis du foretrækker UI: opret to buckets manuelt med disse indstillinger.
-- =====================================================

-- 3.1 'fakturaer' - permanent lagring af faktura-filer
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fakturaer',
  'fakturaer',
  false,
  26214400,                                     -- 25 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- 3.2 'faktura-bridge' - midlertidig lagring til mobil-til-PC overførsel
-- Filer slettes automatisk efter overførsel til hovedflowet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'faktura-bridge',
  'faktura-bridge',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;


-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================
-- PoC: åbne policies for anon-rollen.
-- Skal strammes op før produktion (kræver authenticated user + roller).
-- =====================================================

-- 4.1 fakturaer
alter table public.fakturaer enable row level security;

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


-- 4.2 leverandor_skabeloner
alter table public.leverandor_skabeloner enable row level security;

create policy "PoC: alle kan læse skabeloner"
  on public.leverandor_skabeloner for select
  to anon, authenticated
  using (true);

create policy "PoC: alle kan oprette skabeloner"
  on public.leverandor_skabeloner for insert
  to anon, authenticated
  with check (true);

create policy "PoC: alle kan opdatere skabeloner"
  on public.leverandor_skabeloner for update
  to anon, authenticated
  using (true);

create policy "PoC: alle kan slette skabeloner"
  on public.leverandor_skabeloner for delete
  to anon, authenticated
  using (true);


-- 4.3 audit_log - kun læsbar, aldrig redigerbar af brugere
alter table public.audit_log enable row level security;

create policy "PoC: alle kan læse audit log"
  on public.audit_log for select
  to anon, authenticated
  using (true);
-- Bemærk: Ingen INSERT/UPDATE/DELETE policies. Kun trigger-funktioner
-- (security definer) kan skrive til audit_log.


-- 4.4 Storage policies - hovedbucket
drop policy if exists "PoC: alle kan upload fakturaer" on storage.objects;
drop policy if exists "PoC: alle kan læse fakturaer" on storage.objects;

create policy "PoC: alle kan upload fakturaer"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'fakturaer');

create policy "PoC: alle kan læse fakturaer"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'fakturaer');


-- 4.5 Storage policies - bridge-bucket
drop policy if exists "PoC: alle kan upload til bridge" on storage.objects;
drop policy if exists "PoC: alle kan læse bridge" on storage.objects;
drop policy if exists "PoC: alle kan slette bridge" on storage.objects;
drop policy if exists "PoC: alle kan overskrive bridge" on storage.objects;

create policy "PoC: alle kan upload til bridge"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'faktura-bridge');

create policy "PoC: alle kan læse bridge"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'faktura-bridge');

create policy "PoC: alle kan slette bridge"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'faktura-bridge');

create policy "PoC: alle kan overskrive bridge"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'faktura-bridge');


-- =====================================================
-- 5. SLUTKONTROL
-- =====================================================
-- Verificér at alt er på plads:
--
-- select table_name from information_schema.tables 
--   where table_schema = 'public' 
--   order by table_name;
--
-- select id, name, public, file_size_limit from storage.buckets
--   where id in ('fakturaer', 'faktura-bridge');
--
-- select tablename, policyname from pg_policies 
--   where schemaname = 'public' 
--   order by tablename, policyname;
-- =====================================================
