// =====================================================
// faktura.js - Detaljesidens logik (Bogholder-side)
// Indeholder workflow-handlinger: Send til godkendelse, Frigiv til bogføring
// =====================================================

// Tjek bruger - omdiriger Godkender til godkend.html
const aktuelBruger = hentAktuelBruger();
if (aktuelBruger.rolle === 'Godkender') {
  window.location.href = 'godkend.html';
}

renderBrugerVaelger('bruger-vaelger-container');

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

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
const workflowBanner = document.getElementById('workflow-banner');

let currentFaktura = null;
let pollCount = 0;
const MAX_POLLS = 30;

const FELTER_BILAG = [
  { gruppe: 'Bogføring', felt: 'bogforingsbeskrivelse', label: 'Beskrivelse', type: 'text', maxlength: 30 },
  { gruppe: 'Bogføring', felt: 'bogforingskonto', label: 'Konto', type: 'text', maxlength: 20 },
  { gruppe: 'Faktura', felt: 'fakturanummer', label: 'Fakturanummer', type: 'text' },
  { gruppe: 'Faktura', felt: 'fakturadato', label: 'Fakturadato', type: 'date' },
  { gruppe: 'Faktura', felt: 'forfaldsdato', label: 'Forfaldsdato', type: 'date' },
  { gruppe: 'Beløb', felt: 'belob_eksk_moms', label: 'Beløb ekskl. moms', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'momsbelob', label: 'Momsbeløb', type: 'number', step: '0.01' },
  { gruppe: 'Beløb', felt: 'belob_inkl_moms', label: 'Beløb inkl. moms', type: 'number', step: '0.01' },
  { gruppe: 'Reference', felt: 'betalingsreference', label: 'Betalingsreference', type: 'text' }
];

const FELTER_LEVERANDOR = [
  { gruppe: 'Identifikation', felt: 'leverandoer_navn', label: 'Navn', type: 'text' },
  { gruppe: 'Identifikation', felt: 'leverandoer_cvr', label: 'CVR', type: 'text', maxlength: 8 },
  { gruppe: 'Identifikation', felt: 'leverandoer_adresse', label: 'Adresse', type: 'textarea' },
  { gruppe: 'Bankoplysninger', felt: 'betalingskonto_iban', label: 'IBAN', type: 'text' },
  { gruppe: 'Bankoplysninger', felt: 'betalingskonto_bic', label: 'BIC', type: 'text' },
  { gruppe: 'Bankoplysninger', felt: 'betalingskonto_regnr', label: 'Reg.nr', type: 'text', maxlength: 4 },
  { gruppe: 'Bankoplysninger', felt: 'betalingskonto_kontonr', label: 'Kontonr', type: 'text' },
  { gruppe: 'Standard', felt: 'valuta', label: 'Valuta', type: 'text', maxlength: 3 },
  { gruppe: 'Standard', felt: 'momssats', label: 'Momssats (%)', type: 'number', step: '0.01' }
];

const ALLE_FELTER = [...FELTER_BILAG, ...FELTER_LEVERANDOR];

const urlParams = new URLSearchParams(window.location.search);
const fakturaId = urlParams.get('id');

if (!fakturaId) {
  showError('Ingen faktura-ID i URL');
} else {
  loadFaktura();
}

// =====================================================
// Indlæsning
// =====================================================

