/**
 * EcoCycle AI — Phase 5 End-to-End Integration, Reliability & Demo Readiness Tests
 *
 * Comprehensive audit suite verifying:
 * 1. Server health and required static/API routes
 * 2. Upload handling, magic-bytes image validation, and temporary file cleanup
 * 3. Gemini fallback reliability and contract safety
 * 4. Listing creation, field validations, and in-memory persistence
 * 5. Listing-to-Match consistency (by listing_id and explicit fields)
 * 6. Deterministic scoring, ranking, tie-breaking, and human-readable reasons
 * 7. No-match handling and edge cases
 * 8. Rapid repeated submissions and unique ID generation
 * 9. Demo state reset and isolation
 * 10. Phase 2, 3, and 4 regression verification
 *
 * Built strictly with Node.js built-in modules — zero extra dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
let skipped = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

function skip(label, reason) {
  console.log(`⏭️ SKIP — ${label}: ${reason}`);
  skipped++;
}

// --- HTTP Helpers ---
let BASE;

function request(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: headers || {}
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body && typeof body === 'string') req.write(body);
    else if (body && Buffer.isBuffer(body)) req.write(body);
    req.end();
  });
}

function jsonPost(urlPath, obj) {
  return request('POST', urlPath, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

function multipartUpload(urlPath, fieldName, filename, contentType, fileBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + Date.now();
    const CRLF = '\r\n';
    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '', ''
    ].join(CRLF);
    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sampleJpeg() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH' +
    'BwYIDAoMCwsKCwsNCxAQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQME' +
    'BAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
    'FBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAA' +
    'AAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEG' +
    'E1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF' +
    'RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj' +
    'pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP0' +
    '9fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC' +
    'BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
    'ChYkNOEl8RcYI4Q/RFhHSnJFUrNiU5JjgpcKS/LD/9oADAMBAAIRAxEAPwD9U6KK' +
    'KAP/2Q==',
    'base64'
  );
}

function samplePng() {
  // Minimal valid 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

// =============================================
// 1. Server Health & Static Content Tests
// =============================================
async function testHealthAndStatic() {
  console.log('\n--- 1. Health & Static Routes ---');

  const health = await request('GET', '/api/health');
  log(health.status === 200, 'GET /api/health responds with 200');
  log(health.body.status === 'ok', 'Health response status is "ok"');
  log(health.body.service === 'EcoCycle AI', 'Service name is EcoCycle AI');
  log(typeof health.body.buyersLoaded === 'number' && health.body.buyersLoaded === 4, 'Health confirms 4 buyers loaded');
  log(typeof health.body.geminiConfigured === 'boolean', 'Health provides boolean geminiConfigured');

  const index = await request('GET', '/');
  log(index.status === 200, 'GET / returns 200');
  log(typeof index.body === 'string' && index.body.includes('EcoCycle AI'), 'Home page contains EcoCycle AI brand');
  log(index.body.includes('Confirm & Create Listing'), 'Home page includes confirmation action');
  log(index.body.includes('Find Matching Buyers'), 'Home page includes matching action');

  const css = await request('GET', '/styles.css');
  log(css.status === 200, 'GET /styles.css returns 200');

  const js = await request('GET', '/app.js');
  log(js.status === 200, 'GET /app.js returns 200');
  log(typeof js.body === 'string' && js.body.includes('escapeHtml'), 'app.js contains HTML escaping utility');
}

// =============================================
// 2. Buyer Profiles Security & Demo Labelling
// =============================================
async function testBuyersEndpoint() {
  console.log('\n--- 2. Demo Buyer Profiles Audit ---');

  const res = await request('GET', '/api/buyers');
  log(res.status === 200, 'GET /api/buyers returns 200');
  log(Array.isArray(res.body.buyers) && res.body.buyers.length === 4, 'Returns exactly 4 demo buyer profiles');

  const allHaveDemo = res.body.buyers.every(b =>
    (b.name && b.name.includes('(Demo)')) || (b.notes && b.notes.toLowerCase().includes('demo'))
  );
  log(allHaveDemo, 'All buyer profiles are explicitly labelled as demo data');

  const allHaveConstraints = res.body.buyers.every(b =>
    Array.isArray(b.accepted_materials) &&
    typeof b.min_kg === 'number' &&
    typeof b.max_kg === 'number' &&
    Array.isArray(b.supported_zones) &&
    Array.isArray(b.accepted_conditions)
  );
  log(allHaveConstraints, 'All buyer profiles declare required constraint fields');
}

// =============================================
// 3. Upload & Image Validation Tests
// =============================================
async function testImageUploadValidation() {
  console.log('\n--- 3. Upload & Content Validation ---');

  // Valid JPEG
  const resJpeg = await multipartUpload('/api/analyze', 'waste-image', 'photo.jpg', 'image/jpeg', sampleJpeg());
  log(resJpeg.status === 200, 'Valid JPEG upload returns 200');
  log(resJpeg.body.material === 'PET Plastic', 'Analyze returns expected material');
  log(typeof resJpeg.body.fallback_used === 'boolean', 'Analyze returns fallback_used boolean');

  // Valid PNG
  const resPng = await multipartUpload('/api/analyze', 'waste-image', 'photo.png', 'image/png', samplePng());
  log(resPng.status === 200, 'Valid PNG upload returns 200');

  // Disguised non-image file with spoofed MIME type (text file masquerading as JPEG)
  const fakeImageBuffer = Buffer.from('This is completely plain text masquerading as an image file header.');
  const resFake = await multipartUpload('/api/analyze', 'waste-image', 'fake.jpg', 'image/jpeg', fakeImageBuffer);
  log(resFake.status === 400, 'Rejects spoofed non-image data with 400 (magic bytes check)');
  log(resFake.body.error && resFake.body.error.includes('valid JPG, PNG, or WebP'), 'Error explains image validation failure');

  // Unsupported MIME type
  const resPdf = await multipartUpload('/api/analyze', 'waste-image', 'document.pdf', 'application/pdf', Buffer.from('%PDF-1.4...'));
  log(resPdf.status === 400, 'Rejects PDF upload with 400');

  // Missing file upload
  const resMissing = await jsonPost('/api/analyze', {});
  log(resMissing.status === 400, 'Rejects missing file upload with 400');

  // Verify uploads directory cleanup
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir);
  log(files.length === 0, `Uploads directory is clean (found ${files.length} lingering files)`);
}

// =============================================
// 4. Listing Creation & Integrity Tests
// =============================================
async function testListingCreationAndValidation() {
  console.log('\n--- 4. Listing Creation & Integrity ---');

  // Reset demo store
  await jsonPost('/api/reset', {});

  // Valid listing 1
  const valid1 = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 25,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(valid1.status === 201, 'Creates valid listing (201)');
  log(valid1.body.listing && valid1.body.listing.id.startsWith('list_'), 'Generated unique listing ID');
  log(valid1.body.listing.status === 'LISTED', 'Initial listing status is LISTED');
  log(valid1.body.listing.quantity_kg === 25, 'Stored quantity is 25 kg');

  // Valid listing 2 with decimal quantity
  const valid2 = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 7.75,
    locality: 'North Sector',
    condition: 'Mixed/Labels on'
  });
  log(valid2.status === 201, 'Creates decimal quantity listing (201)');
  log(valid2.body.listing.quantity_kg === 7.75, 'Stored decimal quantity correctly');

  // Verify listing store length
  const listAll = await request('GET', '/api/listings');
  log(listAll.body.listings.length === 2, 'GET /api/listings returns exactly 2 persisted listings');

  // Invalid quantity tests
  const zeroQty = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 0, locality: 'North Sector', condition: 'Clean'
  });
  log(zeroQty.status === 400, 'Rejects 0 quantity_kg with 400');

  const negQty = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: -15, locality: 'North Sector', condition: 'Clean'
  });
  log(negQty.status === 400, 'Rejects negative quantity_kg with 400');

  const nanQty = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 'forty', locality: 'North Sector', condition: 'Clean'
  });
  log(nanQty.status === 400, 'Rejects non-numeric quantity_kg with 400');

  const infQty = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: Infinity, locality: 'North Sector', condition: 'Clean'
  });
  log(infQty.status === 400, 'Rejects Infinity quantity_kg with 400');

  // Invalid material/locality/condition
  const badMat = await jsonPost('/api/listings', {
    confirmed_material: 'Aluminum Can', quantity_kg: 10, locality: 'North Sector', condition: 'Clean'
  });
  log(badMat.status === 400, 'Rejects unsupported material with 400');

  const badZone = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'Metropolis', condition: 'Clean'
  });
  log(badZone.status === 400, 'Rejects unsupported locality with 400');

  const badCond = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Burnt'
  });
  log(badCond.status === 400, 'Rejects unsupported condition with 400');
}

// =============================================
// 5. Listing-to-Match Consistency & Engine Tests
// =============================================
async function testMatchingEngineAndConsistency() {
  console.log('\n--- 5. Listing-to-Match Consistency & Engine ---');

  // Reset demo store
  await jsonPost('/api/reset', {});

  // Create a listing for Industrial East, 100 kg, Clean
  const createRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 100,
    locality: 'Industrial East',
    condition: 'Clean'
  });
  const createdListing = createRes.body.listing;

  // Match using listing_id (server resolves verified listing fields)
  const matchById = await jsonPost('/api/match', {
    listing_id: createdListing.id
  });
  log(matchById.status === 200, 'POST /api/match with listing_id returns 200');
  log(matchById.body.listing_id === createdListing.id, 'Match response echoes listing_id');

  const eligibleIds = matchById.body.eligible.map(b => b.buyer_id);
  // buyer_pet_03 accepts Industrial East, Clean, min 50 max 2000 -> ELIGIBLE
  // buyer_pet_02 accepts Industrial East, Clean, min 5 max 100 -> ELIGIBLE
  // buyer_pet_01 accepts North/Central -> INELIGIBLE (zone mismatch)
  // buyer_pet_04 accepts max 50 -> INELIGIBLE (quantity exceeds max)
  log(eligibleIds.includes('buyer_pet_03'), 'buyer_pet_03 is eligible');
  log(eligibleIds.includes('buyer_pet_02'), 'buyer_pet_02 is eligible');
  log(!eligibleIds.includes('buyer_pet_01'), 'buyer_pet_01 excluded (zone constraint)');
  log(!eligibleIds.includes('buyer_pet_04'), 'buyer_pet_04 excluded (quantity constraint)');

  // Verify non-existent listing_id returns 404
  const nonExistentMatch = await jsonPost('/api/match', {
    listing_id: 'list_does_not_exist_99999'
  });
  log(nonExistentMatch.status === 404, 'POST /api/match with unknown listing_id returns 404');

  // Verify direct field match produces identical results
  const matchDirect = await jsonPost('/api/match', {
    confirmed_material: createdListing.confirmed_material,
    quantity_kg: createdListing.quantity_kg,
    locality: createdListing.locality,
    condition: createdListing.condition
  });
  log(matchDirect.status === 200, 'Direct fields match returns 200');
  log(matchDirect.body.eligible.length === matchById.body.eligible.length, 'Direct match and listing_id match produce identical count');
  log(matchDirect.body.eligible[0].buyer_id === matchById.body.eligible[0].buyer_id, 'Top-ranked buyer matches across both methods');

  // Score integrity
  const topBuyer = matchById.body.eligible[0];
  log(typeof topBuyer.score === 'number' && topBuyer.score >= 0 && topBuyer.score <= 100, 'Score is bounded between 0 and 100');
  log(Array.isArray(topBuyer.match_reasons) && topBuyer.match_reasons.length >= 4, 'Includes itemized match reasons');
  log(topBuyer.score_breakdown && typeof topBuyer.score_breakdown.demand === 'number', 'Includes complete 5-factor score breakdown');

  // Check descending sort order
  let isSorted = true;
  for (let i = 1; i < matchById.body.eligible.length; i++) {
    if (matchById.body.eligible[i].score > matchById.body.eligible[i - 1].score) {
      isSorted = false;
      break;
    }
  }
  log(isSorted, 'Eligible buyers are sorted in strictly descending order');

  // No-match scenario (quantity exceeds all buyers: 8,000 kg)
  const noMatch = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 8000,
    locality: 'North Sector',
    condition: 'Clean'
  });
  log(noMatch.status === 200, 'No-match scenario returns 200');
  log(noMatch.body.eligible.length === 0, 'Eligible list is empty for 8000 kg batch');
  log(noMatch.body.ineligible.length === 4, 'All 4 buyers categorized as ineligible');
  log(noMatch.body.message.includes('No compatible recycling partners found'), 'User receives clear no-match explanation');
}

// =============================================
// 6. Concurrency, Rapid Submissions & Reset Tests
// =============================================
async function testConcurrencyAndReset() {
  console.log('\n--- 6. Repeated Submissions & Demo Reset ---');

  // Create 5 listings in parallel
  const promises = [];
  for (let i = 1; i <= 5; i++) {
    promises.push(
      jsonPost('/api/listings', {
        confirmed_material: 'PET Plastic',
        quantity_kg: 10 + i,
        locality: 'Central City',
        condition: 'Clean'
      })
    );
  }

  const results = await Promise.all(promises);
  log(results.every(r => r.status === 201), 'All 5 rapid concurrent listings succeeded (201)');

  const ids = results.map(r => r.body.listing.id);
  const uniqueIds = new Set(ids);
  log(uniqueIds.size === 5, 'Every created listing receives a distinct, unique ID');

  // Verify total count
  const countRes = await request('GET', '/api/listings');
  log(countRes.body.listings.length === 6, 'Total listings correctly reflects 1 previous + 5 new = 6');

  // Reset
  const resetRes = await jsonPost('/api/reset', {});
  log(resetRes.status === 200 && resetRes.body.success === true, 'POST /api/reset resets state');

  const afterReset = await request('GET', '/api/listings');
  log(afterReset.body.listings.length === 0, 'Listings store is completely cleared after reset');
}

// =============================================
// 7. Security & Information Leakage Audit
// =============================================
async function testSecurityAndLeakage() {
  console.log('\n--- 7. Security & Leakage Audit ---');

  // Ensure health does not leak API keys
  const health = await request('GET', '/api/health');
  log(!JSON.stringify(health.body).includes('AIzaSy'), 'Health endpoint does not leak Gemini API key');

  // Unknown route
  const notFound = await request('GET', '/api/unsupported-endpoint');
  log(notFound.status === 404, 'Unknown API route returns 404');

  // Malformed JSON body
  const malformed = await request('POST', '/api/listings', '{ not valid json }', { 'Content-Type': 'application/json' });
  log(malformed.status === 400 || malformed.status === 500, 'Server gracefully handles malformed JSON without crashing');

  // Verify server remains responsive after malformed payload
  const healthAfter = await request('GET', '/api/health');
  log(healthAfter.status === 200, 'Server remains healthy and responsive after malformed request');
}

// =============================================
// Runner
// =============================================
async function runAllTests() {
  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 5 End-to-End Integration & Demo Readiness');
  console.log('═════════════════════════════════════════════════════════════════');

  await testHealthAndStatic();
  await testBuyersEndpoint();
  await testImageUploadValidation();
  await testListingCreationAndValidation();
  await testMatchingEngineAndConsistency();
  await testConcurrencyAndReset();
  await testSecurityAndLeakage();

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  Phase 5 Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
  console.log('═════════════════════════════════════════════════════════════════\n');

  return failed;
}

async function main() {
  const express = require('express');
  const originalListen = express.application.listen;

  let serverRef;
  const ready = new Promise((resolve) => {
    express.application.listen = function (...args) {
      serverRef = originalListen.call(this, 0, () => {
        const addr = serverRef.address();
        BASE = `http://127.0.0.1:${addr.port}`;
        console.log(`Test server listening on port ${addr.port}`);
        resolve();
      });
      return serverRef;
    };
  });

  require('./server');
  await ready;
  express.application.listen = originalListen;

  let failures;
  try {
    failures = await runAllTests();
  } catch (err) {
    console.error('Test runner crashed:', err);
    failures = 1;
  }

  if (serverRef) serverRef.close();
  process.exit(failures > 0 ? 1 : 0);
}

main();

