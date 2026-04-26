// =====================================================
// app.js - Forsidens logik
// Upload, ekstraktion og visning af fakturaliste
// + QR-bridging fra mobil til PC
// =====================================================

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

// QR-modal elementer
const qrBtn = document.getElementById('qr-btn');
const qrModal = document.getElementById('qr-modal');
const modalClose = document.getElementById('modal-close');
const modalOverlay = document.getElementById('modal-overlay');
const qrContainer = document.getElementById('qr-container');
const qrStatus = document.getElementById('qr-status');
const qrUrlFallback = document.getElementById('qr-url-fallback');

// QR-state
let qrPollingInterval = null;
let currentSessionToken = null;

// =====================================================
// Event listeners - upload
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
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

refreshBtn.addEventListener('click', loadFakturaer);

// =====================================================
// QR-modal event listeners
// =====================================================

qrBtn.addEventListener('click', openQrModal);
modalClose.addEventListener('click', closeQrModal);
modalOverlay.addEventListener('click', closeQrModal);

// Luk modal med Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !qrModal.classList.contains('hidden')) {
    closeQrModal();
  }
});

// =====================================================
// QR-bridging
// =====================================================

function openQrModal() {
  // Generér ny session-token
  currentSessionToken = generateSessionToken();
  
  // Byg upload-URL
  const baseUrl = window.location.origin;
  const uploadUrl = `${baseUrl}/upload.html?session=${currentSessionToken}`;
  
  // Vis modal
  qrModal.classList.remove('hidden');
  
  // Generér QR-kode
  qrContainer.innerHTML = '';
  new QRCode(qrContainer, {
    text: uploadUrl,
    width: 240,
    height: 240,
    colorDark: '#042f4e',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  
  // Vis URL som fallback (kan kopieres hvis QR ikke virker)
  qrUrlFallback.textContent = uploadUrl;
  
  // Reset status
  qrStatus.classList.remove('received');
  qrStatus.querySelector('span').textContent = 'Venter på fil fra telefon...';
  
  // Start polling
  startPolling();
}

function closeQrModal() {
  qrModal.classList.add('hidden');
  stopPolling();
  currentSessionToken = null;
}

function startPolling() {
  stopPolling(); // sikkerhed
  
  qrPollingInterval = setInterval(async () => {
    if (!currentSessionToken) return;
    
    try {
      // List filer i bridge-bucket der starter med session-token
      const { data, error } = await db.storage
        .from(BRIDGE_BUCKET)
        .list('', {
          search: currentSessionToken
        });
      
      if (error) {
        console.error('Polling-fejl:', error);
        return;
      }
      
      if (data && data.length > 0) {
        // Fundet! Match efter præcis filnavn-prefix
        const fundetFil = data.find(f => f.name.startsWith(currentSessionToken + '.'));
        if (fundetFil) {
          await handleBridgeFile(fundetFil);
        }
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
  // Stop polling med det samme - undgå dobbelthåndtering
  stopPolling();
  
  // Vis bekræftelse
  qrStatus.classList.add('received');
  qrStatus.querySelector('span').textContent = '✓ Fil modtaget – behandler...';
  
  try {
    // Download filen fra bridge-bucket
    const { data: blob, error: downloadError } = await db.storage
      .from(BRIDGE_BUCKET)
      .download(fundetFil.name);
    
    if (downloadError) throw downloadError;
    
    // Lav et File-objekt så vi kan bruge samme handleFile-flow
    const fileExt = fundetFil.name.split('.').pop().toLowerCase();
    const mimeType = getMimeTypeFromExt(fileExt);
    const file = new File([blob], `mobil-upload.${fileExt}`, { type: mimeType });
    
    // Slet bridge-filen (den er nu overført til vores normale flow)
    await db.storage.from(BRIDGE_BUCKET).remove([fundetFil.name]);
    
    // Luk modal
    closeQrModal();
    
    // Kør den normale upload-pipeline
    await handleFile(file);
    
  } catch (error) {
    console.error('Bridge-fejl:', error);
    qrStatus.classList.remove('received');
    qrStatus.querySelector('span').textContent = 'Fejl: ' + error.message;
    // Genstart polling i tilfælde af det var en transient fejl
    setTimeout(() => {
      if (!qrModal.classList.contains('hidden')) {
        qrStatus.querySelector('span').textContent = 'Venter på fil fra telefon...';
        startPolling();
      }
    }, 3000);
  }
}

function generateSessionToken() {
  // UUID v4-lignende
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getMimeTypeFromExt(ext) {
  const map = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'heic': 'image/heic',
    'heif': 'image/heif'
  };
  return map[ext] || 'application/octet-stream';
}

// =====================================================
// Filhåndtering (uændret fra før)
// =====================================================

async function handleFile(file) {
  console.log('handleFile kaldt med:', file.name, file.type, file.size);
  
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
    
    console.log('Uploader til Supabase Storage:', filePath);
    
    const { data: uploadData, error: uploadError } = await db.storage
      .from(SUPABASE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false
      });
    
    if (uploadError) throw uploadError;
    console.log('Upload OK:', uploadData);
    
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
    console.log('DB-række oprettet:', fakturaData.id);
    
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
    console.error('Fejl ved upload/ekstraktion:', error);
    hideStatus();
    alert('Der opstod en fejl: ' + error.message);
  }
}

// =====================================================
// Status og liste (uændret)
// =====================================================

function showStatus(text) {
  statusText.textContent = text;
  uploadStatus.classList.remove('hidden');
}

function hideStatus() {
  uploadStatus.classList.add('hidden');
}

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
    console.error('Fejl ved indlæsning:', error);
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
    'extracted': 'Læst',
    'extraction_failed': 'Fejl'
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

// =====================================================
// Hjælpefunktioner
// =====================================================

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

// =====================================================
// Init
// =====================================================

loadFakturaer();
