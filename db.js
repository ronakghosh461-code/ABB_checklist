const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'checklist.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    employee_id TEXT,
    site TEXT NOT NULL,
    drive_details TEXT,
    remarks TEXT,
    problem_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    item TEXT NOT NULL,
    method TEXT,
    status TEXT NOT NULL,
    note TEXT,
    photo_path TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_site ON reports(site);
  CREATE INDEX IF NOT EXISTS idx_report_items_report_id ON report_items(report_id);
`);

// Migration for existing databases
try {
  db.exec(`ALTER TABLE reports ADD COLUMN drive_details TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE report_items ADD COLUMN method TEXT;`);
} catch (e) {}

// If report_items had a strict CHECK constraint, migrate to flexible schema
try {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='report_items'").get()?.sql || '';
  if (tableSql.includes('CHECK(')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS report_items_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        section TEXT NOT NULL,
        item TEXT NOT NULL,
        method TEXT,
        status TEXT NOT NULL,
        note TEXT,
        photo_path TEXT
      );
      INSERT OR IGNORE INTO report_items_temp (id, report_id, section, item, method, status, note, photo_path)
        SELECT id, report_id, section, item, method, status, note, photo_path FROM report_items;
      DROP TABLE report_items;
      ALTER TABLE report_items_temp RENAME TO report_items;
      CREATE INDEX IF NOT EXISTS idx_report_items_report_id ON report_items(report_id);
    `);
  }
} catch (e) {
  console.warn('Migration note:', e.message);
}

/**
 * Insert a new report along with all its items in a single transaction
 */
