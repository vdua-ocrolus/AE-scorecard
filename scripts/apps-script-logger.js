/**
 * Google Apps Script — AE Scorecard Access Logger
 *
 * Deploy as: Web app → Execute as: Me → Who has access: Anyone within Ocrolus
 *
 * Handles two modes:
 *   1. Write (default): Logs access events (login, return_visit, sign_out) to the sheet
 *   2. Read (?mode=read): Returns last 500 rows as JSONP for the admin panel
 *
 * To deploy/update:
 *   1. Open https://script.google.com (or the existing project)
 *   2. Replace the code with this file
 *   3. Deploy > New deployment (or Manage deployments > Edit)
 *   4. Type: Web app, Execute as: Me, Access: Anyone within Ocrolus
 *   5. Copy the deployment URL and update LOG_URL in index.html if it changed
 */

function doGet(e) {
  var params = e.parameter || {};
  var mode = params.mode || 'write';

  if (mode === 'read') {
    return handleRead(params);
  }

  return handleWrite(params);
}

function handleWrite(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var email = params.email || '';
  var action = params.action || '';
  var ua = params.ua || '';
  var timestamp = new Date().toISOString();

  sheet.appendRow([timestamp, email, action, ua]);

  return ContentService.createTextOutput('ok');
}

function handleRead(params) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  // Skip header row if present, return last 500 rows
  var rows = data.length > 500 ? data.slice(-500) : data;

  // Convert Date objects to ISO strings
  rows = rows.map(function(row) {
    return row.map(function(cell) {
      if (cell instanceof Date) {
        return cell.toISOString();
      }
      return cell;
    });
  });

  var result = JSON.stringify({ rows: rows });

  // Support JSONP callback for cross-origin
  var callback = params.callback;
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + result + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(result)
    .setMimeType(ContentService.MimeType.JSON);
}
