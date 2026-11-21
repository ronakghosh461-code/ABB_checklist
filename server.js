require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const os = require('os');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const db = require('./database/db');
const { sendProblemAlert } = require('./utils/mailer');
const { startCloudflareTunnel, getPublicUrl } = require('./tunnel');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const AUTH_SECRET = process.env.AUTH_SECRET || 'qr-checklist-secret-key-change-in-production';

// Ensure uploads folder exists inside public/
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage configuration for problem photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];
  if (allowedMimes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WEBP, GIF) are allowed for problem photos.'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiter for report submission (protects against spam/DDoS)
const reportSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each IP to 60 reports per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this connection. Please wait a few minutes before trying again.' }
});

// Admin Auth Helper Functions
function generateAuthToken(password) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(password).digest('hex');
}

const EXPECTED_TOKEN = generateAuthToken(ADMIN_PASSWORD);

function checkAdminAuth(req) {
  const token = req.cookies.admin_token || req.headers['x-admin-token'] || 
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  return token === EXPECTED_TOKEN;
}

function requireAdmin(req, res, next) {
  if (checkAdminAuth(req)) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Please log in as admin.' });
}

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------

// Serve static assets from public
app.use(express.static(path.join(__dirname, 'public')));

// Specific HTML page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// Single Master QR Page
app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master_qr.html'));
});

// Master QR Code API (Automatically targets public tunnel or local network IP)
app.get('/api/qr/master', async (req, res) => {
  try {
    const site = (req.query.site || 'Site-Inspection').trim();
    const localIp = getLocalIpAddress();
    const publicTunnel = getPublicUrl();

    // Prioritize public tunnel if available so ANY phone on 4G/5G can open it!
    let targetBase = publicTunnel;
    if (!targetBase) {
      targetBase = process.env.BASE_URL && !process.env.BASE_URL.includes('localhost') 
        ? process.env.BASE_URL 
        : `http://${localIp}:${PORT}`;
    }
    const targetUrl = `${targetBase}/?site=${encodeURIComponent(site)}`;
    const localUrl = `http://${localIp}:${PORT}/?site=${encodeURIComponent(site)}`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      isPublic: Boolean(publicTunnel),
      publicUrl: publicTunnel ? `${publicTunnel}/?site=${encodeURIComponent(site)}` : null,
      localUrl,
      targetUrl,
      site,
      qrDataUrl
    });
  } catch (err) {
    console.error('Error generating master QR:', err);
    res.status(500).json({ error: 'Failed to generate master QR.' });
  }
});

// Database Backup & Direct Download (Admin)
app.get('/api/admin/database/backup', requireAdmin, (req, res) => {
  const dbFile = path.join(__dirname, 'data', 'checklist.db');
  res.download(dbFile, 'abb-site-checklist-database.db');
});

app.get('/api/admin/database/summary', requireAdmin, (req, res) => {
  res.json(db.getDatabaseSummary());
});

// -------------------------------------------------------------
// API: Checklist Configuration
// -------------------------------------------------------------
app.get('/api/config/checklist', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config', 'checklist.json');
    if (!fs.existsSync(configPath)) {
      return res.status(500).json({ error: 'Checklist configuration not found on server.' });
    }
    const data = fs.readFileSync(configPath, 'utf8');
    const checklist = JSON.parse(data);
    res.json(checklist);
  } catch (err) {
    console.error('Error reading checklist config:', err);
    res.status(500).json({ error: 'Failed to load checklist configuration.' });
  }
});

