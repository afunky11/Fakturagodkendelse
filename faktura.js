
<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Faktura - Fakturagodkendelse</title>
  <link rel="stylesheet" href="styles.css">
  <style>
    /* Detaljeside-specifikke styles */
    .detail-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    .pdf-panel, .felter-panel {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    
    .pdf-viewer {
      width: 100%;
      height: 80vh;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    
    .image-viewer {
      width: 100%;
      max-height: 80vh;
      object-fit: contain;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    
    .felter-panel h2 {
      font-size: 18px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .felt-gruppe {
      margin-bottom: 20px;
    }
    
    .felt-gruppe-titel {
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    
    .felt {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    
    .felt:last-child {
      border-bottom: none;
    }
    
    .felt-label {
      color: #64748b;
      flex-shrink: 0;
      margin-right: 12px;
    }
    
    .felt-vaerdi {
      font-weight: 500;
      text-align: right;
      color: #1e293b;
      word-break: break-word;
    }
    
    .felt-vaerdi.tom {
      color: #cbd5e0;
      font-style: italic;
      font-weight: normal;
    }
    
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: white;
      text-decoration: none;
      margin-bottom: 12px;
      font-size: 14px;
      opacity: 0.9;
    }
    
    .back-link:hover {
      opacity: 1;
    }
    
    .status-banner {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    
    .status-banner.error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    
    .status-banner.processing {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #bfdbfe;
    }
    
    .konfidens-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-left: 8px;
    }
    
    .konfidens-hoj { background: #d1fae5; color: #065f46; }
    .konfidens-medium { background: #fef3c7; color: #92400e; }
    .konfidens-lav { background: #fee2e2; color: #991b1b; }
    
    @media (max-width: 900px) {
      .detail-container {
        grid-template-columns: 1fr;
      }
      
      .pdf-viewer, .image-viewer {
        height: 50vh;
      }
    }
  </style>
</head>
<body>
  <header>
    <a href="index.html" class="back-link">← Tilbage til oversigt</a>
    <h1 id="page-title">📄 Faktura</h1>
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
        <h2>Ekstraherede felter</h2>
        <div id="felter-content">
          <!-- Felter sættes ind her -->
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
