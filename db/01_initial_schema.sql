-- =====================================================
-- Fakturagodkendelsessystem - Iteration 1
-- Database schema for upload + ekstraktion + visning
-- =====================================================

-- =====================================================
-- 1. fakturaer - hovedtabellen
-- =====================================================
-- Indeholder både fil-reference, status og de ekstraherede felter
-- direkte på rækken. Senere splittes ekstraherede felter ud i 
-- separat tabel hvis nødvendigt, men til PoC er det fint at have
-- alt på samme række.

create table public.fakturaer (
  id uuid primary key default gen_random_uuid(),
  
  -- Fil-reference
  fil_sti text not null,                    -- sti i Supabase Storage
  fil_navn text not null,                   -- oprindeligt filnavn
  fil_type text not null,                   -- 'pdf', 'image/jpeg' etc.
  fil_storrelse_bytes bigint,
  
  -- Status og workflow
  status text not null default 'uploaded',  -- 'uploaded', 'extracting', 'extracted', 'extraction_failed'
  status_besked text,                       -- fejlbesked hvis extraction_failed
  
  -- Ekstraherede felter (alle nullable indtil ekstraktion er kørt)
  leverandoer_cvr text,
  leverandoer_navn text,
  leverandoer_adresse text,
  fakturanummer text,
  fakturadato date,
  forfaldsdato date,
  belob_eksk_moms numeric(15,2),
  momsbelob numeric(15,2),
  momssats numeric(5,2),
  belob_inkl_moms numeric(15,2),
  valuta text,                              -- ISO 4217, fx 'DKK', 'EUR'
  betalingskonto_type text,                 -- 'dk', 'iban', 'fi'
  betalingskonto_regnr text,
  betalingskonto_kontonr text,
  betalingskonto_iban text,
  betalingskonto_bic text,
  betalingsreference text,
  
  -- Hele LLM-svaret som JSON for fejlsøgning og fremtidig brug
  llm_raa_svar jsonb,
  llm_konfidensscore numeric(3,2),          -- 0.00-1.00 hvis modellen rapporterer det
  
  -- Tidsstempler
  oprettet_dato timestamptz not null default now(),
  oprettet_af uuid references auth.users(id),
  opdateret_dato timestamptz not null default now()
);

create index idx_fakturaer_status on public.fakturaer(status);
create index idx_fakturaer_oprettet_dato on public.fakturaer(oprettet_dato desc);
create index idx_fakturaer_leverandoer_cvr on public.fakturaer(leverandoer_cvr);

-- =====================================================
-- 2. audit_log - generelt revisionsspor
-- =====================================================
-- Med fra dag 1 som besluttet. Logger alle ændringer på alle
-- tabeller af interesse. I PoC starter vi med fakturaer.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  
  tabel_navn text not null,                 -- 'fakturaer', senere flere
  raekke_id uuid not null,                  -- ID på den ændrede række
  handling text not null,                   -- 'INSERT', 'UPDATE', 'DELETE'
  
  aendret_felter jsonb,                     -- {felt: {gammel: x, ny: y}}
  fuldt_billede_for jsonb,                  -- snapshot før ændringen
  fuldt_billede_efter jsonb,                -- snapshot efter ændringen
  
  bruger_id uuid references auth.users(id),
  tidsstempel timestamptz not null default now(),
  
  -- Til fremtidig kontekst
  kontekst jsonb                            -- IP, user-agent, session osv.
);

create index idx_audit_log_tabel_raekke on public.audit_log(tabel_navn, raekke_id);
create index idx_audit_log_tidsstempel on public.audit_log(tidsstempel desc);
create index idx_audit_log_bruger on public.audit_log(bruger_id);

-- =====================================================
-- 3. Trigger til automatisk audit-logning af fakturaer
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
begin
  if (tg_op = 'INSERT') then
    insert into public.audit_log (
      tabel_navn, raekke_id, handling,
      fuldt_billede_efter, bruger_id
    ) values (
      'fakturaer', new.id, 'INSERT',
      to_jsonb(new), auth.uid()
    );
    return new;
    
  elsif (tg_op = 'UPDATE') then
    -- Find ændrede felter
    for v_felt in 
      select key from jsonb_each(to_jsonb(new))
      where to_jsonb(new) -> key is distinct from to_jsonb(old) -> key
        and key not in ('opdateret_dato')   -- ignorer tekniske felter
    loop
      v_gammel_vaerdi := to_jsonb(old) -> v_felt;
      v_ny_vaerdi := to_jsonb(new) -> v_felt;
      v_aendringer := v_aendringer || jsonb_build_object(
        v_felt, jsonb_build_object('gammel', v_gammel_vaerdi, 'ny', v_ny_vaerdi)
      );
    end loop;
    
    -- Kun log hvis der faktisk er ændringer
    if v_aendringer != '{}'::jsonb then
      insert into public.audit_log (
        tabel_navn, raekke_id, handling,
        aendret_felter, fuldt_billede_for, fuldt_billede_efter, bruger_id
      ) values (
        'fakturaer', new.id, 'UPDATE',
        v_aendringer, to_jsonb(old), to_jsonb(new), auth.uid()
      );
    end if;
    
    -- Opdater opdateret_dato automatisk
    new.opdateret_dato := now();
    return new;
    
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log (
      tabel_navn, raekke_id, handling,
      fuldt_billede_for, bruger_id
    ) values (
      'fakturaer', old.id, 'DELETE',
      to_jsonb(old), auth.uid()
    );
    return old;
  end if;
  
  return null;
end;
$$;

create trigger trg_audit_fakturaer
after insert or update or delete on public.fakturaer
for each row execute function public.log_audit_fakturaer();

-- =====================================================
-- 4. Row Level Security (RLS)
-- =====================================================
-- Foreløbigt: alle authenticated brugere kan se og oprette.
-- Strammes op når vi har roller/rettigheder på plads.

alter table public.fakturaer enable row level security;
alter table public.audit_log enable row level security;

create policy "Authenticated kan læse fakturaer"
  on public.fakturaer for select
  to authenticated
  using (true);

create policy "Authenticated kan oprette fakturaer"
  on public.fakturaer for insert
  to authenticated
  with check (auth.uid() = oprettet_af);

create policy "Authenticated kan opdatere fakturaer"
  on public.fakturaer for update
  to authenticated
  using (true);

create policy "Authenticated kan læse audit log"
  on public.audit_log for select
  to authenticated
  using (true);

-- Audit log må ALDRIG kunne ændres eller slettes af brugere
-- (kun via trigger og service-role)
-- Ingen INSERT/UPDATE/DELETE policies for normale brugere

-- =====================================================
-- 5. Storage bucket til faktura-filer
-- =====================================================
-- Køres i Supabase dashboard, men dokumenteret her:
--
-- Bucket name: 'fakturaer'
-- Public: false
-- File size limit: 25 MB
-- Allowed MIME types: application/pdf, image/jpeg, image/png, image/heic
--
-- Storage policies:
-- - Authenticated kan upload til mappe = deres user_id
-- - Authenticated kan læse alle filer i bucket (foreløbigt)
