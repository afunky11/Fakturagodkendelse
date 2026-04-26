// =====================================================
// /api/extract.js
// Vercel Serverless Function
// Kalder Mistral API for at ekstraktere felter fra faktura
// =====================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fakturaId, filePath, fileType } = req.body;

  if (!fakturaId || !filePath) {
    return res.status(400).json({ error: 'Mangler fakturaId eller filePath' });
  }

  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MISTRAL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Mangler miljøvariabler');
    return res.status(500).json({ error: 'Server misconfigured - missing env vars' });
  }

  try {
    console.log('Starter ekstraktion for fakturaId:', fakturaId, 'filePath:', filePath);
    
    await updateFaktura(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fakturaId, {
      status: 'extracting'
    });

    console.log('Genererer signed URL...');
    const signedUrl = await getSignedUrl(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, filePath);
    console.log('Signed URL OK');

    console.log('Kalder Mistral...');
    const ekstraktion = await kaldMistral(MISTRAL_API_KEY, signedUrl, fileType);
    console.log('Mistral OK');

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
  "bogforingsbeskrivelse": "MAX 30 TEGN kort beskrivelse til bogføring",
  "bogforingskonto": "string eller null - kun hvis fakturaen tydeligt indeholder en kontonummer-reference",
  "konfidens": "tal mellem 0 og 1"
}

VIGTIGT:
- Tal skal være rigtige tal (1234.56), ikke strings ("1.234,56")
- Datoer SKAL være YYYY-MM-DD format
- CVR er altid 8 cifre, kun tal
- Hvis du ikke kan finde et felt, brug null - GÆT IKKE

OM bogforingsbeskrivelse:
- Kort, sigende beskrivelse til kontering (MAX 30 TEGN inkl. mellemrum)
- Format: "[ydelse] [periode]" eller "[ydelse] [referencepunkt]"
- Eksempler:
  * "Husleje Q4 2026"
  * "Revision 2025"
  * "Depotgebyr nov 26"
  * "Konsulent okt 26"
- HOLD DIG STRENGT UNDER 30 TEGN - tæl mellemrum med

OM bogforingskonto:
- Returnér KUN hvis fakturaen utvetydigt henviser til en specifik kontonummer
- Eksempler: hvis fakturaen siger "Bogføres på konto 6420" → returnér "6420"
- I langt de fleste tilfælde er dette null - bogføringskonto besluttes af bogholderen, ikke af leverandøren
- GÆT IKKE en konto baseret på fakturatypen`;

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

  let beskrivelse = cleanString(parsed.bogforingsbeskrivelse);
  if (beskrivelse && beskrivelse.length > 30) {
    console.warn(`Mistral returnerede beskrivelse på ${beskrivelse.length} tegn, klipper til 30`);
    beskrivelse = beskrivelse.substring(0, 30).trim();
  }

  let konto = cleanString(parsed.bogforingskonto);
  if (konto && konto.length > 20) {
    console.warn(`Mistral returnerede kontonummer på ${konto.length} tegn, klipper til 20`);
    konto = konto.substring(0, 20).trim();
  }

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
    bogforingsbeskrivelse: beskrivelse,
    bogforingskonto: konto,
    llm_konfidensscore: cleanNumber(parsed.konfidens)
  };

  return {
    felter,
    raaSvar: parsed
  };
}

// =====================================================
// Supabase Storage - signeret URL
// =====================================================

async function getSignedUrl(supabaseUrl, serviceKey, filePath) {
  const encodedPath = encodeURIComponent(filePath);
  const url = `${supabaseUrl}/storage/v1/object/sign/fakturaer/${encodedPath}`;
  
  console.log('POST til:', url);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: 600 })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Signed URL fejl-respons:', errorBody);
    throw new Error(`Kunne ikke generere signeret URL (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  console.log('Signed URL response keys:', Object.keys(data));
  
  const signedPath = data.signedURL || data.signedUrl;
  
  if (!signedPath) {
    throw new Error('Signed URL mangler i respons: ' + JSON.stringify(data));
  }
  
  return `${supabaseUrl}/storage/v1${signedPath.startsWith('/') ? signedPath : '/' + signedPath}`;
}

// =====================================================
// Supabase REST - opdater faktura
// =====================================================

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}
