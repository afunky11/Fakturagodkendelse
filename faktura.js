// =====================================================
// faktura.js - Detaljesidens logik
// Viser PDF/billede + redigerbare felter med gem-knap
// =====================================================

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
const felterForm = document.getElementById('felter-form');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const konfidensContainer = document.getElementById('konfidens-container');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const changesIndicator = document.getElementById('changes-indicator');

// State
let currentFaktura = null;       // sidste indlæste/gemte version
let pollCount = 0;
const MAX_POLLS = 30;

// Felt-definitioner: hvilke der vises, hvordan
const FELTER = [
  // Gruppe: Leverandør
  { gruppe: 'Leverandør', felt: 'leverandoer_navn', label: 'Navn', type: 'text' },
  { gruppe: 'Leverandør', felt: 'leverandoer_cvr', label: 'CVR', type: 'text', maxlength: 8 },
  { gruppe: 'Leverandør', felt: 'leverandoer_adresse', label: 'Adresse', type: 'textarea' },
  
  // Gruppe: Faktura
  { gruppe: 'Faktura', felt: 'fakturanummer', label: 'Fakturanummer', type: 'text' },
  { gruppe: 'Faktura', felt: 'fakturadato', label: 'Fakturadato', type: 'date' },
  { gruppe: 'Faktura', felt: 'forfaldsdato', label: 'Forfaldsdato', type: 'date' },
  
  // Gruppe: Beløb
  { gruppe: 'Beløb', felt: 'belob_eksk_moms', label: 'Beløb ekskl. moms', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'momssats', label: 'Momssats (%)', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'momsbelob', label: 'Momsbeløb', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'belob_inkl_moms', label: 'Beløb inkl. moms', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'valuta', label: 'Valuta', type: 'text', maxlength: 3 },
  
  // Gruppe: Betalingsoplysninger
  { gruppe: 'Betalingsoplysninger', felt: 'betalingskonto_iban', label: 'IBAN', type: 'text' },
  { gruppe: 'Betalingsoplysninger', felt: 'betalingskonto_bic', label: 'BIC', type: 'text' },
  { gruppe: 'Betalingsoplysninger', felt: 'betalingskonto_regnr', label: 'Reg.nr', type: 'text', maxlength: 4 },
  { gruppe: 'Betalingsoplysninger', felt: 'betalingskonto_kontonr', label: 'Kontonr', type: 'text' },
  { gruppe: 'Betalingsoplysninger', felt: 'betalingsreference', label: 'Reference', type: 'text' }
];

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
    const { data: faktura, error } = await db
      .from('fakturaer')
      .select('*')
      .eq('id', fakturaId)
      .single();
    
    if (error) throw error;
    if (!faktura) throw new Error('Faktura ikke fundet');
    
    currentFaktura = faktura;
    
    const { data: urlData, error: urlError } = await db.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(faktura.fil_sti, 3600);
    
    if (urlError) throw urlError;
    
    renderFaktura(faktura, urlData.signedUrl);
    
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
  pageTitle.textContent = titel;
  
  const status = {
    'uploaded': 'Uploadet, venter på AI',
    'extracting': '🤖 AI læser fakturaen...',
    'extracted': 'Læst af AI – klar til godkendelse',
    'extraction_failed': '❌ AI-læsning fejlede'
  }[faktura.status] || faktura.status;
  pageSubtitle.textContent = status;
  
  // Status-banner
  if (faktura.status === 'extraction_failed') {
    errorEl.classList.remove('hidden');
    errorEl.className = 'status-banner error';
    errorTextEl.textContent = faktura.status_besked || 'AI kunne ikke læse fakturaen';
  } else if (faktura.status === 'extracting') {
    showProcessingBanner();
  }
  
  // Konfidens-badge
  renderKonfidens(faktura.llm_konfidensscore);
  
  // PDF/billede
  renderFile(faktura, fileUrl);
  
  // Felter (formular)
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

function renderKonfidens(score) {
  if (score === null || score === undefined) {
    konfidensContainer.innerHTML = '';
    return;
  }
  const klasse = score >= 0.8 ? 'konfidens-hoj' : score >= 0.5 ? 'konfidens-medium' : 'konfidens-lav';
  const tekst = `AI-konfidens: ${Math.round(score * 100)}%`;
  konfidensContainer.innerHTML = `<span class="konfidens-badge ${klasse}">${tekst}</span>`;
}

function renderFelter(faktura) {
  // Group felter by gruppe
  const grupper = {};
  FELTER.forEach(def => {
    if (!grupper[def.gruppe]) grupper[def.gruppe] = [];
    grupper[def.gruppe].push(def);
  });
  
  let html = '';
  Object.keys(grupper).forEach(gruppeNavn => {
    html += `<div class="felt-gruppe">`;
    html += `<div class="felt-gruppe-titel">${gruppeNavn}</div>`;
    
    grupper[gruppeNavn].forEach(def => {
      html += renderFeltInput(def, faktura[def.felt]);
    });
    
    html += `</div>`;
  });
  
  // Fil-info som ekstra read-only sektion
  html += `<div class="felt-gruppe">`;
  html += `<div class="felt-gruppe-titel">Fil</div>`;
  html += renderReadonlyFelt('Filnavn', faktura.fil_navn);
  html += renderReadonlyFelt('Uploadet', formatDatoTid(faktura.oprettet_dato));
  html += `</div>`;
  
  felterForm.innerHTML = html;
  
  // Bind change-listeners til alle inputs
  felterForm.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', handleFieldChange);
  });
  
  updateChangesUI();
}

