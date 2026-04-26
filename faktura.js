// =====================================================
// faktura.js - Detaljesidens logik
// Viser PDF/billede + ekstraherede felter
// =====================================================

// Init Supabase klient (bruger 'db' for at undgå navnekonflikt med window.supabase)
const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

// DOM
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorTextEl = document.getElementById('error-text');
const contentEl = document.getElementById('content');
const fileViewerContainer = document.getElementById('file-viewer-container');
const felterContent = document.getElementById('felter-content');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');

// Hent ID fra URL
const urlParams = new URLSearchParams(window.location.search);
const fakturaId = urlParams.get('id');

if (!fakturaId) {
  showError('Ingen faktura-ID i URL');
} else {
  loadFaktura();
}

// =====================================================
// Indlæs faktura
// =====================================================

async function loadFaktura() {
  try {
    // Hent faktura fra DB
    const { data: faktura, error } = await db
      .from('fakturaer')
      .select('*')
      .eq('id', fakturaId)
      .single();
    
    if (error) throw error;
    if (!faktura) throw new Error('Faktura ikke fundet');
    
    // Hent signeret URL til filen
    const { data: urlData, error: urlError } = await db.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(faktura.fil_sti, 3600); // 1 time
    
    if (urlError) throw urlError;
    
    // Render
    renderFaktura(faktura, urlData.signedUrl);
    
    // Hvis status er 'extracting', poll for opdateringer
    if (faktura.status === 'extracting') {
      pollForUpdates();
    }
    
  } catch (error) {
    console.error('Fejl:', error);
    showError(error.message);
  }
}

// =====================================================
// Render
// =====================================================

function renderFaktura(faktura, fileUrl) {
  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
  
  // Header
  const titel = faktura.leverandoer_navn || faktura.fil_navn || 'Faktura';
  pageTitle.textContent = `📄 ${titel}`;
  
  const status = {
    'uploaded': 'Uploadet, venter på AI',
    'extracting': '🤖 AI læser fakturaen...',
    'extracted': 'Læst af AI',
    'extraction_failed': '❌ AI-læsning fejlede'
  }[faktura.status] || faktura.status;
  pageSubtitle.textContent = status;
  
  // Status-banner ved fejl
  if (faktura.status === 'extraction_failed') {
    errorEl.classList.remove('hidden');
    errorTextEl.textContent = faktura.status_besked || 'AI kunne ikke læse fakturaen';
  } else if (faktura.status === 'extracting') {
    showProcessingBanner();
  }
  
  // PDF eller billede
  renderFile(faktura, fileUrl);
  
  // Felter
  renderFelter(faktura);
}

function renderFile(faktura, fileUrl) {
  if (faktura.fil_type === 'application/pdf') {
    fileViewerContainer.innerHTML = `
      <iframe src="${fileUrl}" class="pdf-viewer" title="Faktura PDF"></iframe>
    `;
  } else {
    fileViewerContainer.innerHTML = `
      <img src="${fileUrl}" alt="Faktura" class="image-viewer">
    `;
  }
}

function renderFelter(faktura) {
  const konfidens = faktura.llm_konfidensscore;
  let konfidensBadge = '';
  if (konfidens !== null && konfidens !== undefined) {
    const klasse = konfidens >= 0.8 ? 'konfidens-hoj' : konfidens >= 0.5 ? 'konfidens-medium' : 'konfidens-lav';
    konfidensBadge = `<span class="konfidens-badge ${klasse}">Konfidens: ${Math.round(konfidens * 100)}%</span>`;
  }
  
  felterContent.innerHTML = `
    ${konfidensBadge ? `<div style="margin-bottom: 16px;">${konfidensBadge}</div>` : ''}
    
    <div class="felt-gruppe">
      <div class="felt-gruppe-titel">Leverandør</div>
      ${felt('Navn', faktura.leverandoer_navn)}
      ${felt('CVR', faktura.leverandoer_cvr)}
      ${felt('Adresse', faktura.leverandoer_adresse)}
    </div>
    
    <div class="felt-gruppe">
      <div class="felt-gruppe-titel">Faktura</div>
      ${felt('Fakturanummer', faktura.fakturanummer)}
      ${felt('Fakturadato', formatDato(faktura.fakturadato))}
      ${felt('Forfaldsdato', formatDato(faktura.forfaldsdato))}
    </div>
    
    <div class="felt-gruppe">
      <div class="felt-gruppe-titel">Beløb</div>
      ${felt('Beløb ekskl. moms', formatBelob(faktura.belob_eksk_moms, faktura.valuta))}
      ${felt('Moms (' + (faktura.momssats !== null ? faktura.momssats + '%' : '?') + ')', formatBelob(faktura.momsbelob, faktura.valuta))}
      ${felt('Beløb inkl. moms', formatBelob(faktura.belob_inkl_moms, faktura.valuta))}
      ${felt('Valuta', faktura.valuta)}
    </div>
    
    <div class="felt-gruppe">
      <div class="felt-gruppe-titel">Betalingsoplysninger</div>
      ${faktura.betalingskonto_iban 
        ? felt('IBAN', faktura.betalingskonto_iban) + felt('BIC', faktura.betalingskonto_bic)
        : felt('Reg.nr', faktura.betalingskonto_regnr) + felt('Kontonr', faktura.betalingskonto_kontonr)
      }
      ${felt('Betalingsreference', faktura.betalingsreference)}
    </div>
    
    <div class="felt-gruppe">
      <div class="felt-gruppe-titel">Fil-info</div>
      ${felt('Filnavn', faktura.fil_navn)}
      ${felt('Uploadet', formatDatoTid(faktura.oprettet_dato))}
    </div>
  `;
}

function felt(label, vaerdi) {
  const visning = vaerdi !== null && vaerdi !== undefined && vaerdi !== ''
    ? `<span class="felt-vaerdi">${escapeHtml(String(vaerdi))}</span>`
    : `<span class="felt-vaerdi tom">–</span>`;
  
  return `
    <div class="felt">
      <span class="felt-label">${label}</span>
      ${visning}
    </div>
  `;
}

function showProcessingBanner() {
  errorEl.className = 'status-banner processing';
  errorEl.classList.remove('hidden');
  errorTextEl.textContent = 'AI læser fakturaen, dette tager normalt 5-15 sekunder...';
}

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorTextEl.textContent = message;
}

// =====================================================
// Polling for updates (når status er 'extracting')
// =====================================================

let pollCount = 0;
const MAX_POLLS = 30; // 30 * 2 sek = 1 minut max

async function pollForUpdates() {
  if (pollCount >= MAX_POLLS) return;
  pollCount++;
  
  await new Promise(r => setTimeout(r, 2000));
  
  try {
    const { data, error } = await db
      .from('fakturaer')
      .select('status')
      .eq('id', fakturaId)
      .single();
    
    if (error) return;
    
    if (data.status !== 'extracting') {
      // Status har ændret sig - genindlæs siden
      window.location.reload();
    } else {
      pollForUpdates();
    }
  } catch (e) {
    console.error('Polling fejl:', e);
  }
}

// =====================================================
// Hjælpefunktioner
// =====================================================

function formatBelob(belob, valuta) {
  if (belob === null || belob === undefined) return null;
  return new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(belob) + (valuta ? ' ' + valuta : '');
}

function formatDato(dato) {
  if (!dato) return null;
  return new Date(dato).toLocaleDateString('da-DK');
}

function formatDatoTid(dato) {
  if (!dato) return null;
  return new Date(dato).toLocaleString('da-DK');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