async function loadFaktura() {
  try {
    const { data: faktura, error } = await db
      .from('fakturaer').select('*').eq('id', fakturaId).single();
    
    if (error) throw error;
    if (!faktura) throw new Error('Faktura ikke fundet');
    
    currentFaktura = faktura;
    
    const { data: urlData, error: urlError } = await db.storage
      .from(SUPABASE_BUCKET).createSignedUrl(faktura.fil_sti, 3600);
    if (urlError) throw urlError;
    
    renderFaktura(faktura, urlData.signedUrl);
    
    if (faktura.status === 'extracting') pollForUpdates();
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
  
  const titel = faktura.leverandoer_navn || faktura.fil_navn || 'Faktura';
  pageTitle.textContent = titel;
  
  const status = {
    'uploaded': 'Uploadet, venter på AI',
    'extracting': '🤖 AI læser fakturaen...',
    'extracted': 'Klar til afsendelse',
    'extraction_failed': '❌ AI-læsning fejlede',
    'afventer_godkendelse': 'Afventer godkendelse',
    'godkendt': 'Godkendt – klar til frigivelse',
    'afvist': 'Afvist – skal rettes',
    'frigivet_til_bogforing': 'Frigivet til bogføring'
  }[faktura.status] || faktura.status;
  pageSubtitle.textContent = status;
  
  if (faktura.status === 'extraction_failed') {
    errorEl.classList.remove('hidden');
    errorEl.className = 'status-banner error';
    errorTextEl.textContent = faktura.status_besked || 'AI kunne ikke læse fakturaen';
  } else if (faktura.status === 'extracting') {
    showProcessingBanner();
  }
  
  renderWorkflowBanner(faktura);
  renderKonfidens(faktura.llm_konfidensscore);
  renderFile(faktura, fileUrl);
  renderFelter(faktura);
  
  // Lås redigering hvis status ikke er 'extracted'
  const kanRedigere = faktura.status === 'extracted';
  saveBtn.style.display = kanRedigere ? '' : 'none';
  cancelBtn.style.display = kanRedigere ? '' : 'none';
  document.querySelector('.felter-actions span').style.display = kanRedigere ? '' : 'none';
  
  if (!kanRedigere) {
    felterForm.querySelectorAll('input, textarea').forEach(el => {
      el.setAttribute('readonly', 'readonly');
      el.style.background = 'var(--bi-bg-page)';
    });
  }
}

// =====================================================
// Workflow-banner med handling-knapper
// =====================================================

function renderWorkflowBanner(faktura) {
  workflowBanner.className = '';
  workflowBanner.classList.add('hidden');
  
  const erBogholder = aktuelBruger.rolle === 'Bogholder';
  
  // Status: extracted → kan sende til godkendelse
  if (faktura.status === 'extracted' && erBogholder) {
    workflowBanner.className = 'workflow-banner afventer';
    workflowBanner.innerHTML = `
      <div class="workflow-banner-text">
        <strong>Klar til godkendelse</strong>
        <span>Tjek felterne og send til godkender når du er klar</span>
      </div>
      <div class="workflow-banner-actions">
        <button type="button" class="btn btn-primary" id="send-til-godkendelse-btn">
          Send til godkendelse →
        </button>
      </div>
    `;
    document.getElementById('send-til-godkendelse-btn').addEventListener('click', sendTilGodkendelse);
  }
  
  // Status: afventer_godkendelse
  if (faktura.status === 'afventer_godkendelse') {
    const dato = formatDatoTid(faktura.sendt_til_godkendelse_dato);
    workflowBanner.className = 'workflow-banner afventer';
    workflowBanner.innerHTML = `
      <div class="workflow-banner-text">
        <strong>⏳ Afventer godkendelse</strong>
        <span>Sendt af ${escapeHtml(faktura.sendt_til_godkendelse_af || '?')} ${dato || ''}</span>
      </div>
    `;
  }
  
  // Status: afvist
  if (faktura.status === 'afvist') {
    const dato = formatDatoTid(faktura.afvist_dato);
    workflowBanner.className = 'workflow-banner afvist';
    workflowBanner.innerHTML = `
      <div class="workflow-banner-text">
        <strong>❌ Afvist af ${escapeHtml(faktura.afvist_af || '?')} ${dato || ''}</strong>
        <span>Kommentar: ${escapeHtml(faktura.afvisningskommentar || '(ingen)')}</span>
      </div>
      ${erBogholder ? `
        <div class="workflow-banner-actions">
          <button type="button" class="btn btn-primary" id="genaabne-btn">
            Genåbn til redigering
          </button>
        </div>
      ` : ''}
    `;
    if (erBogholder) {
      document.getElementById('genaabne-btn').addEventListener('click', genaabneTilRedigering);
    }
  }
  
  // Status: godkendt → kan frigives
  if (faktura.status === 'godkendt') {
    const dato = formatDatoTid(faktura.godkendt_dato);
    workflowBanner.className = 'workflow-banner godkendt';
    workflowBanner.innerHTML = `
      <div class="workflow-banner-text">
        <strong>✓ Godkendt af ${escapeHtml(faktura.godkendt_af || '?')} ${dato || ''}</strong>
        <span>Klar til frigivelse til bogføring</span>
      </div>
      ${erBogholder ? `
        <div class="workflow-banner-actions">
          <button type="button" class="btn btn-primary" id="frigiv-btn">
            Frigiv til bogføring →
          </button>
        </div>
      ` : ''}
    `;
    if (erBogholder) {
      document.getElementById('frigiv-btn').addEventListener('click', frigivTilBogforing);
    }
  }
  
  // Status: frigivet
  if (faktura.status === 'frigivet_til_bogforing') {
    const dato = formatDatoTid(faktura.frigivet_dato);
    workflowBanner.className = 'workflow-banner frigivet';
    workflowBanner.innerHTML = `
      <div class="workflow-banner-text">
        <strong>📦 Frigivet til bogføring</strong>
        <span>Frigivet af ${escapeHtml(faktura.frigivet_af || '?')} ${dato || ''}</span>
      </div>
    `;
  }
}

// =====================================================
// Workflow-handlinger
// =====================================================

async function sendTilGodkendelse() {
  if (!confirm('Send fakturaen til godkendelse hos Nikoline?')) return;
  
  try {
    const { error } = await db.from('fakturaer').update({
      status: 'afventer_godkendelse',
      sendt_til_godkendelse_af: aktuelBruger.navn,
      sendt_til_godkendelse_dato: new Date().toISOString(),
      // Ryd evt. tidligere afvisningsdata
      afvist_af: null,
      afvist_dato: null,
      afvisningskommentar: null
    }).eq('id', fakturaId);
    
    if (error) throw error;
    
    await db.from('godkendelse_historik').insert({
      faktura_id: fakturaId,
      handling: 'sendt_til_godkendelse',
      bruger_navn: aktuelBruger.navn,
      bruger_rolle: aktuelBruger.rolle
    });
    
    window.location.reload();
  } catch (error) {
    alert('Fejl: ' + error.message);
  }
}

async function frigivTilBogforing() {
  if (!confirm('Frigiv fakturaen til bogføring?')) return;
  
  try {
    const { error } = await db.from('fakturaer').update({
      status: 'frigivet_til_bogforing',
      frigivet_af: aktuelBruger.navn,
      frigivet_dato: new Date().toISOString()
    }).eq('id', fakturaId);
    
    if (error) throw error;
    
    await db.from('godkendelse_historik').insert({
      faktura_id: fakturaId,
      handling: 'frigivet',
      bruger_navn: aktuelBruger.navn,
      bruger_rolle: aktuelBruger.rolle
    });
    
    window.location.reload();
  } catch (error) {
    alert('Fejl: ' + error.message);
  }
}

async function genaabneTilRedigering() {
  if (!confirm('Genåbne fakturaen til redigering? Du kan derefter rette og sende til godkendelse igen.')) return;
  
  try {
    const { error } = await db.from('fakturaer').update({
      status: 'extracted'
    }).eq('id', fakturaId);
    
    if (error) throw error;
    window.location.reload();
  } catch (error) {
    alert('Fejl: ' + error.message);
  }
}

// =====================================================
// Render felter (uændret fra før)
// =====================================================

function renderFile(faktura, fileUrl) {
  if (faktura.fil_type === 'application/pdf') {
    fileViewerContainer.innerHTML = `<iframe src="${fileUrl}" class="pdf-viewer" title="Faktura PDF"></iframe>`;
  } else {
    fileViewerContainer.innerHTML = `<img src="${fileUrl}" alt="Faktura" class="image-viewer">`;
  }
}

function renderKonfidens(score) {
  if (score === null || score === undefined) {
    konfidensContainer.innerHTML = '';
    return;
  }
  const klasse = score >= 0.8 ? 'konfidens-hoj' : score >= 0.5 ? 'konfidens-medium' : 'konfidens-lav';
  konfidensContainer.innerHTML = `<span class="konfidens-badge ${klasse}">AI-konfidens: ${Math.round(score * 100)}%</span>`;
}

function renderFelter(faktura) {
  let html = '';
  
  html += `
    <div class="felt-sektion bilag">
      <div class="felt-sektion-header">
        <div class="felt-sektion-titel"><span class="ikon">📋</span> Bilagsspecifikt</div>
        <span class="felt-sektion-tag">Per faktura</span>
      </div>
      ${renderFeltGruppe(FELTER_BILAG, faktura)}
    </div>
  `;
  
  html += `
    <div class="felt-sektion leverandor">
      <div class="felt-sektion-header">
        <div class="felt-sektion-titel"><span class="ikon">🏢</span> Leverandørdata</div>
        <span class="felt-sektion-tag">Kandidat til skabelon</span>
      </div>
      ${renderFeltGruppe(FELTER_LEVERANDOR, faktura)}
    </div>
  `;
  
  html += `
    <div class="felt-sektion">
      <div class="felt-sektion-header">
        <div class="felt-sektion-titel"><span class="ikon">📎</span> Fil</div>
      </div>
      ${renderReadonlyFelt('Filnavn', faktura.fil_navn)}
      ${renderReadonlyFelt('Uploadet', formatDatoTid(faktura.oprettet_dato))}
    </div>
  `;
  
  felterForm.innerHTML = html;
  
  felterForm.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', handleFieldChange);
  });
  
  updateChangesUI();
}

