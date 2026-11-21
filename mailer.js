const nodemailer = require('nodemailer');

/**
 * Send an email alert to ADMIN_EMAIL when a report with problems is submitted.
 * Skips silently if SMTP settings or ADMIN_EMAIL are not configured.
 */
async function sendProblemAlert({ reportId, employeeName, employeeId, site, createdAt, problems, baseUrl }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || `"QR Site Checklist" <${smtpUser || 'alerts@qrsitechecklist.local'}>`;

  // Skip silently if SMTP or admin email is not configured
  if (!adminEmail || !smtpHost) {
    // Optional notification skipped silently per spec
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: (smtpUser && smtpPass) ? {
        user: smtpUser,
        pass: smtpPass
      } : undefined
    });

    const problemsListHtml = problems.map(p => `
      <li style="margin-bottom: 12px; padding: 10px; background-color: #fdf2f2; border-left: 4px solid #e02424; border-radius: 4px;">
        <strong>[${escapeHtml(p.section)}] ${escapeHtml(p.item)}</strong><br/>
        <div style="margin-top: 5px; color: #771d1d;"><strong>Issue description:</strong> ${escapeHtml(p.note || 'No note provided')}</div>
        ${p.photo_path ? `<div style="margin-top: 5px; font-size: 12px; color: #4b5563;">📸 Photo attached: ${escapeHtml(p.photo_path)}</div>` : ''}
      </li>
    `).join('');

    const problemsListText = problems.map(p => 
      `- [${p.section}] ${p.item}\n  Issue: ${p.note || 'No note'}\n  ${p.photo_path ? `Photo: ${p.photo_path}` : ''}`
    ).join('\n\n');

    const reportUrl = `${baseUrl || 'http://localhost:3000'}/admin#report-${reportId}`;

    const mailOptions = {
      from: smtpFrom,
      to: adminEmail,
      subject: `🚨 [PROBLEM REPORTED] Site: ${site} - Employee: ${employeeName} (#${reportId})`,
      text: `QR Site Checklist Alert\n\nA problem report has been submitted.\n\nSite: ${site}\nEmployee: ${employeeName} (${employeeId || 'No ID'})\nReport ID: #${reportId}\nSubmitted At: ${createdAt || new Date().toISOString()}\nTotal Problems: ${problems.length}\n\nProblem Details:\n${problemsListText}\n\nView Full Report: ${reportUrl}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="background-color: #fee2e2; border: 1px solid #f87171; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px;">
            <h2 style="color: #991b1b; margin: 0; font-size: 18px;">⚠️ Site Checklist Alert: Problems Reported</h2>
          </div>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #4b5563; width: 130px;"><strong>Site / Location:</strong></td>
              <td style="padding: 6px 0; color: #111827; font-size: 16px;"><strong>${escapeHtml(site)}</strong></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #4b5563;"><strong>Employee:</strong></td>
              <td style="padding: 6px 0; color: #111827;">${escapeHtml(employeeName)} ${employeeId ? `(ID: ${escapeHtml(employeeId)})` : ''}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #4b5563;"><strong>Report ID:</strong></td>
              <td style="padding: 6px 0; color: #111827;">#${reportId}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #4b5563;"><strong>Problem Count:</strong></td>
              <td style="padding: 6px 0; color: #dc2626; font-weight: bold;">${problems.length} item(s) flagged</td>
            </tr>
          </table>

          <h3 style="color: #374151; font-size: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px;">Flagged Problems Breakdown</h3>
          <ul style="list-style: none; padding-left: 0;">
            ${problemsListHtml}
          </ul>

          <div style="margin-top: 24px; text-align: center;">
            <a href="${reportUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 20px; font-weight: 600; border-radius: 6px;">View Report in Admin Dashboard</a>
          </div>

          <div style="margin-top: 24px; font-size: 12px; color: #9ca3af; text-align: center;">
            Automated alert sent by QR Site Checklist.
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Notification] Alert email sent for Report #${reportId}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.warn(`[Notification] Failed to send email alert:`, error.message);
    return false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  sendProblemAlert,
  escapeHtml
};