// -------------------------------------------------------------
// API: Report Submission (Public, Rate-Limited)
// -------------------------------------------------------------
app.post('/api/reports', reportSubmitLimiter, upload.any(), async (req, res) => {
  try {
    const employee_name = req.body.employee_name ? req.body.employee_name.trim() : '';
    const employee_id = req.body.employee_id ? req.body.employee_id.trim() : '';
    const site = req.body.site ? req.body.site.trim() : 'Site Inspection';
    const drive_details = req.body.drive_details ? req.body.drive_details.trim() : '';
    const remarks = req.body.remarks ? req.body.remarks.trim() : '';

    // Validation: Employee Name
    if (!employee_name || employee_name.length < 2) {
      return res.status(400).json({ error: 'Name is required (at least 2 characters).' });
    }

    // Parse items
    let items = [];
    if (typeof req.body.items === 'string') {
      try {
        items = JSON.parse(req.body.items);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid items payload format.' });
      }
    } else if (Array.isArray(req.body.items)) {
      items = req.body.items;
    } else {
      return res.status(400).json({ error: 'Checklist items are required.' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Checklist cannot be empty.' });
    }

    // Map uploaded files to items
    const uploadedFiles = req.files || [];
    const fileMap = {};
    for (const file of uploadedFiles) {
      const match = file.fieldname.match(/(?:photo[-_\[])(\d+)/i);
      if (match) {
        const itemIdx = parseInt(match[1], 10);
        fileMap[itemIdx] = `/uploads/${file.filename}`;
      } else {
        fileMap[file.fieldname] = `/uploads/${file.filename}`;
      }
    }

    // Validate each item (Only clickable: no mandatory note!)
    const validatedItems = [];
    const problems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.section || !it.item) {
        return res.status(400).json({ error: `Item at index ${i + 1} is missing section or step description.` });
      }

      const rawStatus = (it.status || '').toLowerCase().trim();
      let status = rawStatus;
      if (['yes', 'ok'].includes(rawStatus)) status = 'yes';
      else if (['no', 'problem'].includes(rawStatus)) status = 'no';
      else if (['na', 'n/a'].includes(rawStatus)) status = 'na';
      else {
        return res.status(400).json({ 
          error: `Please select YES or NO for step: "${it.item}"` 
        });
      }

      const note = it.note ? it.note.trim() : null;
      const method = it.method ? it.method.trim() : null;
      const photoPath = fileMap[i] || fileMap[`photo_${i}`] || it.photo_path || null;

      const itemRecord = {
        section: it.section,
        item: it.item,
        method,
        status,
        note,
        photo_path: photoPath
      };

      validatedItems.push(itemRecord);
      if (status === 'no') {
        problems.push(itemRecord);
      }
    }

    // Save report & items to SQLite
    const { reportId, problemCount } = db.createReport(
      { employee_name, employee_id, site, drive_details, remarks },
      validatedItems
    );

    // If there is at least one issue, send email notification (optional)
    if (problemCount > 0) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

      sendProblemAlert({
        reportId,
        employeeName: employee_name,
        employeeId: employee_id,
        site: `${site} (${drive_details || 'Drive Details'})`,
        createdAt: new Date().toLocaleString(),
        problems,
        baseUrl
      }).catch(err => {
        console.warn('Background notification error:', err.message);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Checklist submitted successfully',
      reportId,
      site,
      drive_details,
      problemCount
    });
  } catch (err) {
    console.error('Error submitting report:', err);
    res.status(500).json({ error: 'Internal server error while saving report.' });
  }
});

// -------------------------------------------------------------
// API: Admin Authentication
// -------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password === ADMIN_PASSWORD) {
    const token = EXPECTED_TOKEN;
    res.cookie('admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    return res.json({ success: true, message: 'Logged in successfully', token });
  } else {
    return res.status(401).json({ error: 'Incorrect password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/admin/check-auth', (req, res) => {
  const isAuthenticated = checkAdminAuth(req);
  res.json({ authenticated: isAuthenticated });
});

// -------------------------------------------------------------
// API: Admin Reports Listing & Details
// -------------------------------------------------------------
app.get('/api/reports', requireAdmin, (req, res) => {
  try {
    const { site, startDate, endDate, problemsOnly } = req.query;
    const reports = db.getReports({ site, startDate, endDate, problemsOnly });
    const stats = db.getStats();
    const sites = db.getDistinctSites();
    res.json({ reports, stats, sites });
  } catch (err) {
    console.error('Error fetching reports:', err);
    res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

app.get('/api/reports/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }
    const report = db.getReportById(id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json(report);
  } catch (err) {
    console.error('Error fetching report details:', err);
    res.status(500).json({ error: 'Failed to fetch report details.' });
  }
});

// Delete a single report by ID (Admin only)
app.delete('/api/reports/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }
    const success = db.deleteReport(id);
    if (!success) {
      return res.status(404).json({ error: 'Report not found or already deleted' });
    }
    res.json({ success: true, message: `Report #${id} deleted successfully` });
  } catch (err) {
    console.error('Error deleting report:', err);
    res.status(500).json({ error: 'Failed to delete report.' });
  }
});

// Clear all reports (Admin reset)
app.delete('/api/reports', requireAdmin, (req, res) => {
  try {
    db.deleteAllReports();
    res.json({ success: true, message: 'All reports deleted successfully' });
  } catch (err) {
    console.error('Error clearing reports:', err);
    res.status(500).json({ error: 'Failed to clear reports.' });
  }
});

// -------------------------------------------------------------
// API: CSV Export (One row per checklist item)
// -------------------------------------------------------------
app.get('/api/export.csv', requireAdmin, (req, res) => {
  try {
    const { site, startDate, endDate, problemsOnly } = req.query;
    const items = db.getAllItemsForExport({ site, startDate, endDate, problemsOnly });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

    // Helper to escape CSV cell (RFC 4180 standard)
    const csvEscape = (value) => {
      if (value === null || value === undefined) return '""';
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      'Report ID',
      'Inspector Name',
      'Location / Site',
      'Drive Details',
      'Submitted Date/Time',
      'Stage',
      'Step Description',
      'Verification Method',
      'Status (YES/NO/NA)',
      'Notes / Details',
      'Photo URL',
      'Overall Remarks',
      'Total Issues Flagged (NO Count)'
    ];

    const rows = items.map(item => {
      const photoUrl = item.photo_path ? `${baseUrl}${item.photo_path}` : '';
      return [
        csvEscape(item.report_id),
        csvEscape(item.employee_name),
        csvEscape(item.site),
        csvEscape(item.drive_details || ''),
        csvEscape(item.created_at),
        csvEscape(item.section),
        csvEscape(item.item),
        csvEscape(item.method || ''),
        csvEscape(item.status.toUpperCase()),
        csvEscape(item.problem_note || ''),
        csvEscape(photoUrl),
        csvEscape(item.report_remarks || ''),
        csvEscape(item.problem_count)
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(csvEscape).join(','), ...rows].join('\r\n');

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qr-site-checklist-reports-${dateStr}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    res.status(500).json({ error: 'Failed to generate CSV export.' });
  }
});

// -------------------------------------------------------------
// API: QR Code Generator
// -------------------------------------------------------------
app.post('/api/admin/generate-qr', requireAdmin, async (req, res) => {
  try {
    const { sites, baseUrl } = req.body;
    if (!Array.isArray(sites) || sites.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one site name.' });
    }

    const hostBaseUrl = baseUrl || process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

    const results = [];
    for (const rawSite of sites) {
      const site = (rawSite || '').trim();
      if (!site) continue;

      const targetUrl = `${hostBaseUrl}/?site=${encodeURIComponent(site)}`;
      const qrDataUrl = await QRCode.toDataURL(targetUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 320,
        color: {
          dark: '#111827',
          light: '#ffffff'
        }
      });

      results.push({
        site,
        url: targetUrl,
        qrDataUrl
      });
    }

    res.json({ success: true, count: results.length, qrCodes: results });
  } catch (err) {
    console.error('Error generating QR codes:', err);
    res.status(500).json({ error: 'Failed to generate QR codes.' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`===================================================`);
  console.log(`🚀 ABB Commissioning System Running Locally!`);
  console.log(`👉 Checklist Form:   http://localhost:${PORT}`);
  console.log(`👉 Admin Database:   http://localhost:${PORT}/admin`);
  console.log(`💻 Local Network:    http://${localIp}:${PORT}`);
  console.log(`🔑 Admin Password:   ${ADMIN_PASSWORD}`);
  console.log(`===================================================`);

  // Start Cloudflare Tunnel for universal worldwide phone access on 4G/5G
  startCloudflareTunnel(PORT);
});

module.exports = app;