const insertReportTransaction = db.transaction((reportData, items) => {
  const problemCount = items.filter(it => it.status === 'no' || it.status === 'problem').length;

  const insertReportStmt = db.prepare(`
    INSERT INTO reports (employee_name, employee_id, site, drive_details, remarks, problem_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  const info = insertReportStmt.run(
    reportData.employee_name.trim(),
    reportData.employee_id ? reportData.employee_id.trim() : null,
    reportData.site.trim(),
    reportData.drive_details ? reportData.drive_details.trim() : null,
    reportData.remarks ? reportData.remarks.trim() : null,
    problemCount
  );

  const reportId = info.lastInsertRowid;

  const insertItemStmt = db.prepare(`
    INSERT INTO report_items (report_id, section, item, method, status, note, photo_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    insertItemStmt.run(
      reportId,
      item.section.trim(),
      item.item.trim(),
      item.method ? item.method.trim() : null,
      item.status.trim().toLowerCase(),
      item.note ? item.note.trim() : null,
      item.photo_path || null
    );
  }

  return { reportId, problemCount };
});

function createReport(reportData, items) {
  return insertReportTransaction(reportData, items);
}

/**
 * Retrieve reports with optional filters
 */
function getReports({ site, startDate, endDate, problemsOnly } = {}) {
  let query = `
    SELECT id, employee_name, employee_id, site, drive_details, remarks, problem_count, created_at
    FROM reports
    WHERE 1=1
  `;
  const params = [];

  if (site && site !== 'all') {
    query += ` AND site = ?`;
    params.push(site);
  }

  if (startDate) {
    query += ` AND date(created_at) >= date(?)`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND date(created_at) <= date(?)`;
    params.push(endDate);
  }

  if (problemsOnly === true || problemsOnly === 'true' || problemsOnly === '1') {
    query += ` AND problem_count > 0`;
  }

  query += ` ORDER BY created_at DESC, id DESC`;

  const stmt = db.prepare(query);
  return stmt.all(...params);
}

/**
 * Retrieve a single report with all its items
 */
function getReportById(id) {
  const reportStmt = db.prepare(`
    SELECT id, employee_name, employee_id, site, drive_details, remarks, problem_count, created_at
    FROM reports
    WHERE id = ?
  `);
  const report = reportStmt.get(id);
  if (!report) return null;

  const itemsStmt = db.prepare(`
    SELECT id, section, item, method, status, note, photo_path
    FROM report_items
    WHERE report_id = ?
    ORDER BY id ASC
  `);
  report.items = itemsStmt.all(id);

  return report;
}

/**
 * Retrieve all items for CSV export (one row per checklist item)
 */
function getAllItemsForExport({ site, startDate, endDate, problemsOnly } = {}) {
  let query = `
    SELECT 
      r.id AS report_id,
      r.employee_name,
      r.site,
      r.drive_details,
      r.created_at,
      r.remarks AS report_remarks,
      r.problem_count,
      ri.id AS item_id,
      ri.section,
      ri.item,
      ri.method,
      ri.status,
      ri.note AS problem_note,
      ri.photo_path
    FROM reports r
    JOIN report_items ri ON r.id = ri.report_id
    WHERE 1=1
  `;
  const params = [];

  if (site && site !== 'all') {
    query += ` AND r.site = ?`;
    params.push(site);
  }

  if (startDate) {
    query += ` AND date(r.created_at) >= date(?)`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND date(r.created_at) <= date(?)`;
    params.push(endDate);
  }

  if (problemsOnly === true || problemsOnly === 'true' || problemsOnly === '1') {
    query += ` AND r.problem_count > 0`;
  }

  query += ` ORDER BY r.created_at DESC, r.id DESC, ri.id ASC`;

  const stmt = db.prepare(query);
  return stmt.all(...params);
}

/**
 * Retrieve unique sites that have reports
 */
function getDistinctSites() {
  const stmt = db.prepare(`
    SELECT DISTINCT site FROM reports ORDER BY site ASC
  `);
  return stmt.all().map(r => r.site);
}

/**
 * Get summary stats for admin dashboard
 */
function getStats() {
  const totalReports = db.prepare(`SELECT COUNT(*) as count FROM reports`).get().count;
  const reportsWithProblems = db.prepare(`SELECT COUNT(*) as count FROM reports WHERE problem_count > 0`).get().count;
  const allOkReports = db.prepare(`SELECT COUNT(*) as count FROM reports WHERE problem_count = 0`).get().count;
  const distinctSites = db.prepare(`SELECT COUNT(DISTINCT site) as count FROM reports`).get().count;

  return {
    totalReports,
    reportsWithProblems,
    allOkReports,
    distinctSites
  };
}

function getDatabaseSummary() {
  const totalReports = db.prepare(`SELECT COUNT(*) as count FROM reports`).get().count;
  const totalItems = db.prepare(`SELECT COUNT(*) as count FROM report_items`).get().count;
  const totalProblems = db.prepare(`SELECT COUNT(*) as count FROM report_items WHERE status IN ('no', 'problem')`).get().count;
  const firstSubmission = db.prepare(`SELECT created_at FROM reports ORDER BY id ASC LIMIT 1`).get();
  const latestSubmission = db.prepare(`SELECT created_at FROM reports ORDER BY id DESC LIMIT 1`).get();

  let fileSize = 0;
  try {
    fileSize = fs.statSync(dbPath).size;
  } catch (e) {}

  return {
    totalReports,
    totalItems,
    totalProblems,
    firstSubmission: firstSubmission ? firstSubmission.created_at : null,
    latestSubmission: latestSubmission ? latestSubmission.created_at : null,
    fileSizeKB: Math.round(fileSize / 1024),
    dbPath
  };
}

/**
 * Delete a single report and all its item records by id
 */
function deleteReport(id) {
  const deleteTransaction = db.transaction((reportId) => {
    const deleteItemsStmt = db.prepare('DELETE FROM report_items WHERE report_id = ?');
    deleteItemsStmt.run(reportId);

    const deleteReportStmt = db.prepare('DELETE FROM reports WHERE id = ?');
    const result = deleteReportStmt.run(reportId);
    return result.changes > 0;
  });

  return deleteTransaction(id);
}

/**
 * Delete all reports (clean database reset for admin)
 */
function deleteAllReports() {
  const clearTransaction = db.transaction(() => {
    db.prepare('DELETE FROM report_items').run();
    db.prepare('DELETE FROM reports').run();
  });
  return clearTransaction();
}

module.exports = {
  db,
  createReport,
  getReports,
  getReportById,
  getAllItemsForExport,
  getDistinctSites,
  getStats,
  getDatabaseSummary,
  deleteReport,
  deleteAllReports
};
