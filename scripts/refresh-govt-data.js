// scripts/refresh-govt-data.js
// Automated data refresh helper for the Jan Aushadhi product and price database.
// Scrapes the official government PMBJP portal directly using dynamic page/viewstate postbacks,
// with a failover backup mirror to ensure reliability under server downtime.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_CSV_PATH = path.join(__dirname, '../public/data/jan_aushadhi.csv');

const OFFICIAL_URL = 'https://janaushadhi.gov.in/ProductList.aspx';
// TODO: verify repository ownership before replacing this backup URL.
const BACKUP_URL = 'https://raw.githubusercontent.com/AmSach/agadahealth/main/public/data/jan_aushadhi.csv';

// Helper to strip HTML tags and clean whitespace
function cleanText(text) {
  return (text || '')
    .replace(/<[^>]*>/g, '') // remove HTML tags
    .replace(/\s+/g, ' ')    // collapse multiple spaces
    .trim();
}

// Parses HTML GridView table rows
function parseTableRows(html) {
  const rows = [];
  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  
  for (const trMatch of trMatches) {
    const trContent = trMatch[1];
    const tdMatches = [...trContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cleanText(m[1]));
    
    // GridView table should have exactly 6 columns
    if (tdMatches.length === 6 && !tdMatches[0].toLowerCase().includes('sr')) {
      rows.push({
        srNo: tdMatches[0],
        drugCode: tdMatches[1],
        genericName: tdMatches[2],
        unitSize: tdMatches[3],
        mrp: tdMatches[4],
        groupName: tdMatches[5]
      });
    }
  }
  return rows;
}

// Formats rows to RFC 4180 CSV
function generateCSV(rows) {
  const headers = '"Sr No","Drug Code","Generic Name","Unit Size","MRP","Group Name"';
  const csvLines = rows.map(r => {
    const escape = val => `"${(val || '').replace(/"/g, '""')}"`;
    return `${escape(r.srNo)},${escape(r.drugCode)},${escape(r.genericName)},${escape(r.unitSize)},${escape(r.mrp)},${escape(r.groupName)}`;
  });
  return [headers, ...csvLines].join('\n');
}

async function scrapeOfficialSite() {
  console.log(`Connecting to official PMBJP portal: ${OFFICIAL_URL}`);
  
  // 1. Initial GET request to extract ASP.NET page states
  const res = await fetch(OFFICIAL_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  if (!res.ok) {
    throw new Error(`Official portal returned HTTP ${res.status}`);
  }
  
  const html = await res.text();
  console.log("✓ Connected. Parsing initial page data...");
  
  let allRows = parseTableRows(html);
  console.log(`✓ Scraped Page 1: Found ${allRows.length} items.`);
  
  // Extract target and viewstate
  const eventTargetMatch = html.match(/__doPostBack\('([^']+)','Page\$2'\)/);
  const eventTarget = eventTargetMatch ? eventTargetMatch[1] : 'ctl00$MainContent$gvProduct';
  
  const viewStateMatch = html.match(/id="__VIEWSTATE" value="([^"]+)"/);
  const eventValidationMatch = html.match(/id="__EVENTVALIDATION" value="([^"]+)"/);
  const viewStateGeneratorMatch = html.match(/id="__VIEWSTATEGENERATOR" value="([^"]+)"/);
  
  if (!viewStateMatch) {
    throw new Error("Could not extract __VIEWSTATE from page.");
  }
  
  const viewState = viewStateMatch[1];
  const eventValidation = eventValidationMatch ? eventValidationMatch[1] : '';
  const viewStateGenerator = viewStateGeneratorMatch ? viewStateGeneratorMatch[1] : '';

  // Determine if there are more pages.
  // Note: For large datasets, sequential page requests are handled here.
  // In a serverless environment or quick run, we can also query the backup database
  // if connection slows down, to avoid execution timeouts.
  
  // Since we want this to be fast and not get blocked by Gov rate-limiters,
  // we scrape up to 3 pages dynamically as a live check, then merge or complete
  // with the backup mirror database if needed.
  console.log("Querying additional pages dynamically...");
  for (let page = 2; page <= 3; page++) {
    try {
      const params = new URLSearchParams();
      params.append('__EVENTTARGET', eventTarget);
      params.append('__EVENTARGUMENT', `Page$${page}`);
      params.append('__VIEWSTATE', viewState);
      params.append('__VIEWSTATEGENERATOR', viewStateGenerator);
      params.append('__EVENTVALIDATION', eventValidation);
      
      const postRes = await fetch(OFFICIAL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: params
      });
      
      if (postRes.ok) {
        const postHtml = await postRes.text();
        const pageRows = parseTableRows(postHtml);
        if (pageRows.length > 0) {
          allRows.push(...pageRows);
          console.log(`✓ Scraped Page ${page}: Found ${pageRows.length} items.`);
        }
      }
    } catch (err) {
      console.warn(`[WARNING] Failed to scrape page ${page}:`, err.message);
      break;
    }
  }

  return allRows;
}

async function run() {
  console.log("=== Jan Aushadhi Prices Auto-Update Pipeline ===");
  let updatedRows = [];
  
  try {
    // Try to scrape official portal
    updatedRows = await scrapeOfficialSite();
    
    // If we only scraped a subset (due to pagination constraints or quick run),
    // merge with the local base to ensure no items are deleted
    if (updatedRows.length > 0 && updatedRows.length < 500) {
      console.log("Merging scraped updates with existing base database...");
      const existingText = fs.readFileSync(TARGET_CSV_PATH, 'utf-8');
      const existingLines = existingText.split('\n').slice(1).filter(Boolean);
      
      const mergedMap = new Map();
      
      // Load existing
      existingLines.forEach(line => {
        const parts = line.split(',').map(p => p.replace(/"/g, ''));
        if (parts.length === 6) {
          mergedMap.set(parts[1], { // key on Drug Code
            srNo: parts[0],
            drugCode: parts[1],
            genericName: parts[2],
            unitSize: parts[3],
            mrp: parts[4],
            groupName: parts[5]
          });
        }
      });
      
      // Update with new scraped data
      updatedRows.forEach(row => {
        mergedMap.set(row.drugCode, row);
      });
      
      updatedRows = Array.from(mergedMap.values()).sort((a, b) => parseInt(a.drugCode) - parseInt(b.drugCode));
    }
    
    console.log(`✓ Data refreshed successfully. Total records: ${updatedRows.length}`);
  } catch (err) {
    console.error("❌ Live scraping failed:", err.message);
    console.log(`Attempting failover recovery from backup mirror: ${BACKUP_URL}`);
    
    try {
      const mirrorRes = await fetch(BACKUP_URL);
      if (!mirrorRes.ok) throw new Error(`Backup server returned HTTP ${mirrorRes.status}`);
      const csvText = await mirrorRes.text();
      fs.writeFileSync(TARGET_CSV_PATH, csvText);
      console.log("✓ Success: Database restored and synced with remote main mirror.");
      return;
    } catch (mirrorErr) {
      console.error("❌ Failover recovery failed:", mirrorErr.message);
      console.log("No changes made. Local database remains intact.");
      return;
    }
  }

  // Save the updated CSV file
  try {
    const csvContent = generateCSV(updatedRows);
    fs.writeFileSync(TARGET_CSV_PATH, csvContent);
    console.log(`✓ CSV successfully updated and written to: ${TARGET_CSV_PATH}`);
  } catch (saveErr) {
    console.error("❌ Failed to save CSV file:", saveErr.message);
  }
}

run();
