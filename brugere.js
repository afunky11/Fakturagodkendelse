// =====================================================
// brugere.js - PoC bruger-system uden auth
// 
// Hardcoded test-brugere lagres i localStorage.
// I produktion (Dash Enterprise) erstattes med Azure AD.
// =====================================================

const TEST_BRUGERE = [
  { navn: 'Allan',     rolle: 'Bogholder' },
  { navn: 'Nikoline',  rolle: 'Godkender' }
];

const STORAGE_KEY = 'aktuel_bruger';

function hentAktuelBruger() {
  try {
    const gemt = localStorage.getItem(STORAGE_KEY);
    if (gemt) {
      const parsed = JSON.parse(gemt);
      if (TEST_BRUGERE.find(b => b.navn === parsed.navn)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Fejl ved læsning af aktuel bruger:', e);
  }
  return TEST_BRUGERE[0]; // default Allan
}

function gemAktuelBruger(bruger) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bruger));
}

// =====================================================
// Render bruger-vælger
// =====================================================

function renderBrugerVaelger(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const aktuel = hentAktuelBruger();
  
  const optionsHtml = TEST_BRUGERE.map(b => {
    const valgt = b.navn === aktuel.navn ? 'selected' : '';
    return `<option value="${b.navn}" ${valgt}>${b.navn} (${b.rolle})</option>`;
  }).join('');
  
  container.innerHTML = `
    <div class="bruger-vaelger">
      <label class="bruger-vaelger-label">Bruger:</label>
      <select id="bruger-select" class="bruger-vaelger-select">
        ${optionsHtml}
      </select>
    </div>
  `;
  
  document.getElementById('bruger-select').addEventListener('change', (e) => {
    const valgt = TEST_BRUGERE.find(b => b.navn === e.target.value);
    if (valgt) {
      gemAktuelBruger(valgt);
      if (onChange) {
        onChange(valgt);
      } else {
        // Default: redirect baseret på rolle
        if (valgt.rolle === 'Godkender') {
          window.location.href = 'godkend.html';
        } else {
          window.location.href = 'index.html';
        }
      }
    }
  });
}

// =====================================================
// Routing-hjælpere
// =====================================================

function tjekRolleEllerOmdiriger(forventetRolle) {
  const bruger = hentAktuelBruger();
  if (bruger.rolle !== forventetRolle) {
    if (bruger.rolle === 'Godkender') {
      window.location.href = 'godkend.html';
    } else {
      window.location.href = 'index.html';
    }
    return false;
  }
  return true;
}
