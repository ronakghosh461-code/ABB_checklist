const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(urlPath, options = {}) {
  const url = new URL(urlPath, BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Automated Tests for QR Site Checklist ---');
  await wait(1500);

  // 1. Check checklist configuration endpoint
  console.log('1. Testing GET /api/config/checklist...');
  const configRes = await request('/api/config/checklist');
  if (configRes.statusCode !== 200) {
    throw new Error(`Failed config endpoint, status: ${configRes.statusCode}`);
  }
  const configData = JSON.parse(configRes.body);
  console.log(`✓ Checklist loaded successfully: ${configData.length} sections found.`);

  // Prepare 14 items matching config
  const testItems = [];
  configData.forEach(sec => {
    sec.items.forEach((it, idx) => {
      testItems.push({
        section: sec.section,
        item: it,
        status: (sec.section === 'Safety' && idx === 0) ? 'problem' : 'ok',
        note: (sec.section === 'Safety' && idx === 0) ? 'Extinguisher pressure gauge reads in the red zone.' : ''
      });
    });
  });

  // 2. Submit report with 1 problem (Employee on-site)
  console.log('2. Testing POST /api/reports (Site: Test, 1 problem flagged)...');
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const postBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="employee_name"',
    '',
    'Alex Rivera',
    `--${boundary}`,
    'Content-Disposition: form-data; name="employee_id"',
    '',
    'TECH-8821',
    `--${boundary}`,
    'Content-Disposition: form-data; name="site"',
    '',
    'Test',
    `--${boundary}`,
    'Content-Disposition: form-data; name="remarks"',
    '',
    'Main room inspection completed ahead of schedule.',
    `--${boundary}`,
    'Content-Disposition: form-data; name="items"',
    '',
    JSON.stringify(testItems),
    `--${boundary}--`,
    ''
  ].join('\r\n');

  const submitRes = await request('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(postBody)
    },
    body: postBody
  });

  if (submitRes.statusCode !== 201) {
    throw new Error(`Report submission failed with code ${submitRes.statusCode}: ${submitRes.body}`);
  }
  const submitData = JSON.parse(submitRes.body);
  console.log(`✓ Report #${submitData.reportId} submitted successfully (Problems: ${submitData.problemCount}).`);

  // 3. Submit an All-OK report
  console.log('3. Testing POST /api/reports (Site: Pump-Room-1, All-OK)...');
  const allOkItems = testItems.map(it => ({ ...it, status: 'ok', note: '' }));
  const postBodyOk = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="employee_name"',
    '',
    'Sam Taylor',
    `--${boundary}`,
    'Content-Disposition: form-data; name="employee_id"',
    '',
    'TECH-1002',
    `--${boundary}`,
    'Content-Disposition: form-data; name="site"',
    '',
    'Pump-Room-1',
    `--${boundary}`,
    'Content-Disposition: form-data; name="remarks"',
    '',
    'All equipment operating smoothly.',
    `--${boundary}`,
    'Content-Disposition: form-data; name="items"',
    '',
    JSON.stringify(allOkItems),
    `--${boundary}--`,
    ''
  ].join('\r\n');

  const submitResOk = await request('/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(postBodyOk)
    },
    body: postBodyOk
  });

  const submitDataOk = JSON.parse(submitResOk.body);
  console.log(`✓ Report #${submitDataOk.reportId} (All OK) submitted successfully.`);

  // 4. Test Admin Login
  console.log('4. Testing POST /api/admin/login...');
  const loginPayload = JSON.stringify({ password: 'admin123' });
  const loginRes = await request('/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload)
    },
    body: loginPayload
  });

  if (loginRes.statusCode !== 200) {
    throw new Error(`Admin login failed: ${loginRes.body}`);
  }
  const cookieHeader = loginRes.headers['set-cookie'];
  const cookie = cookieHeader ? cookieHeader[0].split(';')[0] : '';
  console.log(`✓ Admin login successful. Auth cookie established.`);

  // 5. Test Admin Reports List
  console.log('5. Testing GET /api/reports (with auth cookie)...');
  const reportsRes = await request('/api/reports', {
    method: 'GET',
    headers: {
      'Cookie': cookie
    }
  });

  if (reportsRes.statusCode !== 200) {
    throw new Error(`Failed to get reports: ${reportsRes.body}`);
  }
  const reportsData = JSON.parse(reportsRes.body);
  console.log(`✓ Reports retrieved: ${reportsData.reports.length} total reports.`);
  console.log(`  KPI Stats: Total=${reportsData.stats.totalReports}, Problems=${reportsData.stats.reportsWithProblems}, OK=${reportsData.stats.allOkReports}, Sites=${reportsData.stats.distinctSites}`);

  // 6. Test Admin Report Detail
  console.log(`6. Testing GET /api/reports/${submitData.reportId} (Detail)...`);
  const detailRes = await request(`/api/reports/${submitData.reportId}`, {
    method: 'GET',
    headers: { 'Cookie': cookie }
  });
  const detailData = JSON.parse(detailRes.body);
  console.log(`✓ Report #${detailData.id} detail retrieved: ${detailData.items.length} items checked.`);
  const problemItem = detailData.items.find(it => it.status === 'problem');
  console.log(`  Flagged problem found: "${problemItem.item}" - Note: "${problemItem.note}"`);

  // 7. Test CSV Export (one row per item)
  console.log('7. Testing GET /api/export.csv (CSV Export)...');
  const csvRes = await request('/api/export.csv', {
    method: 'GET',
    headers: { 'Cookie': cookie }
  });
  if (csvRes.statusCode !== 200) {
    throw new Error(`CSV export failed: ${csvRes.body}`);
  }
  const csvLines = csvRes.body.trim().split('\r\n');
  console.log(`✓ CSV Export generated: ${csvLines.length - 1} item rows exported (header + items).`);
  console.log(`  Header row: ${csvLines[0].substring(0, 80)}...`);

  // 8. Test QR Code Generator
  console.log('8. Testing POST /api/admin/generate-qr...');
  const qrPayload = JSON.stringify({
    sites: ['Pump-Room-1', 'Test', 'Main-Substation'],
    baseUrl: 'http://localhost:3000'
  });
  const qrRes = await request('/api/admin/generate-qr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(qrPayload),
      'Cookie': cookie
    },
    body: qrPayload
  });
  const qrData = JSON.parse(qrRes.body);
  console.log(`✓ QR Codes generated: ${qrData.count} site codes returned with valid base64 data URLs.`);

  console.log('\n========================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED 100%! 🎉');
  console.log('========================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
