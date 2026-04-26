# Fakturagodkendelse - PoC

Proof-of-concept for et fakturagodkendelsessystem til investeringsforeninger.

## Stack

- **Frontend:** Vanilla HTML/JS (ingen byggeproces)
- **Backend:** Vercel Serverless Functions (`/api/extract.js`)
- **Database:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage
- **LLM:** Mistral API (`mistral-large-latest`)

## ⚠️ PoC-advarsel

Denne implementering er designet til hurtig prototyping og er **ikke produktionsklar**:

- Ingen authentication
- RLS-policies er åbne (alle kan læse/skrive)
- Storage-bucket er åben for upload fra anonyme

Se `fakturagodkendelsessystem-foreloebig.md` for fuld dokumentation af PoC-valg og hvad der skal strammes op før produktion.

## Filstruktur

```
.
├── index.html          # Forsiden – upload + liste
├── faktura.html        # Detaljeside – PDF + felter
├── styles.css          # Styling
├── app.js              # Forsiden logik
├── faktura.js          # Detaljeside logik
├── config.js           # Supabase URL + anon key (offentlig)
├── api/
│   └── extract.js      # Serverless: Mistral-kald
├── package.json
└── README.md
```

## Opsætning

### 1. Supabase

Database-schema kører fra `01_initial_schema.sql` og `02_fjern_auth_krav.sql`.

Storage bucket der skal oprettes:
- Navn: `fakturaer`
- Public: nej (privat)
- Filstørrelsesgrænse: 25 MB
- MIME-types: `application/pdf, image/jpeg, image/png, image/heic`

### 2. Vercel

Importér repo'et på vercel.com → New Project.

**Environment variables der SKAL sættes:**

| Variabel | Værdi |
|----------|-------|
| `MISTRAL_API_KEY` | Din Mistral API-nøgle |
| `SUPABASE_URL` | `https://rljwhngtzhefrtvmfpyh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key fra Supabase Settings → API |

⚠️ **Vigtigt:** `SUPABASE_SERVICE_ROLE_KEY` må aldrig commitis til git. Den sættes kun som Vercel env var.

### 3. Deploy

Vercel deployer automatisk når du pusher til `main`-branchen på GitHub.

## Brug

1. Åbn deployed URL
2. Drag-and-drop en faktura, vælg fil eller tag billede med kamera (mobil)
3. Vent 5-15 sekunder mens AI'en læser fakturaen
4. Se ekstraherede felter side om side med PDF/billede

## Ekstraherede felter (foreløbig liste)

- Leverandør: navn, CVR, adresse
- Faktura: nummer, dato, forfaldsdato
- Beløb: ekskl. moms, momsbeløb, momssats, inkl. moms, valuta
- Betalingsoplysninger: regnr/kontonr, IBAN/BIC, betalingsreference

## Næste skridt

Se `fakturagodkendelsessystem-foreloebig.md` for fuld plan.

Næste iteration: rettelse af felter, godkendelsesflow, kreditorkartotek.
