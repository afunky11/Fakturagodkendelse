
// =====================================================
// /api/extract.js
// Vercel Serverless Function
// Kalder Mistral API for at ekstraktere felter fra faktura
// =====================================================
//
// Miljøvariabler der skal sættes i Vercel:
// - MISTRAL_API_KEY: Mistral API-nøgle
// - SUPABASE_URL: Supabase projekt URL
// - SUPABASE_SERVICE_ROLE_KEY: Service role key (omgår RLS)
//
// Bemærk: SERVICE_ROLE bruges fordi vi opdaterer på vegne af brugeren
// uden at have et auth-token (PoC kører uden login).
// =====================================================

export default async function handler(req, res) {
  // Kun POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fakturaId, filePath, fileType } = req.body;

  if (!fakturaId || !filePath) {
    return res.status(400).json({ error: 'Mangler fakturaId eller filePath' });
  }

  // Tjek miljøvariabler
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MISTRAL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Mangler miljøvariabler');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    // 1. Sæt status til 'extracting'
    await updateFaktura(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fakturaId, {
      status: 'extracting'
    });

    // 2. Hent fil fra Supabase Storage som signeret URL
    const signedUrl = await getSignedUrl(
      SUPABASE_URL, 
      SUPABASE_SERVICE_ROLE_KEY, 
      filePath
    );

    // 3. Kald Mistral med fil-URL
    const ekstraktion = await kaldMistral(MISTRAL_API_KEY, signedUrl, fileType);

    // 4. Opdater faktura med ekstraherede felter
    await updateFaktura(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fakturaId, {
      ...ekstraktion.felter,
      llm_raa_svar: ekstraktion.raaSvar,
      status: 'extracted'
    });

    return res.status(200).json({ 
      success: true, 
      felter: ekstraktion.felter 
    });

  } catch (error) {
    console.error('Ekstraktionsfejl:', error);
    
    // Markér faktura som fejlet
    try {
      await updateFaktura(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fakturaId, {
        status: 'extraction_failed',
        status_besked: error.message
      });
    } catch (updateErr) {
      console.error('Kunne ikke opdatere fejlstatus:', updateErr);
    }

    return res.status(500).json({ error: error.message });
  }
}

// =====================================================
// Mistral-kald
// =====================================================

async function kaldMistral(apiKey, fileUrl, fileType) {
  const isPdf = fileType === 'application/pdf';
  
  const prompt = `Du er en ekspert i at læse danske fakturaer. Analyser denne faktura og udtræk følgende felter.

Returnér KUN gyldigt JSON, ingen forklaring eller markdown. Brug null for felter du ikke kan finde.

JSON-skema:
{
  "leverandoer_cvr": "string eller null (kun cifre, fx '12345678')",
  "leverandoer_navn": "string eller null",
  "leverandoer_adresse": "string eller null",
  "fakturanummer": "string eller null",
  "fakturadato": "YYYY-MM-DD eller null",
  "forfaldsdato": "YYYY-MM-DD eller null",
  "belob_eksk_moms": "tal eller null (fx 1234.56)",
  "momsbelob": "tal eller null",
  "momssats": "tal eller null (fx 25 for 25%)",
  "belob_inkl_moms": "tal eller null",
  "valuta": "string ISO-kode eller null (fx 'DKK', 'EUR')",
  "betalingskonto_type": "'dk' for dansk regnr+kontonr, 'iban' for IBAN, 'fi' for FI-kode, eller null",
  "betalingskonto_regnr": "string eller null (4 cifre)",
  "betalingskonto_kontonr": "string eller null",
  "betalingskonto_iban": "string eller null",
  "betalingskonto_bic": "string eller null (SWIFT-kode)",
  "betalingsreference": "string eller null (FI-kode, OCR-linje, fakturareference)",
  "konfidens": "tal mellem 0 og 1 der angiver hvor sikker du er på ekstraktionen samlet set"
}

VIGTIGT:
- Tal skal være rigtige tal (1234.56), ikke strings ("1.234,56")
- Datoer SKAL være YYYY-MM-DD format
- CVR er altid 8 cifre, kun tal
- Hvis du ikke kan finde et felt, brug null - GÆT IKKE`;

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      isPdf
        ? { type: 'document_url', document_url: fileUrl }
        : { type: 'image_url', image_url: fileUrl }
    ]
  }];

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages: messages,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API fejl (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const indhold = data.choices[0].message.content;
  
  let parsed;
  try {
    parsed = JSON.parse(indhold);
  } catch (e) {
    throw new Error('Mistral returnerede ikke gyldig JSON: ' + indhold.substring(0, 200));
  }

  // Map til database-felter
  const felter = {
    leverandoer_cvr: cleanString(parsed.leverandoer_cvr),
    leverandoer_navn: cleanString(parsed.leverandoer_navn),
    leverandoer_adresse: cleanString(parsed.leverandoer_adresse),
    fakturanummer: cleanString(parsed.fakturanummer),
    fakturadato: cleanDate(parsed.fakturadato),
    forfaldsdato: cleanDate(parsed.forfaldsdato),
    belob_eksk_moms: cleanNumber(parsed.belob_eksk_moms),
    momsbelob: cleanNumber(parsed.momsbelob),
    momssats: cleanNumber(parsed.momssats),
    belob_inkl_moms: cleanNumber(parsed.belob_inkl_moms),
    valuta: cleanString(parsed.valuta),
    betalingskonto_type: cleanString(parsed.betalingskonto_type),
    betalingskonto_regnr: cleanString(parsed.betalingskonto_regnr),
    betalingskonto_kontonr: cleanString(parsed.betalingskonto_kontonr),
    betalingskonto_iban: cleanString(parsed.betalingskonto_iban),
    betalingskonto_bic: cleanString(parsed.betalingskonto_bic),
    betalingsreference: cleanString(parsed.betalingsreference),
    llm_konfidensscore: cleanNumber(parsed.konfidens)
  };

  return {
    felter,
    raaSvar: parsed
  };
}

// =====================================================
// Supabase-hjælpere (REST API direkte for at undgå dependencies)
// =====================================================

async function getSignedUrl(supabaseUrl, serviceKey, filePath) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/fakturaer/${filePath}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 600 }) // 10 minutter er rigeligt
    }
  );

  if (!response.ok) {
    throw new Error(`Kunne ikke generere signeret URL: ${response.status}`);
  }

  const data = await response.json();
  return `${supabaseUrl}/storage/v1${data.signedURL}`;
}

async function updateFaktura(supabaseUrl, serviceKey, fakturaId, fields) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/fakturaer?id=eq.${fakturaId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(fields)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kunne ikke opdatere faktura: ${response.status} - ${errorText}`);
  }
}

// =====================================================
// Data-rensning
// =====================================================

function cleanString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

function cleanDate(value) {
  if (!value) return null;
  // Forventer YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}
