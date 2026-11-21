/**
 * ABB Drive Commissioning Checklist - Client Logic
 * Created by Ronak Ghosh (ph: 9242217345, email: ronakghosh461@gmail.com)
 */

(function () {
  'use strict';

  // State
  let checklistData = [];
  let itemsState = []; // [{ index, section, item, method, status: null|'yes'|'no'|'na', allow_na }]
  let currentLocation = 'Site Inspection';

  // DOM Elements
  const siteLocationDisplay = document.getElementById('siteLocationDisplay');
  const locationInput = document.getElementById('locationInput');
  const driveDetailsInput = document.getElementById('driveDetailsInput');
  const employeeNameInput = document.getElementById('employeeNameInput');
  const remarksInput = document.getElementById('remarksInput');
  const checklistContainer = document.getElementById('checklistContainer');
  const progressCount = document.getElementById('progressCount');
  const progressFill = document.getElementById('progressFill');
  const submitBtn = document.getElementById('submitBtn');
  const submitBtnSpinner = document.getElementById('submitBtnSpinner');
  const submitBtnText = document.getElementById('submitBtnText');
  const errorAlert = document.getElementById('errorAlert');
  const errorList = document.getElementById('errorList');
  const formSection = document.getElementById('formSection');
  const successSection = document.getElementById('successSection');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // Success Elements
  const successEmployee = document.getElementById('successEmployee');
  const successSite = document.getElementById('successSite');
  const successDriveDetails = document.getElementById('successDriveDetails');
  const successStepsCount = document.getElementById('successStepsCount');
  const successTime = document.getElementById('successTime');
  const submitAnotherBtn = document.getElementById('submitAnotherBtn');

  // 1. Initialize Theme (Default to Light Theme, Dark theme as option)
  function initTheme() {
    const savedTheme = localStorage.getItem('qr_checklist_theme');
    // Always default to Light theme per user instruction
    const initialTheme = savedTheme === 'dark' ? 'dark' : 'light';
    applyTheme(initialTheme);

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

  // 2. Initialize Location & Date
  function initLocation() {
    const params = new URLSearchParams(window.location.search);
    const siteParam = params.get('site');
    
    // Only pre-fill input if a real specific site was passed (not generic "Site-Inspection")
    if (siteParam && siteParam.trim().length > 0 && !['site-inspection', 'general'].includes(siteParam.toLowerCase())) {
      currentLocation = siteParam.trim();
      if (locationInput) {
        locationInput.value = currentLocation;
      }
    } else {
      currentLocation = 'Site Inspection';
      if (locationInput) {
        locationInput.value = ''; // Kept empty so "e.g. Substation-2 / Pump Room A" is 100% visible!
      }
    }

    if (locationInput) {
      locationInput.addEventListener('input', (e) => {
        currentLocation = e.target.value.trim() || 'Site Inspection';
        if (siteLocationDisplay) {
          siteLocationDisplay.textContent = currentLocation;
        }
      });
    }

    if (siteLocationDisplay) {
      siteLocationDisplay.textContent = currentLocation;
    }

    const dateBadge = document.getElementById('currentDateBadge');
    if (dateBadge) {
      dateBadge.textContent = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  // 3. Load Checklist Configuration from Server
  async function loadChecklist() {
    try {
      const response = await fetch('/api/config/checklist');
      if (!response.ok) {
        throw new Error('Failed to load checklist definition.');
      }
      checklistData = await response.json();
      buildChecklistUI();
    } catch (err) {
      console.error(err);
      checklistContainer.innerHTML = `
        <div class="card" style="border-color: var(--problem-color); text-align: center; color: var(--problem-color);">
          <p><strong>Failed to load commissioning checklist.</strong></p>
          <p style="font-size: 0.85rem; margin-top: 8px;">Please check connection and refresh.</p>
        </div>
      `;
    }
  }

  // 4. Build Checklist UI
  function buildChecklistUI() {
    checklistContainer.innerHTML = '';
    itemsState = [];
    let globalIndex = 0;

    const stageIcons = {
      'Before Power On': '🔌',
      'During Power Up': '⚡',
      'After Power Up': '⚙️'
    };

    checklistData.forEach((stageGroup, stageIdx) => {
      const stageName = stageGroup.stage || stageGroup.section || `Stage ${stageIdx + 1}`;
      const card = document.createElement('div');
      card.className = 'card stage-card';

      const icon = stageIcons[stageName] || '📋';
      const title = document.createElement('h2');
      title.className = 'card-title';
      title.innerHTML = `
        <span class="section-badge">${icon} ${escapeHtml(stageName)}</span>
        <span class="stage-count">(${stageGroup.items.length} steps)</span>
      `;
      card.appendChild(title);

      stageGroup.items.forEach((itemObj) => {
        const itemIdx = globalIndex++;
        const stepDesc = typeof itemObj === 'string' ? itemObj : (itemObj.step || itemObj.item);
        const methodDesc = typeof itemObj === 'object' ? itemObj.method : '';
        const allowNa = true; // All options have N/A per specification

        itemsState.push({
          index: itemIdx,
          section: stageName,
          item: stepDesc,
          method: methodDesc,
          status: null,
          allow_na: allowNa
        });

        const itemEl = document.createElement('div');
        itemEl.className = 'checklist-item';
        itemEl.id = `item-row-${itemIdx}`;

        // Build HTML for buttons (YES, NO, and optional N/A)
        // Notice: NO option is only clickable, no notes box!
        let buttonsHtml = `
          <div class="btn-group ${allowNa ? 'has-na' : 'two-choice'}" role="group" aria-label="Status for ${escapeHtml(stepDesc)}">
            <button type="button" class="btn-choice choice-yes" data-idx="${itemIdx}" data-val="yes">
              <span class="btn-icon">✓</span> YES
            </button>
            <button type="button" class="btn-choice choice-no" data-idx="${itemIdx}" data-val="no">
              <span class="btn-icon">✕</span> NO
            </button>
        `;

        if (allowNa) {
          buttonsHtml += `
            <button type="button" class="btn-choice choice-na" data-idx="${itemIdx}" data-val="na">
              <span class="btn-icon">—</span> N/A
            </button>
          `;
        }

        buttonsHtml += `</div>`;

        itemEl.innerHTML = `
          <div class="item-header-row">
            <span class="item-index-badge">${itemIdx + 1}</span>
            <div class="item-text">${escapeHtml(stepDesc)}</div>
          </div>
          ${methodDesc ? `
            <div class="method-callout">
              <span class="method-tag">Verification Method:</span>
              <span class="method-desc">${escapeHtml(methodDesc)}</span>
            </div>
          ` : ''}
          ${buttonsHtml}
        `;

        card.appendChild(itemEl);
      });

      checklistContainer.appendChild(card);
    });

    attachItemEventListeners();
    updateProgress();
  }

  // 5. Attach Item Event Listeners
  function attachItemEventListeners() {
    checklistContainer.querySelectorAll('.btn-choice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const itemIdx = parseInt(btn.getAttribute('data-idx'), 10);
        const choice = btn.getAttribute('data-val');
        setItemStatus(itemIdx, choice);
      });
    });
  }

  // 6. Set Item Status (Only Clickable, no notes pop-up!)
  function setItemStatus(itemIdx, status) {
    itemsState[itemIdx].status = status;

    const row = document.getElementById(`item-row-${itemIdx}`);
    if (!row) return;

    // Reset styles
    row.classList.remove('answered-yes', 'answered-no', 'answered-na', 'has-error');
    row.classList.add(`answered-${status}`);

    // Update active button state
    const buttons = row.querySelectorAll('.btn-choice');
    buttons.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-val') === status);
    });

    updateProgress();
  }

  // 7. Update Progress Bar
  function updateProgress() {
    const total = itemsState.length;
    if (total === 0) return;

    const answered = itemsState.filter((it) => it.status !== null).length;
    progressCount.textContent = `${answered} of ${total} verified`;

    const percentage = Math.round((answered / total) * 100);
    progressFill.style.width = `${percentage}%`;

    if (answered === total) {
      progressFill.style.background = 'linear-gradient(90deg, #10b981, #059669)';
    } else {
      progressFill.style.background = 'linear-gradient(90deg, #ff000f, #10b981)';
    }
  }

  // 8. Validate Form
  function validateForm() {
    const errors = [];
    let firstErrorElement = null;

    document.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
    errorAlert.classList.remove('visible');
    errorList.innerHTML = '';

    // Check Location
    const locVal = locationInput.value.trim();
    if (!locVal) {
      errors.push('Please enter the Location.');
      locationInput.classList.add('has-error');
      if (!firstErrorElement) firstErrorElement = locationInput;
    }

    // Check Inspector Name
    const nameVal = employeeNameInput.value.trim();
    if (!nameVal || nameVal.length < 2) {
      errors.push('Please enter your Inspector Name (minimum 2 characters).');
      employeeNameInput.classList.add('has-error');
      if (!firstErrorElement) firstErrorElement = employeeNameInput;
    }

    // Check Unanswered Steps
    const unansweredSteps = [];
    itemsState.forEach((it) => {
      const row = document.getElementById(`item-row-${it.index}`);
      if (it.status === null) {
        unansweredSteps.push(`Step ${it.index + 1}: "${it.item}"`);
        if (row) row.classList.add('has-error');
        if (!firstErrorElement && row) firstErrorElement = row;
      }
    });

    if (unansweredSteps.length > 0) {
      errors.push(`Please answer all checklist steps (${unansweredSteps.length} remaining).`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      firstErrorElement
    };
  }

  // 9. Handle Submit
  async function handleSubmit() {
    const validation = validateForm();

    if (!validation.isValid) {
      errorList.innerHTML = validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
      errorAlert.classList.add('visible');

      if (validation.firstErrorElement) {
        validation.firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // Prepare FormData
    const formData = new FormData();
    formData.append('employee_name', employeeNameInput.value.trim());
    formData.append('site', locationInput.value.trim() || currentLocation);
    formData.append('drive_details', driveDetailsInput ? driveDetailsInput.value.trim() : '');
    formData.append('remarks', remarksInput.value.trim());

    // Prepare items payload (clean: section, item, method, status)
    const itemsPayload = itemsState.map((it) => ({
      section: it.section,
      item: it.item,
      method: it.method,
      status: it.status
    }));

    formData.append('items', JSON.stringify(itemsPayload));

    // Disable button & show spinner
    submitBtn.disabled = true;
    submitBtnSpinner.style.display = 'inline-block';
    submitBtnText.textContent = 'Submitting Checklist...';

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit checklist.');
      }

      showSuccessScreen(result);
    } catch (err) {
      console.error('Submission error:', err);
      alert('Error submitting checklist: ' + err.message);
      submitBtn.disabled = false;
      submitBtnSpinner.style.display = 'none';
      submitBtnText.textContent = 'Submit Commissioning Checklist';
    }
  }

  // 10. Show Success Confirmation Screen
  function showSuccessScreen(result) {
    formSection.style.display = 'none';
    successSection.classList.add('visible');

    if (successEmployee) successEmployee.textContent = employeeNameInput.value.trim();
    if (successSite) successSite.textContent = locationInput.value.trim() || currentLocation;
    if (successDriveDetails) {
      successDriveDetails.textContent = (driveDetailsInput && driveDetailsInput.value.trim()) ? driveDetailsInput.value.trim() : 'N/A';
    }
    if (successStepsCount) {
      successStepsCount.textContent = `${itemsState.length} of ${itemsState.length} verified`;
    }
    if (successTime) {
      successTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date().toLocaleDateString();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Event Listeners
  submitBtn.addEventListener('click', handleSubmit);
  submitAnotherBtn.addEventListener('click', () => {
    window.location.reload();
  });

  // Init
  initTheme();
  initLocation();
  loadChecklist();
})();
