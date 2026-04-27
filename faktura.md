
# Fakturagodkendelsessystem - Projektdokument

> **Status:** PoC i drift
> **Version:** 1.0
> **Senest opdateret:** 26. april 2026
> **Ejer:** Allan
> **Repository:** github.com/afunky11/Fakturagodkendelse
> **URL:** fakturagodkendelse.vercel.app

---

## 1. Hvad er systemet?

Et fakturahåndteringssystem til en gruppe investeringsforeninger. Det eksisterende bogføringssystem er meget custom og har ikke et kreditorkartotek – derfor påtager dette system sig fakturahåndtering, kreditorreskontro og bogføringsklar eksport som ét samlet flow.

PoC'en er bygget for at bevise at AI kan læse fakturaer pålideligt nok til at automatisere processen. Den drives af Allan og overdrages til IT-afdelingen til produktionssætning når konceptet er bevist og kravene er modnet.

## 2. Stak

| Lag | PoC | Produktion (IT) |
|-----|-----|-----------------|
| Frontend | Vanilla HTML/JS på Vercel | TBD – sandsynligvis React-baseret |
| Backend | Vercel Serverless Functions | .NET eller Node på Kubernetes |
| Database | Supabase (PostgreSQL) | Oracle |
| Storage | Supabase Storage | Azure Blob (med immutability policy) |
| LLM/OCR | Mistral API (`mistral-large-latest`) | Azure OpenAI (data forbliver i egen tenant) |
| Auth | Ingen (PoC) | Azure AD / Entra ID |
| Identity | Ingen (PoC) | Azure AD / Entra ID |

**Begrundelse for PoC-stak:** Genbrug af AI Tutor-stakken giver hurtig iteration uden Node.js-opsætning. Mistral-nøglen holdes serverside via Vercel Serverless Functions for sikkerhed. Når kravene er moden, porteres til IT's egen stak.

## 3. Overordnet flow

1. **Upload** – drag-and-drop, vælg fil, eller scan QR-kode for at uploade fra telefon
2. **Ekstraktion** – Mistral Vision læser fakturaen og udtrækker prædefinerede felter
3. **Validering** – bruger kontrollerer/retter felter i UI med PDF/billede side om side
4. **Kontrol af betalingsoplysninger** *(planlagt)* – bankkonto tjekkes mod leverandørens kendte konti
5. **Godkendelsesflow** *(planlagt)* – faktura sendes til godkender(e), status opdateres
6. **Godkendelse** *(planlagt)* – godkender godkender, stemples i DB
7. **Frigivelse til bogføring** *(planlagt)* – bogføringsklar
8. **Eksport af bogføringsfil** *(planlagt)* – fil i format som bogføringssystemet kan importere. **Dette er kerneleverancen** – uden denne er systemet ikke meget værd, da bogføringen så stadig skal indtastes manuelt.
9. **Betalingsudvælgelse** *(planlagt)* – forfaldne/godkendte fakturaer samles til betaling
10. **Betalingsgodkendelse** *(planlagt)* – endelig godkendelse af batch (fire-øje-princip)
11. **Generering af betalingsfil** *(planlagt)* – ISO 20022 pain.001 til banken

> Afstemning af betalinger håndteres i eksisterende systemer og er uden for scope.

**Kerneleverancer:** Pkt. 1-8 er den primære værdi for bogholderiet (fra modtagelse til bogføring). Pkt. 9-11 er anden fase (betalingsdelen). Uden pkt. 8 (eksport til bogføring) er hele systemet bare et OCR-værktøj.

## 4. Filstruktur

```
.
├── api/
│   └── extract.js              # Serverless: kalder Mistral, opdaterer DB
├── db/
│   └── setup.sql               # Komplet database-setup (én fil)
├── .gitignore
├── app.js                      # Forsidens logik + QR-bridging
├── config.js                   # Supabase URL + publishable key
├── faktura.html                # Detaljeside
├── faktura.js                  # Detaljesidens logik
├── index.html                  # Forsiden
├── logo.png                    # BankInvest-logo
├── package.json
├── README.md
├── styles.css                  # BankInvest-farver, Work Sans
└── upload.html                 # Mobil-side til QR-scanning
```

## 5. Database-skema

Hele databasen er defineret i `db/setup.sql`. Tre tabeller:

**`fakturaer`** – fakturahoved med fil-reference, status og alle ekstraherede felter direkte på rækken. Nullable felter for alt der ikke er kritisk. Reference til `leverandor_skabeloner` via `skabelon_id`.

**`leverandor_skabeloner`** – kreditorkartotek med universelle leverandørdata: navn, CVR (unique), adresse, bankkonto, default valuta/momssats/bogføringskonto. CVR er primær matching-nøgle.