function renderFeltGruppe(felter, faktura) {
  const grupper = {};
  felter.forEach(def => {
    if (!grupper[def.gruppe]) grupper[def.gruppe] = [];
    grupper[def.gruppe].push(def);
  });
  
  let html = '';
  Object.keys(grupper).forEach(gruppeNavn => {
    html += `<div class="felt-gruppe"><div class="felt-gruppe-titel">${gruppeNavn}</div>`;
    grupper[gruppeNavn].forEach(def => {
      html += renderFeltInput(def, faktura[def.felt]);
    });
    html += `</div>`;
  });
  return html;
}

function renderFeltInput(def, vaerdi) {
  const v = vaerdi !== null && vaerdi !== undefined ? String(vaerdi) : '';
  const id = `felt-${def.felt}`;
  const attrs = [`id="${id}"`, `name="${def.felt}"`, `data-original="${escapeAttr(v)}"`, `class="felt-input"`];
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
  
  return `<div class="felt-rk"><label class="felt-label" for="${id}">${def.label}</label>${inputHtml}</div>`;
}

function renderReadonlyFelt(label, vaerdi) {
  const v = vaerdi !== null && vaerdi !== undefined ? String(vaerdi) : '–';
  return `<div class="felt-rk"><span class="felt-label">${label}</span><input type="text" class="felt-input" value="${escapeAttr(v)}" readonly></div>`;
}

