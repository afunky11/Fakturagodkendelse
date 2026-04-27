// =====================================================
// godkend.js - Godkenders side
// Liste over fakturaer der venter på godkendelse + detaljevisning
// =====================================================

// Tjek bruger - kun Godkendere må være her
const aktuelBruger = hentAktuelBruger();
if (aktuelBruger.rolle !== 'Godkender') {
  window.location.href = 'index.html';
}

renderBrugerVaelger('bruger-vaelger-container');

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const koeListe = document.getElementById('koe-liste');
const koeTael = document.getElementById('koe-tael');
const detaljeContainer = document.getElementById('detalje-container');
const pageSubtitle = document.getElementById('page-subtitle');

// Afvis modal
const afvisModal = document.getElementById('afvis-modal');
const afvisOverlay = document.getElementById('afvis-overlay');
const afvisClose = document.getElementById('afvis-close');
const afvisAnnuller = document.getElementById('afvis-annuller');
const afvisBekraeft = document.getElementById('afvis-bekraeft');
const afvisKommentar = document.getElementById('afvis-kommentar');

let alleFakturaer = [];
let valgtFaktura = null;
let valgtSignedUrl = null;

afvisOverlay.addEventListener('click', lukAfvisModal);
afvisClose.addEventListener('click', lukAfvisModal);
afvisAnnuller.addEventListener('click', lukAfvisModal);
afvisBekraeft.addEventListener('click', bekraeftAfvis);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !afvisModal.classList.contains('hidden')) lukAfvisModal();
});

// =====================================================
// Indlæs kø
// =====================================================

async function loadKoe() {
  try {
    const { data, error } = await db
      .from('fakturaer')
      .select('*')
      .eq('status', 'afventer_godkendelse')
      .order('sendt_til_godkendelse_dato', { ascending: true });
    
    if (error) throw error;
    
    alleFakturaer = data || [];
    renderKoe();
    
    // Hvis ingen er valgt og der er fakturaer i køen, vælg den første
    if (!valgtFaktura && alleFakturaer.length > 0) {
      vaelgFaktura(alleFakturaer[0]);
    } else if (alleFakturaer.length === 0) {
      visTomKoe();
    }
  } catch (error) {
    console.error('Fejl:', error);
    koeListe.innerHTML = `<p class="empty">Fejl: ${error.message}</p>`;
  }
}

function renderKoe() {
  koeTael.textContent = alleFakturaer.length;
  pageSubtitle.textContent = alleFakturaer.length === 0 
    ? 'Køen er tom' 
    : `${alleFakturaer.length} faktura${alleFakturaer.length === 1 ? '' : 'er'} venter`;
  
  if (alleFakturaer.length === 0) {
    koeListe.innerHTML = `
      <div class="godkender-tom-koe">
        <div class="godkender-tom-koe-ikon">✓</div>
        <p>Ingen fakturaer venter</p>
      </div>
    `;
    return;
  }
  
  koeListe.innerHTML = alleFakturaer.map(f => {
    const aktiv = valgtFaktura && valgtFaktura.id === f.id ? 'aktiv' : '';
    const leverandor = f.leverandoer_navn || f.fil_navn || 'Ukendt';
    const belob = f.belob_inkl_moms !== null
      ? `${formatBelob(f.belob_inkl_moms)} ${f.valuta || 'DKK'}`
      : '–';
    const sendtAf = f.sendt_til_godkendelse_af || '?';
    const dato = f.sendt_til_godkendelse_dato 
      ? new Date(f.sendt_til_godkendelse_dato).toLocaleDateString('da-DK')
      : '';
    
    return `
      <div class="godkender-koe-item ${aktiv}" data-id="${f.id}">
        <div class="godkender-koe-item-leverandor">${escapeHtml(leverandor)}</div>
        <div class="godkender-koe-item-belob">${belob}</div>
        <div class="godkender-koe-item-meta">Sendt af ${escapeHtml(sendtAf)} ${dato}</div>
      </div>
    `;
  }).join('');
  
  // Bind clicks
  koeListe.querySelectorAll('.godkender-koe-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const faktura = alleFakturaer.find(f => f.id === id);
      if (faktura) vaelgFaktura(faktura);
    });
  });
}

function visTomKoe() {
  detaljeContainer.innerHTML = `
    <div class="godkender-vaelg-prompt">
      <div class="godkender-vaelg-prompt-ikon">🎉</div>
      <p>Køen er tom – godt arbejde!</p>
    </div>
  `;
}

// =====================================================
// Vælg faktura og vis detaljer
// =====================================================

async function vaelgFaktura(faktura) {
  valgtFaktura = faktura;
  renderKoe(); // opdater 'aktiv'-markering
  
  detaljeContainer.innerHTML = '<p class="loading" style="text-align:center;padding:40px">Indlæser...</p>';
  
  try {
    const { data: urlData, error } = await db.storage
      .from(SUPABASE_BUCKET).createSignedUrl(faktura.fil_sti, 3600);
    if (error) throw error;
    
    valgtSignedUrl = urlData.signedUrl;
    renderDetaljer(faktura, urlData.signedUrl);
  } catch (error) {
    detaljeContainer.innerHTML = `<p class="empty">Fejl: ${error.message}</p>`;
  }
}

