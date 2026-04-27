
// =====================================================
// app.js - Forsidens logik (Bogholder-side)
// =====================================================

// Tjek bruger - omdiriger Godkender til godkend.html
const bruger = hentAktuelBruger();
if (bruger.rolle === 'Godkender') {
  window.location.href = 'godkend.html';
}

// Render bruger-vælger
renderBrugerVaelger('bruger-vaelger-container');

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const BRIDGE_BUCKET = 'faktura-bridge';

// DOM-elementer
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const statusText = document.getElementById('status-text');
const fakturaList = document.getElementById('faktura-list');
const refreshBtn = document.getElementById('refresh-btn');

const qrBtn = document.getElementById('qr-btn');
const qrModal = document.getElementById('qr-modal');
const modalClose = document.getElementById('modal-close');
const modalOverlay = document.getElementById('modal-overlay');
const qrContainer = document.getElementById('qr-container');
const qrStatus = document.getElementById('qr-status');
const qrUrlFallback = document.getElementById('qr-url-fallback');

let qrPollingInterval = null;
let currentSessionToken = null;

// =====================================================
// Upload event listeners
// =====================================================

dropzone.addEventListener('click', (e) => {
  if (e.target.closest('label') || e.target.closest('button')) return;
  fileInput.click();
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

refreshBtn.addEventListener('click', loadFakturaer);

qrBtn.addEventListener('click', openQrModal);
modalClose.addEventListener('click', closeQrModal);
modalOverlay.addEventListener('click', closeQrModal);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !qrModal.classList.contains('hidden')) closeQrModal();
});

// =====================================================
// QR-bridging (uændret)
// =====================================================