function renderFeltInput(def, vaerdi) {
  const v = vaerdi !== null && vaerdi !== undefined ? String(vaerdi) : '';
  const id = `felt-${def.felt}`;
  const attrs = [
    `id="${id}"`,
    `name="${def.felt}"`,
    `data-original="${escapeAttr(v)}"`,
    `class="felt-input"`
  ];
  
  if (def.maxlength) attrs.push(`maxlength="${def.maxlength}"`);
  if (def.step) attrs.push(`step="${def.step}"`);
  
  let inputHtml;
  if (def.type === 'textarea') {
    inputHtml = `<textarea ${attrs.join(' ')} rows="2">${escapeHtml(v)}</textarea>`;
  } else {
    attrs.push(`type="${def.type}"`);
    attrs.push(`value="${escapeAttr(v)}"`);
    inputHtml = `<input ${attrs.join(' ')}>`;
  }
  
  return `
    <div class="felt-rk">
      <label class="felt-label" for="${id}">${def.label}</label>
      ${inputHtml}
    </div>
  `;
}

function renderReadonlyFelt(label, vaerdi) {
  const v = vaerdi !== null && vaerdi !== undefined ? String(vaerdi) : '–';
  return `
    <div class="felt-rk">
      <span class="felt-label">${label}</span>
      <input type="text" class="felt-input" value="${escapeAttr(v)}" readonly>
    </div>
  `;
}

// =====================================================
// Ændringshåndtering
// =====================================================

function handleFieldChange(e) {
  const input = e.target;
  const original = input.dataset.original || '';
  const current = input.value;
  
  if (current !== original) {
    input.classList.add('changed');
  } else {
    input.classList.remove('changed');
  }
  
  updateChangesUI();
}

function getAendringer() {
  const aendringer = {};
  felterForm.querySelectorAll('input[name], textarea[name]').forEach(input => {
    const original = input.dataset.original || '';
    const current = input.value;
    if (current !== original) {
      aendringer[input.name] = current;
    }
  });
  return aendringer;
}

function updateChangesUI() {
  const aendringer = getAendringer();
  const antal = Object.keys(aendringer).length;
  
  if (antal === 0) {
    changesIndicator.textContent = 'Ingen ændringer';
    changesIndicator.className = 'changes-indicator none';
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
  } else {
    changesIndicator.textContent = `${antal} ${antal === 1 ? 'ændring' : 'ændringer'} ikke gemt`;
    changesIndicator.className = 'changes-indicator';
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

// =====================================================
// Gem-knap
// =====================================================

saveBtn.addEventListener('click', async () => {
  const aendringer = getAendringer();
  if (Object.keys(aendringer).length === 0) return;
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Gemmer...';
  
  try {
    // Konvertér felter til rette typer
    const dbUpdates = {};
    for (const [navn, vaerdi] of Object.entries(aendringer)) {
      dbUpdates[navn] = konverterTilDbVaerdi(navn, vaerdi);
    }
    
    const { data, error } = await db
      .from('fakturaer')
      .update(dbUpdates)
      .eq('id', fakturaId)
      .select()
      .single();
    
    if (error) throw error;
    
    currentFaktura = data;
    
    // Opdater data-original på alle inputs så de matcher de gemte værdier
    felterForm.querySelectorAll('input[name], textarea[name]').forEach(input => {
      const navn = input.name;
      const ny = data[navn];
      const nyStr = ny !== null && ny !== undefined ? String(ny) : '';
      input.dataset.original = nyStr;
      input.value = nyStr;
      input.classList.remove('changed');
    });
    
    // Vis succes
    changesIndicator.textContent = '✓ Gemt';
    changesIndicator.className = 'changes-indicator saved';
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    
    // Opdater header hvis leverandørnavn ændret
    if (data.leverandoer_navn) {
      pageTitle.textContent = data.leverandoer_navn;
    }
    
    // Tilbagestil tekst på knap efter et øjeblik
    setTimeout(() => {
      changesIndicator.textContent = 'Ingen ændringer';
      changesIndicator.className = 'changes-indicator none';
    }, 3000);
    
  } catch (error) {
    console.error('Gem-fejl:', error);
    alert('Kunne ikke gemme: ' + error.message);
  } finally {
    saveBtn.textContent = 'Gem ændringer';
    updateChangesUI();
  }
});

// =====================================================
// Fortryd-knap
// =====================================================

cancelBtn.addEventListener('click', () => {
  felterForm.querySelectorAll('input[name], textarea[name]').forEach(input => {
    input.value = input.dataset.original || '';
    input.classList.remove('changed');
  });
  updateChangesUI();
});

// =====================================================
// Status-banners og polling
// =====================================================

function showProcessingBanner() {
  errorEl.className = 'status-banner processing';
  errorEl.classList.remove('hidden');
  errorTextEl.textContent = 'AI læser fakturaen, dette tager normalt 5-15 sekunder...';
}

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  errorEl.className = 'status-banner error';
  errorTextEl.textContent = message;
}

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

function konverterTilDbVaerdi(felt, raVaerdi) {
  const def = FELTER.find(f => f.felt === felt);
  if (!def) return raVaerdi || null;
  
  // Tom streng → null
  if (raVaerdi === '' || raVaerdi === null || raVaerdi === undefined) return null;
  
  if (def.type === 'number') {
    const num = parseFloat(String(raVaerdi).replace(',', '.'));
    return isNaN(num) ? null : num;
  }
  
  if (def.type === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(raVaerdi) ? raVaerdi : null;
  }
  
  return String(raVaerdi).trim();
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

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
