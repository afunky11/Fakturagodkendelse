
// =====================================================
// app.js - Forsidens logik
// Upload, ekstraktion og visning af fakturaliste
// =====================================================

// Init Supabase klient
const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

// DOM-elementer
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const cameraInput = document.getElementById('camera-input');
const uploadStatus = document.getElementById('upload-status');
const statusText = document.getElementById('status-text');
const fakturaList = document.getElementById('faktura-list');
const refreshBtn = document.getElementById('refresh-btn');

// =====================================================
// Event listeners
// =====================================================

// Klik på dropzone åbner filvælger
dropzone.addEventListener('click', (e) => {
  // Undgå at klik på knapper trigger dropzone-klik
  if (e.target.closest('label')) return;
  fileInput.click();
});

// Drag & drop
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

// Filvælger
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

// Kamera
cameraInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

// Refresh-knap
refreshBtn.addEventListener('click', loadFakturaer);

// =====================================================
// Filhåndtering
// =====================================================

async function handleFile(file) {
  // Validering
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
  const maxSize = 25 * 1024 * 1024; // 25 MB
  
  if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/')) {
    alert('Ugyldig filtype. Brug PDF, JPG eller PNG.');
    return;
  }
  
  if (file.size > maxSize) {
    alert('Filen er for stor (max 25 MB).');
    return;
  }
  
  showStatus('Uploader fil...');
  
  try {
    // 1. Upload til Supabase Storage
    const fileExt = file.name.split('.').pop().toLowerCase();
    const fileId = generateId();
    const filePath = `${fileId}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false
      });
    
    if (uploadError) throw uploadError;
    
    // 2. Opret række i fakturaer-tabellen
    showStatus('Gemmer i database...');
    
    const { data: fakturaData, error: insertError } = await supabase
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
    
    // 3. Trigger ekstraktion via serverless function
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
    
    // 4. Naviger til detaljeside
    window.location.href = `faktura.html?id=${fakturaData.id}`;
    
  } catch (error) {
    console.error('Fejl ved upload/ekstraktion:', error);
    hideStatus();
    alert('Der opstod en fejl: ' + error.message);
  }
}

// =====================================================
// Status-visning
// =====================================================

function showStatus(text) {
  statusText.textContent = text;
  uploadStatus.classList.remove('hidden');
}

function hideStatus() {
  uploadStatus.classList.add('hidden');
}

// =====================================================
// Liste over fakturaer
// =====================================================

async function loadFakturaer() {
  fakturaList.innerHTML = '<p class="loading">Indlæser...</p>';
  
  try {
    const { data, error } = await supabase
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
