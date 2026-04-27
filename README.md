# Fakturagodkendelse

Fakturahåndteringssystem til en gruppe investeringsforeninger. AI læser fakturaer, ekstraherer felter, og bogholderen godkender til bogføring og betaling.

PoC i drift på [fakturagodkendelse.vercel.app](https://fakturagodkendelse.vercel.app).

## Stack

- **Frontend:** Vanilla HTML/JS (ingen byggeproces, ingen frameworks)
- **Backend:** Vercel Serverless Functions (`/api/extract.js`)
- **Database:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage (to buckets: `fakturaer` + `faktura-bridge`)
- **LLM:** Mistral API (`mistral-large-latest`)
- **Font:** Work Sans

## ⚠️ PoC-advarsel

Denne implementering er designet til hurtig prototyping og **ikke produktionsklar**:

- Ingen authentication
- RLS-policies er åbne (alle kan læse/skrive)
- Storage-buckets er åbne for upload fra anonyme

Skal strammes op før produktion. Se `fakturagodkendelsessystem.md` for fuld dokumentation af PoC-valg og hvad IT skal håndtere ved overdragelse.

## Filstruktur

```
.
├── api/
│   └── extract.js              # Serverless: Mistral-kald + DB-opdatering
├── db/
│   └── setup.sql               # Komplet database-setup (én fil)
├── .gitignore
├── app.js                      # Forsidens logik + QR-bridging
├── config.js                   # Supabase URL + publishable key (offentlig)
├── faktura.html                # Detaljeside
├── faktura.js                  # Detaljesidens logik
├── fakturagodkendelsessystem.md  # Fuld projektdokumentation
├── index.html                  # Forsiden
├── logo.png                    # BankInvest-logo
├── package.json
├── README.md                   # Denne fil
├── styles.css                  # BankInvest-farver, Work Sans
└── upload.html                 # Mobil-side til QR-scanning fra telefon
```

## Opsætning

### 1. Supabase

Kør `db/setup.sql` på en frisk Supabase-instans. Det opretter:
- Tabeller: `fakturaer`, `leverandor_skabeloner`, `audit_log`
- Audit-triggers
- Storage buckets: `fakturaer` (permanent), `faktura-bridge` (midlertidig)
- RLS-policies (PoC: åbne)

### 2. Vercel

Importér repo'et på [vercel.com](https://vercel.com) → New Project.

**Environment variables der SKAL sættes:**

| Variabel | Værdi |
|----------|-------|
| `MISTRAL_API_KEY` | Mistral API-nøgle (fra console.mistral.ai) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key fra Supabase Settings → API |

⚠️ **Vigtigt:** `SUPABASE_SERVICE_ROLE_KEY` og `MISTRAL_API_KEY` må aldrig committes til git. De sættes kun som Vercel env vars.

### 3. Deploy

Vercel deployer automatisk når du pusher til `main`-branchen på GitHub.

## Brug

1. Åbn deployed URL
2. Tre måder at uploade en faktura:
   - Drag-and-drop fra computer
   - Klik "Vælg fil"
   - Klik "📱 Tag billede med telefon" → scan QR-kode med mobilen → tag billede
3. Vent 5-15 sekunder mens AI'en læser fakturaen
4. Se ekstraherede felter side om side med PDF/billede
5. Ret eventuelle felter, klik "Gem ændringer"

## Ekstraherede felter

**Bilagsspecifikt:**
- Bogføring: beskrivelse (max 30 tegn), konto
- Faktura: nummer, dato, forfaldsdato
- Beløb: ekskl. moms, momsbeløb, inkl. moms
- Reference: betalingsreference

**Leverandørdata (kandidater til skabelon):**
- Identifikation: navn, CVR, adresse
- Bankoplysninger: regnr/kontonr, IBAN, BIC
- Standard: valuta, momssats

## Implementerede features

- ✅ Upload via drag-and-drop, fil-vælger og QR-bridging fra mobil
- ✅ Mistral Vision-ekstraktion af faktura-felter
- ✅ Detaljeside med PDF/billede side om side
- ✅ Redigerbare felter med visuel ændringsfeedback og gem-knap
- ✅ Audit-log fra dag 1 (alle ændringer logges automatisk)
- ✅ Skabelon-tabel klar til skabelon-funktionalitet
- ✅ BankInvest design (farver, logo, Work Sans)

## Næste iterationer

**Kritisk – uden denne er PoC ikke en reel forretningsværdi:**
- Eksport af bogføringsfil til det custom bogføringssystem (format afklares)

**Skabelon-funktionalitet:**
- "Gem som ny leverandør"-knap der opretter skabelon
- Auto-link via CVR ved nye fakturaer
- Mistral får 5 seneste bogføringsbeskrivelser med ved match
- Leverandør-oversigtsside

**Senere:**
- Godkendelsesflow med roller og beløbsgrænser
- Afvigelsesanalyse, anomali-detektion, dubletkontrol
- Betalingsudvælgelse og generering af ISO 20022 pain.001

Se `fakturagodkendelsessystem.md` for fuld plan og beslutningslog.

## Dokumentation

- **Projektoverblik og beslutninger:** `fakturagodkendelsessystem.md`
- **Database-skema:** `db/setup.sql` (med kommentarer på hvert felt)
- **Kode:** alle filer er kommenteret på dansk
