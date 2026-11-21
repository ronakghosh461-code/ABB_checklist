/**
 * QR Site Checklist - Admin Dashboard Logic
 */

(function () {
  'use strict';

  // State
  let allReports = [];
  let currentSites = [];

  // DOM Elements - Auth
  const loginSection = document.getElementById('loginSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const loginForm = document.getElementById('loginForm');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // DOM Elements - Stats
  const statTotal = document.getElementById('statTotal');
  const statProblems = document.getElementById('statProblems');
  const statOk = document.getElementById('statOk');
  const statSites = document.getElementById('statSites');

  // DOM Elements - Filters
  const filterSite = document.getElementById('filterSite');
  const filterStartDate = document.getElementById('filterStartDate');
  const filterEndDate = document.getElementById('filterEndDate');
  const filterSearch = document.getElementById('filterSearch');
  const filterProblemsOnly = document.getElementById('filterProblemsOnly');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  const downloadCsvBtn = document.getElementById('downloadCsvBtn');

  // DOM Elements - List & Modals
  const reportsList = document.getElementById('reportsList');
  const reportCountBadge = document.getElementById('reportCountBadge');
  const detailModal = document.getElementById('detailModal');
  const modalReportTitle = document.getElementById('modalReportTitle');
  const modalBody = document.getElementById('modalBody');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalCloseActionBtn = document.getElementById('modalCloseActionBtn');
  const modalDeleteBtn = document.getElementById('modalDeleteBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const lightboxOverlay = document.getElementById('lightboxOverlay');
  const lightboxImg = document.getElementById('lightboxImg');

  let currentViewingReportId = null;

  // Master QR Modal Elements
  const showMasterQrBtn = document.getElementById('showMasterQrBtn');
  const masterQrModal = document.getElementById('masterQrModal');
  const closeMasterQrBtn = document.getElementById('closeMasterQrBtn');
  const closeMasterQrBtn2 = document.getElementById('closeMasterQrBtn2');
  const adminQrImage = document.getElementById('adminQrImage');
  const adminQrUrl = document.getElementById('adminQrUrl');

  let autoRefreshInterval = null;

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

  // Check Admin Authentication Status
  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/check-auth');
      const data = await res.json();
      if (data.authenticated) {
        showDashboard();
      } else {
        showLogin();
      }
    } catch (e) {
      showLogin();
    }
  }

  function showLogin() {
    loginSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  }

  function showDashboard() {
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    logoutBtn.style.display = 'inline-flex';
    loadReports();
    startAutoRefresh();
  }

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
      if (!detailModal.classList.contains('active') && !masterQrModal.classList.contains('active')) {
        loadReports(true);
      }
    }, 3000);
  }

  // Handle Login Form
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
        showDashboard();
      } else {
        loginError.textContent = data.error || 'Invalid admin password.';
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

  // Load Reports from Server
  async function loadReports() {
    try {
      const params = new URLSearchParams();
      if (filterSite.value && filterSite.value !== 'all') {
        params.append('site', filterSite.value);
      }
      if (filterStartDate.value) {
        params.append('startDate', filterStartDate.value);
      }
      if (filterEndDate.value) {
        params.append('endDate', filterEndDate.value);
      }
      if (filterProblemsOnly.checked) {
        params.append('problemsOnly', 'true');
      }

      const res = await fetch(`/api/reports?${params.toString()}`);
      if (res.status === 401) {
        showLogin();
        return;
      }

      const data = await res.json();
      allReports = data.reports || [];

      // Update KPI Stats
      if (data.stats) {
        statTotal.textContent = data.stats.totalReports;
        statProblems.textContent = data.stats.reportsWithProblems;
        statOk.textContent = data.stats.allOkReports;
        statSites.textContent = data.stats.distinctSites;
      }

      // Update Site Dropdown
      if (data.sites) {
        updateSiteDropdown(data.sites);
      }

      renderReportsList();
    } catch (err) {
      console.error('Error fetching reports:', err);
      reportsList.innerHTML = `<div style="text-align: center; color: var(--problem-color); padding: 40px;">Failed to load reports.</div>`;
    }
  }

  // Update Site Dropdown Filter options
  function updateSiteDropdown(sites) {
    const currentVal = filterSite.value;
    filterSite.innerHTML = '<option value="all">All Sites</option>';
    sites.forEach((site) => {
      const opt = document.createElement('option');
      opt.value = site;
      opt.textContent = site;
      if (site === currentVal) opt.selected = true;
      filterSite.appendChild(opt);
    });
  }

  // Render Reports List
  function renderReportsList() {
    const searchTerm = filterSearch.value.trim().toLowerCase();

    const filtered = allReports.filter((r) => {
      if (!searchTerm) return true;
      const name = (r.employee_name || '').toLowerCase();
      const id = (r.employee_id || '').toLowerCase();
      const site = (r.site || '').toLowerCase();
      return name.includes(searchTerm) || id.includes(searchTerm) || site.includes(searchTerm);
    });

    reportCountBadge.textContent = `(${filtered.length} shown)`;

    if (filtered.length === 0) {
      reportsList.innerHTML = `
        <div class="card" style="text-align: center; color: var(--text-muted); padding: 40px 20px;">
          <p style="font-size: 1.1rem; margin-bottom: 6px;">No inspection reports found matching current filters.</p>
          <p style="font-size: 0.85rem;">Try clearing or adjusting your search parameters.</p>
        </div>
      `;
      return;
    }

    reportsList.innerHTML = '';

    filtered.forEach((report) => {
      const card = document.createElement('div');
      const hasProblems = report.problem_count > 0;
      card.className = `report-card ${hasProblems ? 'has-problems' : 'all-ok'}`;

      const problemBadge = hasProblems
        ? `<span class="badge badge-problem">⚠️ ${report.problem_count} Problem${report.problem_count > 1 ? 's' : ''}</span>`
        : `<span class="badge badge-ok">✓ All OK</span>`;

      const formattedDate = formatDateTime(report.created_at);

      card.innerHTML = `
        <div class="report-primary-info">
          <div class="report-header-line">
            <span class="report-site-name">${escapeHtml(report.site)}</span>
            ${problemBadge}
          </div>
          <div class="report-meta-line">
            <span><strong>Inspector:</strong> ${escapeHtml(report.employee_name)} ${report.employee_id ? `(${escapeHtml(report.employee_id)})` : ''}</span>
            ${report.drive_details ? `<span>•</span> <span><strong>Drive:</strong> ${escapeHtml(report.drive_details)}</span>` : ''}
            <span>•</span>
            <span class="report-date">📅 ${formattedDate}</span>
            <span>•</span>
            <span>Ref: #${report.id}</span>
          </div>
        </div>
        <div class="report-actions-wrap" style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="nav-btn view-btn" style="padding: 6px 12px; font-size: 0.85rem; font-weight: 700;">
            View Detail →
          </button>
          <button type="button" class="nav-btn delete-btn" data-id="${report.id}" style="padding: 6px 10px; font-size: 0.85rem; color: #dc2626; border-color: #fecaca; background: #fef2f2;" title="Delete this report">
            🗑️
          </button>
        </div>
      `;

      // Handle delete button click without opening modal
      const delBtn = card.querySelector('.delete-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSingleReport(report.id, report.site);
        });
      }

      card.addEventListener('click', () => openReportDetail(report.id));
      reportsList.appendChild(card);
    });
  }

  // Open Report Detail Modal
  async function openReportDetail(reportId) {
    currentViewingReportId = reportId;
    modalReportTitle.textContent = `Loading Report #${reportId}...`;
    modalBody.innerHTML = `<div style="text-align: center; padding: 40px;"><div class="spinner" style="border-top-color: var(--primary);"></div></div>`;
    detailModal.classList.add('active');

    try {
      const res = await fetch(`/api/reports/${reportId}`);
      if (!res.ok) throw new Error('Failed to load details.');
      const report = await res.json();

      modalReportTitle.textContent = `Report #${report.id} - ${report.site}`;

      const hasProblems = report.problem_count > 0;
      const statusBadge = hasProblems
        ? `<span class="badge badge-problem">⚠️ ${report.problem_count} Issue(s) (NO)</span>`
        : `<span class="badge badge-ok">✓ All Items YES / OK</span>`;

      // Group items by section
      const sectionsMap = {};
      (report.items || []).forEach((it) => {
        if (!sectionsMap[it.section]) {
          sectionsMap[it.section] = [];
        }
        sectionsMap[it.section].push(it);
      });

      let itemsHtml = '';
      for (const [sectionName, items] of Object.entries(sectionsMap)) {
        itemsHtml += `
          <div class="section-group-title">
            <span>📂</span> ${escapeHtml(sectionName)}
          </div>
        `;

        items.forEach((item) => {
          const isProb = item.status === 'problem' || item.status === 'no';
          const isYes = item.status === 'ok' || item.status === 'yes';
          const badgeClass = isProb ? 'badge-problem' : isYes ? 'badge-ok' : 'badge-na';
          const statusText = isProb ? '✕ NO' : isYes ? '✓ YES' : '— N/A';

          itemsHtml += `
            <div class="detail-item-row ${isProb ? 'is-problem' : ''}">
              <div class="detail-item-header">
                <span class="detail-item-name">${escapeHtml(item.item)}</span>
                <span class="badge ${badgeClass}">${statusText}</span>
              </div>
              ${item.method ? `
                <div style="font-size: 0.8rem; color: #1e3a8a; background: #eff6ff; padding: 4px 8px; border-radius: 4px; margin-top: 4px; border-left: 3px solid #3b82f6;">
                  <strong>Method:</strong> ${escapeHtml(item.method)}
                </div>
              ` : ''}
              ${isProb && item.note ? `
                <div class="problem-callout">
                  <strong>Notes:</strong> ${escapeHtml(item.note)}
                </div>
              ` : ''}
              ${item.photo_path ? `
                <div class="problem-photo-preview">
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">Photo Attachment (click to enlarge):</div>
                  <img class="problem-photo-img" src="${escapeHtml(item.photo_path)}" alt="Problem photo" data-full="${escapeHtml(item.photo_path)}">
                </div>
              ` : ''}
            </div>
          `;
        });
      }

      modalBody.innerHTML = `
        <div class="detail-summary-card">
          <div class="detail-grid">
            <div>
              <div class="detail-item-title">Location / Site</div>
              <div class="detail-item-val">${escapeHtml(report.site)}</div>
            </div>
            <div>
              <div class="detail-item-title">Drive Details</div>
              <div class="detail-item-val">${report.drive_details ? escapeHtml(report.drive_details) : '—'}</div>
            </div>
            <div>
              <div class="detail-item-title">Inspector Name</div>
              <div class="detail-item-val">${escapeHtml(report.employee_name)}</div>
            </div>
            <div>
              <div class="detail-item-title">Date & Time</div>
              <div class="detail-item-val">${formatDateTime(report.created_at)}</div>
            </div>
            <div>
              <div class="detail-item-title">Overall Status</div>
              <div class="detail-item-val">${statusBadge}</div>
            </div>
          </div>
          ${report.remarks ? `
            <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-color);">
              <div class="detail-item-title">Remarks / Observations:</div>
              <div style="margin-top: 4px; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(report.remarks)}</div>
            </div>
          ` : ''}
        </div>

        <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 6px;">Checklist Verification Breakdown</h4>
        ${itemsHtml}
      `;

      // Attach lightbox handler to photos
      modalBody.querySelectorAll('.problem-photo-img').forEach((img) => {
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          lightboxImg.src = img.getAttribute('data-full');
          lightboxOverlay.classList.add('active');
        });
      });

    } catch (err) {
      modalBody.innerHTML = `<div style="color: var(--problem-color); padding: 20px;">Failed to load report detail.</div>`;
    }
  }

  // Master QR Modal Handlers
  async function openMasterQr() {
    masterQrModal.classList.add('active');
    try {
      const res = await fetch('/api/qr/master');
      const data = await res.json();
      if (data.qrDataUrl) {
        adminQrImage.src = data.qrDataUrl;
        adminQrUrl.href = data.targetUrl;
        adminQrUrl.textContent = data.targetUrl;
      }
    } catch (e) {
      console.error('Failed to load master QR:', e);
    }
  }

  if (showMasterQrBtn) {
    showMasterQrBtn.addEventListener('click', openMasterQr);
  }
  if (closeMasterQrBtn) {
    closeMasterQrBtn.addEventListener('click', () => masterQrModal.classList.remove('active'));
  }
  if (closeMasterQrBtn2) {
    closeMasterQrBtn2.addEventListener('click', () => masterQrModal.classList.remove('active'));
  }
  if (masterQrModal) {
    masterQrModal.addEventListener('click', (e) => {
      if (e.target === masterQrModal) masterQrModal.classList.remove('active');
    });
  }

  // Close Modals
  function closeModal() {
    detailModal.classList.remove('active');
    currentViewingReportId = null;
  }

  // Delete a single report
  async function deleteSingleReport(reportId, siteName) {
    const siteLabel = siteName ? ` for "${siteName}"` : '';
    if (!confirm(`Are you sure you want to permanently delete Report #${reportId}${siteLabel}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete report.');
      }
      closeModal();
      await loadReports();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  // Modal Delete Button
  if (modalDeleteBtn) {
    modalDeleteBtn.addEventListener('click', () => {
      if (currentViewingReportId) {
        deleteSingleReport(currentViewingReportId);
      }
    });
  }

  // Clear All Reports Button
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('⚠️ Are you sure you want to delete ALL inspection reports? This will reset the database clean.')) {
        return;
      }
      try {
        const res = await fetch('/api/reports', { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete all reports.');
        await loadReports();
      } catch (err) {
        alert(`Clear all failed: ${err.message}`);
      }
    });
  }

  closeModalBtn.addEventListener('click', closeModal);
  modalCloseActionBtn.addEventListener('click', closeModal);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeModal();
  });

  lightboxOverlay.addEventListener('click', () => {
    lightboxOverlay.classList.remove('active');
  });

  // Filters Event Listeners
  filterSite.addEventListener('change', loadReports);
  filterStartDate.addEventListener('change', loadReports);
  filterEndDate.addEventListener('change', loadReports);
  filterProblemsOnly.addEventListener('change', loadReports);
  filterSearch.addEventListener('input', renderReportsList);

  resetFiltersBtn.addEventListener('click', () => {
    filterSite.value = 'all';
    filterStartDate.value = '';
    filterEndDate.value = '';
    filterProblemsOnly.checked = false;
    filterSearch.value = '';
    loadReports();
  });

  // Download CSV Export
  downloadCsvBtn.addEventListener('click', () => {
    const params = new URLSearchParams();
    if (filterSite.value && filterSite.value !== 'all') {
      params.append('site', filterSite.value);
    }
    if (filterStartDate.value) {
      params.append('startDate', filterStartDate.value);
    }
    if (filterEndDate.value) {
      params.append('endDate', filterEndDate.value);
    }
    if (filterProblemsOnly.checked) {
      params.append('problemsOnly', 'true');
    }
    window.location.href = `/api/export.csv?${params.toString()}`;
  });

  // Download SQLite Database File Backup (.db)
  const downloadDbBtn = document.getElementById('downloadDbBtn');
  if (downloadDbBtn) {
    downloadDbBtn.addEventListener('click', () => {
      window.location.href = '/api/admin/database/backup';
    });
  }

  // Helper: Format Date & Time
  function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

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