// =====================================================
// Ændringshåndtering og gem
// =====================================================

function handleFieldChange(e) {
  const input = e.target;
  const original = input.dataset.original || '';
  if (input.value !== original) {
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
    if (input.value !== original) aendringer[input.name] = input.value;
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

saveBtn.addEventListener('click', async () => {
  const aendringer = getAendringer();
  if (Object.keys(aendringer).length === 0) return;
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Gemmer...';
  
  try {
    const dbUpdates = {};
    for (const [navn, vaerdi] of Object.entries(aendringer)) {
      dbUpdates[navn] = konverterTilDbVaerdi(navn, vaerdi);
    }
    
    const { data, error } = await db.from('fakturaer')
      .update(dbUpdates).eq('id', fakturaId).select().single();
    
    if (error) throw error;
    currentFaktura = data;
    
    felterForm.querySelectorAll('input[name], textarea[name]').forEach(input => {
      const ny = data[input.name];
      const nyStr = ny !== null && ny !== undefined ? String(ny) : '';
      input.dataset.original = nyStr;
      input.value = nyStr;
      input.classList.remove('changed');
    });
    
    changesIndicator.textContent = '✓ Gemt';
    changesIndicator.className = 'changes-indicator saved';
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    
    if (data.leverandoer_navn) pageTitle.textContent = data.leverandoer_navn;
    
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

cancelBtn.addEventListener('click', () => {
  felterForm.querySelectorAll('input[name], textarea[name]').forEach(input => {
    input.value = input.dataset.original || '';
    input.classList.remove('changed');
  });
  updateChangesUI();
});

// =====================================================
// Status, polling og hjælpefunktioner
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
    const { data, error } = await db.from('fakturaer')
      .select('status').eq('id', fakturaId).single();
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

function konverterTilDbVaerdi(felt, raVaerdi) {
  const def = ALLE_FELTER.find(f => f.felt === felt);
  if (!def) return raVaerdi || null;
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
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
