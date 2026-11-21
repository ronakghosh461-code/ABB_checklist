/**
 * QR Site Checklist - QR Code Generator Logic
 */

(function () {
  'use strict';

  // DOM Elements
  const loginSection = document.getElementById('loginSection');
  const qrSection = document.getElementById('qrSection');
  const loginForm = document.getElementById('loginForm');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  const siteListInput = document.getElementById('siteListInput');
  const baseUrlInput = document.getElementById('baseUrlInput');
  const generateBtn = document.getElementById('generateBtn');
  const printBtn = document.getElementById('printBtn');
  const qrHeader = document.getElementById('qrHeader');
  const badgeCount = document.getElementById('badgeCount');
  const qrGrid = document.getElementById('qrGrid');

  // Theme Support
  function initTheme() {
    const savedTheme = localStorage.getItem('qr_checklist_theme') || 'light';
    applyTheme(savedTheme);

    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('qr_checklist_theme', next);
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // Check Admin Authentication
  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/check-auth');
      const data = await res.json();
      if (data.authenticated) {
        showQrSection();
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    loginSection.style.display = 'block';
    qrSection.style.display = 'none';
    logoutBtn.style.display = 'none';
  }

  function showQrSection() {
    loginSection.style.display = 'none';
    qrSection.style.display = 'block';
    logoutBtn.style.display = 'inline-flex';

    if (!baseUrlInput.value) {
      baseUrlInput.value = window.location.origin;
    }
  }

  // Handle Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    const password = adminPasswordInput.value;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        adminPasswordInput.value = '';
        showQrSection();
      } else {
        loginError.textContent = data.error || 'Invalid password.';
        loginError.style.display = 'block';
      }
    } catch (err) {
      loginError.textContent = 'Server connection failed.';
      loginError.style.display = 'block';
    }
  });

  // Handle Logout
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {}
    showLogin();
  });

  // Handle QR Generation
  generateBtn.addEventListener('click', async () => {
    const rawSites = siteListInput.value.split('\n');
    const sites = rawSites.map((s) => s.trim()).filter((s) => s.length > 0);

    if (sites.length === 0) {
      alert('Please enter at least one site name.');
      return;
    }

    const baseUrl = baseUrlInput.value.trim() || window.location.origin;

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating QR Codes...';

    try {
      const res = await fetch('/api/admin/generate-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sites, baseUrl })
      });

      if (!res.ok) {
        throw new Error('Failed to generate QR codes.');
      }

      const data = await res.json();
      renderQrCodes(data.qrCodes);
    } catch (err) {
      console.error(err);
      alert('Error generating QR codes: ' + err.message);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Printable Codes';
    }
  });

  // Render QR Cards
  function renderQrCodes(codes) {
    qrGrid.innerHTML = '';

    if (!codes || codes.length === 0) {
      qrHeader.style.display = 'none';
      printBtn.style.display = 'none';
      return;
    }

    qrHeader.style.display = 'flex';
    badgeCount.textContent = `(${codes.length} sites generated)`;
    printBtn.style.display = 'inline-flex';

    codes.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'qr-card';

      card.innerHTML = `
        <div class="qr-card-title">${escapeHtml(item.site)}</div>
        <img class="qr-img" src="${item.qrDataUrl}" alt="QR Code for ${escapeHtml(item.site)}">
        <div class="qr-caption">Scan with mobile camera to start inspection</div>
        <a class="qr-url" href="${item.url}" target="_blank">${escapeHtml(item.url)}</a>
        <div>
          <button type="button" class="qr-download-btn" data-site="${escapeHtml(item.site)}" data-src="${item.qrDataUrl}">
            💾 Download PNG
          </button>
        </div>
      `;

      qrGrid.appendChild(card);
    });

    // Attach individual PNG download handlers
    qrGrid.querySelectorAll('.qr-download-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const site = btn.getAttribute('data-site');
        const dataUrl = btn.getAttribute('data-src');

        const link = document.createElement('a');
        link.download = `QR-${site.replace(/[^a-z0-9_-]/gi, '_')}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    });

    // Smooth scroll down to generated codes
    qrHeader.scrollIntoView({ behavior: 'smooth' });
  }

  // Handle Print Action
  printBtn.addEventListener('click', () => {
    window.print();
  });

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Init
  initTheme();
  checkAuth();
})();