**`audit_log`** – generelt revisionsspor. Triggers på `fakturaer` og `leverandor_skabeloner` fanger automatisk INSERT/UPDATE/DELETE og logger både gamle og nye værdier samt hvilke felter der blev ændret.

Storage:
- `fakturaer` – permanent lagring af faktura-filer
- `faktura-bridge` – midlertidig lagring til mobil-til-PC overførsel

## 6. Sikkerhed

**Princip:** Ingen API-nøgler i klient-side kode. Alle eksterne API-kald (Mistral) går gennem Vercel Serverless Functions.

| Nøgle | Placering | Begrundelse |
|-------|-----------|-------------|
| Supabase publishable key | Klient | Designet til at være offentlig, beskyttet af RLS |
| Supabase service_role key | Vercel env vars | Omgår RLS – må aldrig eksponeres |
| Mistral API key | Vercel env vars | Mistral har kun én slags nøgle med fuld kontoadgang |

Vercel environment variables der skal sættes:
- `MISTRAL_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 7. PoC kører uden auth

Første PoC-iteration kører **uden login**. Alle besøgende kan uploade og se fakturaer. Det er bevidst valg for at fokusere på det centrale spørgsmål (kan AI læse fakturaer pålideligt nok), ikke et udsnit der er glemt.

**Konsekvenser:**
- RLS-policies er åbne for `anon`-rollen
- `audit_log.bruger_id` er `NULL` – vi kan se *hvad* der er ændret, men ikke *hvem*
- Storage-buckets er åbne for upload og læsning fra anonyme

**Skal strammes op før produktion:**
- Tilføj Azure AD / Entra ID integration
- Stram RLS-policies så kun authenticated brugere har adgang
- Implementer roller og rolle-baseret adgang (uploader / godkender / bogfører)
- Audit-log skal kræve gyldig bruger-kontekst
- Storage-policies skal kræve authentication
- Implementer Segregation of Duties (uploader ≠ godkender ≠ bogfører)

## 8. Implementerede features

**Upload og ekstraktion:**
- Drag-and-drop fra PC
- Vælg fil-knap
- QR-bridging fra mobil til PC (scanner QR-kode → mobil uploader → PC fortsætter automatisk)
- Mistral læser PDF og billeder direkte
- Råt LLM-svar gemmes for fejlsøgning

**Felter der ekstraheres:**
- Leverandør: navn, CVR, adresse
- Faktura: nummer, dato, forfaldsdato
- Beløb: ekskl. moms, momsbeløb, momssats, inkl. moms, valuta
- Betalingsoplysninger: regnr/kontonr, IBAN/BIC, betalingsreference
- Bogføring: beskrivelse (max 30 tegn), konto

**Detaljeside:**
- PDF/billede side om side med formular
- Felter opdelt i to klare sektioner: bilagsspecifikt vs. leverandørdata
- Redigerbare felter med visuel ændringsfeedback
- Manuel gem-knap med ændringstæller
- Konfidens-badge fra AI

**Database:**
- Audit-log fra dag 1 (alle ændringer logges automatisk)
- Skabelon-tabel klar til skabelon-funktionalitet
- CVR som primær matching-nøgle

**Design:**
- BankInvest farver og Work Sans font
- Logo i header (højrestillet)
- Responsivt mobil-layout

## 9. Næste iterationer

**Eksport til bogføringssystem (kritisk – uden denne er PoC ikke en reel forretningsværdi):**
- Afklaring af import-format (CSV, XML, JSON, andet) hos det custom bogføringssystem
- Definition af felt-mapping mellem vores datamodel og bogføringssystemets format
- Generering af bogføringsfil per faktura eller batch
- Status-flow så fakturaen markeres som "bogført" når filen er genereret/overført
- Dokumentation af eksempel-fil og felt-mapping til IT

**Skabelon-funktionalitet (commit 2):**
- "Gem som ny leverandør"-knap der opretter skabelon
- Auto-link af nye fakturaer til eksisterende skabelon via CVR
- Auto-udfyld af leverandørdata fra skabelon
- Mistral får 5 seneste bogføringsbeskrivelser med i prompten ved match
- "Synk til skabelon"-knap når man retter leverandørdata på fakturaen
- Leverandør-oversigtsside

**Godkendelsesflow:**
- Godkender-rolle og UI
- Beløbsgrænser for godkendelse
- Status-flow: uploadet → læst → godkendt → frigivet → bogført

**Avancerede features:**
- Afvigelsesanalyse mod tidligere fakturaer
- Anomali-detektion (ny bankkonto, store afvigelser)
- CVR-validering mod CVR-registret
- Dubletkontrol
- Periodiseringsforslag

**Betaling:**
- Betalingsudvælgelse og batching
- Fire-øje-godkendelse
- Generering af ISO 20022 pain.001

## 10. Investeringsforeninger – strukturelle forhold

⚠️ **Status:** Skal afklares før godkendelses- og bogføringsflow designes.

Investeringsforeninger har en særlig struktur (forening → afdelinger → andelsklasser plus separat forvaltningsselskab). Fakturaer kan komme på alle niveauer og skal fordeles korrekt mellem afdelinger. Dette er regulatorisk væsentligt og skal designes ordentligt.

Konkrete spørgsmål der skal besvares:
- Hvor mange foreninger og afdelinger?
- Er der separat forvaltningsselskab?
- Hvordan håndteres omkostningsfordeling i dag?
- Hvilke godkendere på hvilke beløbsgrænser?
- Hvad siger prospekt og vedtægter om afdelingernes omkostninger?
- **Hvilket import-format kan bogføringssystemet håndtere?** (kritisk – afgør hvad eksport-modulet skal kunne)
- **Findes der dokumentation eller eksempel-fil på import-formatet?**
- Har bogføringssystemet selskabs- og afdelingsdimension i posteringen?
- Hvordan ser eksisterende kontoplan ud, og kan den eksporteres?

## 11. Anbefalinger til IT ved overdragelse

Selve PoC-koden er ikke produktionsklar – den er bygget til hurtig iteration og bevisførelse. Men datamodellen, UX-flowet og forretningslogikken er.

**Hvad IT bør portere:**
- Datamodellen (ganske direkte fra `setup.sql`, evt. omsat til Oracle-syntaks)
- Mistral-prompten og felt-mapping (i `api/extract.js`)
- Workflow-logikken (status-overgange, ændringsspor)
- BankInvest-design og UI-struktur

**Hvad IT bør gentænke:**
- Auth + RLS + roller (PoC kører helt uden)
- Skift fra Mistral til Azure OpenAI (data i egen tenant)
- Skift fra Supabase Storage til Azure Blob med immutability
- Drift, monitoring, error-håndtering
- Skalering hvis nødvendigt

## 12. Beslutningslog

| Dato | Beslutning | Begrundelse |
|------|------------|-------------|
| 2026-04-23 | PoC bygges i Supabase + Mistral + Vercel-stakken | Hurtig iteration, kendt stak. IT overtager til produktion. |
| 2026-04-23 | Etapeinddelt udrulning | Reducerer risiko, giver tidlig værdi |
| 2026-04-23 | Kreditorkartotek bygges som del af løsningen | Bogføringssystemet har ikke kreditorbegreb |
| 2026-04-23 | Kontrol af bankkonto mod kendte konti er del af etape 1 | Kritisk svindelbeskyttelse |
| 2026-04-23 | Fire-øje-princip på betalingsgodkendelse | Standard kontrol i reskontro |
| 2026-04-23 | Afstemning af betalinger er uden for scope | Eksisterende systemer håndterer det |
| 2026-04-26 | Frontend i vanilla HTML/JS | Genbrug af AI Tutor-stakken, hurtigere PoC-iteration |
| 2026-04-26 | Mistral-kald serverside via Vercel Serverless Function | Sikkerhed - Mistral-nøgle eksponeres aldrig |
| 2026-04-26 | Auth fravalgt i første PoC-iteration | Fokus på det centrale spørgsmål: kan AI læse fakturaer? |
| 2026-04-26 | Datamodel ikke fuldt normaliseret i PoC | Afventer rigtige fakturaer og foreningsstruktur |
| 2026-04-26 | CVR som primær matching-nøgle for skabeloner | Entydigt, lader sig validere mod CVR-registret |
| 2026-04-26 | Skabeloner oprettes manuelt (ikke auto) | Mere kontrol, undgår AI laver dårlige skabeloner |
| 2026-04-26 | Felter på skabelon kan redigeres frit på fakturasiden | Bedste fra begge verdener – fri redigering, mulighed for synk |
| 2026-04-26 | Bogføringskonto som tekst-felt nu, kontoplan importeres senere | Pragmatisk start, kan opgraderes til dropdown |
| 2026-04-26 | QR-bridging fra mobil til PC | Genbrug af mønster fra AI Tutor – beviset fungerer |
| 2026-04-26 | Eksport af bogføringsfil prioriteres som kritisk leverance | Uden denne er systemet ikke en reel forretningsværdi – bogføring skal stadig indtastes manuelt. Format afklares hos IT/leverandør af bogføringssystem. |

---

*Dokumentet opdateres når der træffes nye beslutninger eller bygges nye features.*