function openQrModal() {
  currentSessionToken = generateSessionToken();
  const baseUrl = window.location.origin;
  const uploadUrl = `${baseUrl}/upload.html?session=${currentSessionToken}`;
  
  qrModal.classList.remove('hidden');
  qrContainer.innerHTML = '';
  new QRCode(qrContainer, {
    text: uploadUrl,
    width: 240,
    height: 240,
    colorDark: '#042f4e',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  qrUrlFallback.textContent = uploadUrl;
  qrStatus.classList.remove('received');
  qrStatus.querySelector('span').textContent = 'Venter på fil fra telefon...';
  startPolling();
}

function closeQrModal() {
  qrModal.classList.add('hidden');
  stopPolling();
  currentSessionToken = null;
}

function startPolling() {
  stopPolling();
  qrPollingInterval = setInterval(async () => {
    if (!currentSessionToken) return;
    try {
      const { data, error } = await db.storage.from(BRIDGE_BUCKET).list('', {
        search: currentSessionToken
      });
      if (error) return;
      if (data && data.length > 0) {
        const fundetFil = data.find(f => f.name.startsWith(currentSessionToken + '.'));
        if (fundetFil) await handleBridgeFile(fundetFil);
      }
    } catch (e) {
      console.error('Polling-fejl:', e);
    }
  }, 2000);
}

function stopPolling() {
  if (qrPollingInterval) {
    clearInterval(qrPollingInterval);
    qrPollingInterval = null;
  }
}

async function handleBridgeFile(fundetFil) {
  stopPolling();
  qrStatus.classList.add('received');
  qrStatus.querySelector('span').textContent = '✓ Fil modtaget – behandler...';
  
  try {
    const { data: blob, error: downloadError } = await db.storage
      .from(BRIDGE_BUCKET).download(fundetFil.name);
    if (downloadError) throw downloadError;
    
    const fileExt = fundetFil.name.split('.').pop().toLowerCase();
    const mimeType = getMimeTypeFromExt(fileExt);
    const file = new File([blob], `mobil-upload.${fileExt}`, { type: mimeType });
    
    await db.storage.from(BRIDGE_BUCKET).remove([fundetFil.name]);
    closeQrModal();
    await handleFile(file);
  } catch (error) {
    console.error('Bridge-fejl:', error);
    qrStatus.classList.remove('received');
    qrStatus.querySelector('span').textContent = 'Fejl: ' + error.message;
    setTimeout(() => {
      if (!qrModal.classList.contains('hidden')) {
        qrStatus.querySelector('span').textContent = 'Venter på fil fra telefon...';
        startPolling();
      }
    }, 3000);
  }
}

function generateSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getMimeTypeFromExt(ext) {
  const map = {
    'pdf': 'application/pdf', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png', 'heic': 'image/heic', 'heif': 'image/heif'
  };
  return map[ext] || 'application/octet-stream';
}

// =====================================================
// Filhåndtering
// =====================================================

async function handleFile(file) {
  const maxSize = 25 * 1024 * 1024;
  
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    alert('Ugyldig filtype. Brug PDF, JPG eller PNG.');
    return;
  }
  
  if (file.size > maxSize) {
    alert('Filen er for stor (max 25 MB).');
    return;
  }
  
  showStatus('Uploader fil...');
  
  try {
    const fileExt = file.name.split('.').pop().toLowerCase();
    const fileId = generateId();
    const filePath = `${fileId}.${fileExt}`;
    
    const { error: uploadError } = await db.storage
      .from(SUPABASE_BUCKET)
      .upload(filePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    
    showStatus('Gemmer i database...');
    const { data: fakturaData, error: insertError } = await db
      .from('fakturaer')
      .insert({
        fil_sti: filePath,
        fil_navn: file.name,
        fil_type: file.type,
        fil_storrelse_bytes: file.size,
        status: 'uploaded'
      })
      .select()
      .single();
    if (insertError) throw insertError;
    
    showStatus('Læser faktura med AI...');
    const extractResponse = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fakturaId: fakturaData.id,
        filePath: filePath,
        fileType: file.type
      })
    });
    
    if (!extractResponse.ok) {
      const errorData = await extractResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Ekstraktion fejlede (${extractResponse.status})`);
    }
    
    hideStatus();
    window.location.href = `faktura.html?id=${fakturaData.id}`;
  } catch (error) {
    console.error('Fejl:', error);
    hideStatus();
    alert('Der opstod en fejl: ' + error.message);
  }
}

function showStatus(text) {
  statusText.textContent = text;
  uploadStatus.classList.remove('hidden');
}

function hideStatus() {
  uploadStatus.classList.add('hidden');
}

// =====================================================
// Liste
// =====================================================

async function loadFakturaer() {
  fakturaList.innerHTML = '<p class="loading">Indlæser...</p>';
  
  try {
    const { data, error } = await db
      .from('fakturaer')
      .select('*')
      .order('oprettet_dato', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      fakturaList.innerHTML = '<p class="empty">Ingen fakturaer endnu. Upload den første ovenfor.</p>';
      return;
    }
    
    fakturaList.innerHTML = data.map(renderFakturaItem).join('');
  } catch (error) {
    console.error('Fejl:', error);
    fakturaList.innerHTML = `<p class="empty">Fejl: ${error.message}</p>`;
  }
}

function renderFakturaItem(faktura) {
  const leverandor = faktura.leverandoer_navn || faktura.fil_navn || 'Ukendt leverandør';
  const fakturadato = faktura.fakturadato 
    ? new Date(faktura.fakturadato).toLocaleDateString('da-DK')
    : new Date(faktura.oprettet_dato).toLocaleDateString('da-DK');
  const fakturanr = faktura.fakturanummer ? `· Faktura ${faktura.fakturanummer}` : '';
  
  const belob = faktura.belob_inkl_moms !== null
    ? `${formatBelob(faktura.belob_inkl_moms)} ${faktura.valuta || 'DKK'}`
    : '';
  
  const statusTekst = {
    'uploaded': 'Uploadet',
    'extracting': 'Læser...',
    'extracted': 'Klar til afsendelse',
    'extraction_failed': 'Fejl',
    'afventer_godkendelse': 'Afventer godkendelse',
    'godkendt': 'Godkendt',
    'afvist': 'Afvist',
    'frigivet_til_bogforing': 'Frigivet'
  }[faktura.status] || faktura.status;
  
  return `
    <a href="faktura.html?id=${faktura.id}" class="faktura-item">
      <div class="faktura-info">
        <div class="faktura-leverandor">${escapeHtml(leverandor)}</div>
        <div class="faktura-meta">${fakturadato} ${fakturanr}</div>
      </div>
      <div class="faktura-belob">${belob}</div>
      <span class="faktura-status status-${faktura.status}">${statusTekst}</span>
    </a>
  `;
}

function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
}

function formatBelob(belob) {
  return new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(belob);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadFakturaer();