function renderDetaljer(faktura, fileUrl) {
  const erPdf = faktura.fil_type === 'application/pdf';
  const fileViewer = erPdf
    ? `<iframe src="${fileUrl}" title="Faktura PDF"></iframe>`
    : `<img src="${fileUrl}" alt="Faktura">`;
  
  const leverandor = faktura.leverandoer_navn || '(ingen)';
  const belob = faktura.belob_inkl_moms !== null
    ? `${formatBelob(faktura.belob_inkl_moms)} ${faktura.valuta || 'DKK'}`
    : '–';
  const beskrivelse = faktura.bogforingsbeskrivelse || '(ingen)';
  const konto = faktura.bogforingskonto || '(ikke angivet)';
  const forfaldsdato = faktura.forfaldsdato 
    ? new Date(faktura.forfaldsdato).toLocaleDateString('da-DK')
    : '–';
  const fakturanr = faktura.fakturanummer || '–';
  const sendtAf = faktura.sendt_til_godkendelse_af || '?';
  
  detaljeContainer.innerHTML = `
    <div class="godkender-detalje">
      <div class="godkender-pdf">
        ${fileViewer}
      </div>
      <div class="godkender-info">
        <div class="godkender-info-kort">
          <h3>Til godkendelse</h3>
          <div class="godkender-felt godkender-felt-stor">
            <span class="godkender-felt-label">Beløb</span>
            <span class="godkender-felt-vaerdi">${belob}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Leverandør</span>
            <span class="godkender-felt-vaerdi">${escapeHtml(leverandor)}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Beskrivelse</span>
            <span class="godkender-felt-vaerdi">${escapeHtml(beskrivelse)}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Konto</span>
            <span class="godkender-felt-vaerdi">${escapeHtml(konto)}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Forfaldsdato</span>
            <span class="godkender-felt-vaerdi">${forfaldsdato}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Fakturanr.</span>
            <span class="godkender-felt-vaerdi">${escapeHtml(fakturanr)}</span>
          </div>
          <div class="godkender-felt">
            <span class="godkender-felt-label">Sendt af</span>
            <span class="godkender-felt-vaerdi">${escapeHtml(sendtAf)}</span>
          </div>
        </div>
        
        <div class="godkender-actions">
          <button type="button" class="btn-godkend" id="godkend-btn">
            ✓ Godkend
          </button>
          <button type="button" class="btn-afvis" id="afvis-btn">
            ✗ Afvis med kommentar
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('godkend-btn').addEventListener('click', godkendFaktura);
  document.getElementById('afvis-btn').addEventListener('click', aabnAfvisModal);
}

// =====================================================
// Godkend
// =====================================================

async function godkendFaktura() {
  if (!valgtFaktura) return;
  if (!confirm(`Godkend faktura fra ${valgtFaktura.leverandoer_navn || 'ukendt'}?`)) return;
  
  try {
    const { error } = await db.from('fakturaer').update({
      status: 'godkendt',
      godkendt_af: aktuelBruger.navn,
      godkendt_dato: new Date().toISOString()
    }).eq('id', valgtFaktura.id);
    
    if (error) throw error;
    
    await db.from('godkendelse_historik').insert({
      faktura_id: valgtFaktura.id,
      handling: 'godkendt',
      bruger_navn: aktuelBruger.navn,
      bruger_rolle: aktuelBruger.rolle
    });
    
    // Find næste i køen
    gaaTilNaeste();
  } catch (error) {
    alert('Fejl: ' + error.message);
  }
}

// =====================================================
// Afvis
// =====================================================

function aabnAfvisModal() {
  afvisKommentar.value = '';
  afvisModal.classList.remove('hidden');
  setTimeout(() => afvisKommentar.focus(), 50);
}

function lukAfvisModal() {
  afvisModal.classList.add('hidden');
}

async function bekraeftAfvis() {
  const kommentar = afvisKommentar.value.trim();
  if (!kommentar) {
    alert('Skriv en kommentar før du afviser');
    afvisKommentar.focus();
    return;
  }
  
  if (!valgtFaktura) return;
  
  afvisBekraeft.disabled = true;
  afvisBekraeft.textContent = 'Afviser...';
  
  try {
    const { error } = await db.from('fakturaer').update({
      status: 'afvist',
      afvist_af: aktuelBruger.navn,
      afvist_dato: new Date().toISOString(),
      afvisningskommentar: kommentar
    }).eq('id', valgtFaktura.id);
    
    if (error) throw error;
    
    await db.from('godkendelse_historik').insert({
      faktura_id: valgtFaktura.id,
      handling: 'afvist',
      bruger_navn: aktuelBruger.navn,
      bruger_rolle: aktuelBruger.rolle,
      kommentar: kommentar
    });
    
    lukAfvisModal();
    gaaTilNaeste();
  } catch (error) {
    alert('Fejl: ' + error.message);
  } finally {
    afvisBekraeft.disabled = false;
    afvisBekraeft.textContent = 'Afvis faktura';
  }
}

// =====================================================
// Gå til næste i køen efter handling
// =====================================================

async function gaaTilNaeste() {
  // Find indekset af den behandlede faktura
  const idx = alleFakturaer.findIndex(f => f.id === valgtFaktura.id);
  
  // Genindlæs køen
  await loadKoe();
  
  // Hvis køen ikke er tom, vælg næste (eller første hvis vi var sidst)
  if (alleFakturaer.length > 0) {
    const naeste = alleFakturaer[Math.min(idx, alleFakturaer.length - 1)] || alleFakturaer[0];
    vaelgFaktura(naeste);
  } else {
    valgtFaktura = null;
    visTomKoe();
  }
}

// =====================================================
// Hjælpefunktioner
// =====================================================

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

loadKoe();

// Auto-refresh hver 30 sekunder
setInterval(loadKoe, 30000);
