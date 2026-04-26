<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Faktura - Fakturagodkendelse</title>
  
  <!-- Work Sans font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <a href="index.html" class="back-link">← Tilbage til oversigt</a>
    <h1 id="page-title">Faktura</h1>
    <p class="subtitle" id="page-subtitle">Indlæser...</p>
  </header>

  <main>
    <div id="loading" class="loading" style="text-align: center; padding: 40px;">
      Indlæser faktura...
    </div>
    
    <div id="error" class="status-banner error hidden">
      <strong>Fejl:</strong> <span id="error-text"></span>
    </div>
    
    <div id="content" class="detail-container hidden">
      <div class="pdf-panel">
        <div id="file-viewer-container">
          <!-- PDF eller billede sættes ind her -->
        </div>
      </div>
      
      <div class="felter-panel">
        <div class="felter-panel-header">
          <h2>Fakturadata</h2>
          <span id="konfidens-container"></span>
        </div>
        
        <form id="felter-form" autocomplete="off">
          <!-- Felter genereres af JS -->
        </form>
        
        <div class="felter-actions">
          <span id="changes-indicator" class="changes-indicator none">Ingen ændringer</span>
          <div style="display: flex; gap: 8px;">
            <button type="button" id="cancel-btn" class="btn btn-tertiary" disabled>Fortryd</button>
            <button type="button" id="save-btn" class="btn btn-primary" disabled>Gem ændringer</button>
          </div>
        </div>
      </div>
    </div>
  </main>

  <footer>
    <p class="footer-text">PoC – ikke til produktion. Ingen login, åben adgang.</p>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="config.js"></script>
  <script src="faktura.js"></script>
</body>
</html>
