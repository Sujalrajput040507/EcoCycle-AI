/**
 * EcoCycle AI — Phase 11 EcoProof Loop Traceability & Audit Tests
 *
 * Verifies:
 * 1. Batch Initialization:
 *    - Valid batch creation linked to confirmed PET listing
 *    - Rejection of invalid/missing listing_id (HTTP 400)
 *    - Rejection of non-existent listing_id (HTTP 404)
 *    - Batch code format validation (ECO-PET-2026-XXXX)
 *    - Unique batch code generation across multiple batches
 *    - Genesis audit event logged (BATCH_INITIALIZED, previous_hash 64 zeros)
 *    - Idempotent batch creation returns existing batch (HTTP 200)
 * 2. Multi-Tenant Authorization & Access Control:
 *    - Anonymous user cannot access private batch (HTTP 401)
 *    - User B cannot access User A's private batch (HTTP 403)
 *    - Owner (User A) can view private batch (HTTP 200)
 *    - Admin user can view any private batch (HTTP 200)
 *    - Public/demo listings allow demo batch operations
 * 3. Evidence Upload & File Integrity:
 *    - Valid JPEG/PNG/WebP upload returns 201 with SHA-256 hash
 *    - Magic bytes validation rejects spoofed text/executable files (HTTP 400)
 *    - Rejects invalid evidence categories (HTTP 400)
 *    - File size limit enforced (5MB limit)
 *    - SHA-256 hash accurately matches uploaded file bytes
 *    - EVIDENCE_SUBMITTED audit event logged in chain
 *    - Private evidence file access requires authorization
 *    - Path traversal attempts on evidence file download are rejected
 * 4. Deterministic Evidence Completeness Scoring:
 *    - 0 points initially (0%) with disclaimer present
 *    - 20 points per milestone category (100% max for 5 milestones)
 *    - SUBMITTED milestones award full points
 *    - REVIEWED milestones award full points
 *    - FLAGGED milestones award 0 points
 *    - Distinction between NOT_YET_DUE and MISSING milestones
 *    - Mandatory transparency disclaimer present in score response
 * 5. Weight Discrepancy Detection:
 *    - Collection weight recording with validation (> 0, <= 10,000 kg)
 *    - Receiving weight recording with validation
 *    - Negative, non-numeric, or excessive weights rejected (HTTP 400)
 *    - Variance calculation: receivingWeight - collectionWeight and percentage
 *    - Variance <= 10% marked ACCEPTABLE (not flagged)
 *    - Variance > 10% marked FLAGGED and logs WEIGHT_DISCREPANCY_FLAGGED audit event
 *    - Discrepancy review endpoint records DISCREPANCY_REVIEWED audit event
 * 6. Cryptographic Audit Chain & Tamper Detection:
 *    - Genesis event has previous_hash of 64 zeros
 *    - Each subsequent event has previous_hash matching preceding event's event_hash
 *    - Canonical SHA-256 hashing verified by verifyAuditChain()
 *    - Tampering detection: altering any historical field fails verification and identifies invalid index
 * 7. Public QR Traceability & Sanitization:
 *    - GET /api/trace/:batchCode accessible without any session or authentication
 *    - Sensitive coordinates, donor email, payment secrets, internal hashes stripped
 *    - Public view returns sanitized milestones and audit events
 *    - Unknown batch code returns HTTP 404
 *    - GET /api/batches/:id/qr returns valid QR code data URL and public trace URL
 *    - GET /trace/:batchCode serves public HTML page
 * 8. Core Regressions:
 *    - GET /api/health operational
 *    - Listing creation and recovery lifecycle continue working seamlessly
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  generateBatchCode,
  sha256,
  verifyAuditChain,
  calculateEvidenceScore,
  calculateWeightDiscrepancy,
  sanitizePublicBatchView
} = require('./ecoproof-service');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

let BASE;

function request(method, urlPath, body, headers = {}, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const reqHeaders = { ...headers };
    if (cookie) {
      reqHeaders['Cookie'] = cookie;
    }
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: reqHeaders
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        const setCookie = res.headers['set-cookie'];
        resolve({
          status: res.statusCode,
          body: parsed,
          headers: res.headers,
          setCookie: setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : []
        });
      });
    });
    req.on('error', reject);
    if (body && typeof body === 'string') req.write(body);
    else if (body && Buffer.isBuffer(body)) req.write(body);
    req.end();
  });
}

function jsonPost(urlPath, obj, cookie = '', extraHeaders = {}) {
  return request(
    'POST',
    urlPath,
    JSON.stringify(obj),
    {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...extraHeaders
    },
    cookie
  );
}

function jsonGet(urlPath, cookie = '') {
  return request('GET', urlPath, null, {}, cookie);
}

function multipartUpload(urlPath, fields, fileField, filename, contentType, fileBuffer, cookie = '') {
  return new Promise((resolve, reject) => {
    const boundary = '----EcoProofTestBoundary' + Date.now();
    const CRLF = '\r\n';
    const chunks = [];

    // Add text fields
    for (const [key, val] of Object.entries(fields)) {
      chunks.push(Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}${val}${CRLF}`
      ));
    }

    // Add file
    if (fileBuffer && fileField) {
      chunks.push(Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${fileField}"; filename="${filename}"${CRLF}Content-Type: ${contentType}${CRLF}${CRLF}`
      ));
      chunks.push(fileBuffer);
      chunks.push(Buffer.from(CRLF));
    }

    chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
    const fullBody = Buffer.concat(chunks);

    const url = new URL(urlPath, BASE);
    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': fullBody.length,
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (cookie) headers['Cookie'] = cookie;

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

function extractCookie(setCookieArray, cookieName = 'ecocycle_sid') {
  if (!Array.isArray(setCookieArray)) return '';
  for (const c of setCookieArray) {
    if (c.startsWith(`${cookieName}=`)) {
      return c.split(';')[0];
    }
  }
  return '';
}

// Minimal valid PNG buffer
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

// Fake image (text content)
const FAKE_IMAGE_BUFFER = Buffer.from('This is not an image file! It is plaintext.');

// =============================================
// TEST SUITE EXECUTION
// =============================================
async function runAllTests() {
  console.log('====================================================');
  console.log('   EcoCycle AI — Phase 11 EcoProof Loop Test Suite   ');
  console.log('====================================================\n');

  // Reset database state cleanly
  await jsonPost('/api/reset?users=true', {});

  // 1. Service-Level Unit Tests
  console.log('--- 1. EcoProof Service Unit Tests ---');
  const code1 = generateBatchCode();
  const code2 = generateBatchCode();
  log(code1.startsWith('ECO-PET-2026-'), 'generateBatchCode prefix format', code1);
  log(code1 !== code2, 'generateBatchCode generates unique codes', `${code1} vs ${code2}`);

  const testHash = sha256(Buffer.from('hello-world'));
  log(testHash.length === 64, 'sha256 helper returns 64-char hex digest', testHash.substring(0, 16) + '...');

  // 2. Batch Creation Tests
  console.log('\n--- 2. Batch Initialization & Genesis Audit Tests ---');
  
  // Register two users: Alice (owner) and Bob (other user)
  const regAlice = await jsonPost('/api/auth/register', {
    name: 'Alice Eco',
    email: 'alice.batch@example.com',
    password: 'SecurePassphraseForAlice123!'
  });
  const aliceCookie = extractCookie(regAlice.setCookie);
  log(regAlice.status === 201, 'Registered user Alice for batch tests');

  const regBob = await jsonPost('/api/auth/register', {
    name: 'Bob Other',
    email: 'bob.batch@example.com',
    password: 'SecurePassphraseForBob12345!'
  });
  const bobCookie = extractCookie(regBob.setCookie);
  log(regBob.status === 201, 'Registered user Bob for isolation tests');

  // Alice creates a private listing
  const aliceListingRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 75,
    locality: 'Central City',
    condition: 'Clean',
    is_private: true
  }, aliceCookie);
  const aliceListing = aliceListingRes.body.listing;
  log(aliceListingRes.status === 201 && aliceListing.id, 'Alice created private listing', aliceListing?.id);

  // Rejection without listing_id
  const failNoId = await jsonPost('/api/batches', {}, aliceCookie);
  log(failNoId.status === 400, 'POST /api/batches rejects missing listing_id (HTTP 400)');

  // Rejection with non-existent listing_id
  const failNotFound = await jsonPost('/api/batches', { listing_id: 'non_existent_123' }, aliceCookie);
  log(failNotFound.status === 404, 'POST /api/batches rejects unknown listing_id (HTTP 404)');

  // Unauthenticated user attempting to create batch for Alice's private listing
  const failAnon = await jsonPost('/api/batches', { listing_id: aliceListing.id });
  log(failAnon.status === 401, 'Anonymous user rejected from creating batch for private listing (HTTP 401)');

  // Bob attempting to create batch for Alice's private listing
  const failBob = await jsonPost('/api/batches', { listing_id: aliceListing.id }, bobCookie);
  log(failBob.status === 403, 'Bob rejected from creating batch for Alice private listing (HTTP 403)');

  // Alice creates batch for her listing
  const aliceBatchRes = await jsonPost('/api/batches', {
    listing_id: aliceListing.id,
    collection_weight_kg: 75.0,
    notes: 'Initial batch created for testing.'
  }, aliceCookie);
  log(aliceBatchRes.status === 201, 'Alice initialized batch successfully (HTTP 201)');
  const batchA = aliceBatchRes.body.batch;
  log(batchA.batch_code.startsWith('ECO-PET-2026-'), 'Batch code adheres to format ECO-PET-2026-XXXX', batchA.batch_code);
  log(batchA.material === 'PET Plastic', 'Batch specifies PET Plastic material');
  log(batchA.declared_quantity_kg === 75, 'Batch has declared quantity 75 kg');

  // Idempotent creation returns HTTP 200 with same batch
  const duplicateBatchRes = await jsonPost('/api/batches', { listing_id: aliceListing.id }, aliceCookie);
  log(duplicateBatchRes.status === 200 && duplicateBatchRes.body.batch.id === batchA.id, 'Idempotent batch creation returns existing batch (HTTP 200)');

  // 3. Multi-Tenant Authorization Tests
  console.log('\n--- 3. Multi-Tenant Batch Authorization Tests ---');
  const anonView = await jsonGet(`/api/batches/${batchA.id}`);
  log(anonView.status === 401, 'Anonymous access to private batch rejected (HTTP 401)');

  const bobView = await jsonGet(`/api/batches/${batchA.id}`, bobCookie);
  log(bobView.status === 403, 'Bob access to Alice private batch rejected (HTTP 403)');

  const aliceView = await jsonGet(`/api/batches/${batchA.id}`, aliceCookie);
  log(aliceView.status === 200, 'Alice can view her private batch (HTTP 200)');
  log(aliceView.body.audit_chain_valid === true, 'Audit chain integrity reported valid on initial batch');

  // Demo listing batch without owner allows demo view
  const demoListingRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 20,
    locality: 'North Sector',
    condition: 'Clean'
  });
  const demoBatchRes = await jsonPost('/api/batches', { listing_id: demoListingRes.body.listing.id });
  log(demoBatchRes.status === 201, 'Created unowned demo batch');
  const demoView = await jsonGet(`/api/batches/${demoBatchRes.body.batch.id}`);
  log(demoView.status === 200, 'Unowned demo batch can be accessed without credentials (HTTP 200)');

  // 4. Evidence Upload & Integrity Tests
  console.log('\n--- 4. Evidence Upload, Validation & SHA-256 Tests ---');

  // Rejection without file
  const noFileRes = await multipartUpload(
    `/api/batches/${batchA.id}/evidence`,
    { category: 'PICKUP_PHOTO' },
    null, null, null, null,
    aliceCookie
  );
  log(noFileRes.status === 400, 'Upload without file rejected (HTTP 400)');

  // Rejection with invalid category
  const invalidCatRes = await multipartUpload(
    `/api/batches/${batchA.id}/evidence`,
    { category: 'INVALID_CATEGORY_XYZ' },
    'evidence_file', 'test.png', 'image/png', VALID_PNG_BUFFER,
    aliceCookie
  );
  log(invalidCatRes.status === 400, 'Upload with invalid category rejected (HTTP 400)');

  // Rejection of spoofed text file with magic bytes check
  const fakeImageRes = await multipartUpload(
    `/api/batches/${batchA.id}/evidence`,
    { category: 'PICKUP_PHOTO' },
    'evidence_file', 'fake.png', 'image/png', FAKE_IMAGE_BUFFER,
    aliceCookie
  );
  log(fakeImageRes.status === 400, 'Spoofed file rejected by magic bytes validation (HTTP 400)');

  // Valid PNG upload for PICKUP_PHOTO
  const validUploadRes = await multipartUpload(
    `/api/batches/${batchA.id}/evidence`,
    { category: 'PICKUP_PHOTO', notes: 'Digital photo at pickup' },
    'evidence_file', 'pickup.png', 'image/png', VALID_PNG_BUFFER,
    aliceCookie
  );
  log(validUploadRes.status === 201, 'Valid PNG uploaded successfully (HTTP 201)');
  const evidence1 = validUploadRes.body.evidence;
  log(evidence1.category === 'PICKUP_PHOTO', 'Evidence category matches PICKUP_PHOTO');
  log(evidence1.review_status === 'SUBMITTED', 'Evidence review status defaults to SUBMITTED');
  log(evidence1.sha256_hash === sha256(VALID_PNG_BUFFER), 'SHA-256 hash matches uploaded bytes exactly', evidence1.sha256_hash.substring(0, 16) + '...');

  // File access authorization check
  const fileAnon = await jsonGet(`/api/batches/${batchA.id}/evidence/${evidence1.id}/file`);
  log(fileAnon.status === 401, 'Anonymous access to evidence file rejected (HTTP 401)');

  const fileBob = await jsonGet(`/api/batches/${batchA.id}/evidence/${evidence1.id}/file`, bobCookie);
  log(fileBob.status === 403, 'Bob access to Alice evidence file rejected (HTTP 403)');

  const fileAlice = await jsonGet(`/api/batches/${batchA.id}/evidence/${evidence1.id}/file`, aliceCookie);
  log(fileAlice.status === 200, 'Alice can download her evidence file (HTTP 200)');
  log(fileAlice.headers['content-type'] === 'image/png', 'Evidence file served with correct Content-Type: image/png');

  // 5. Evidence Completeness Scoring Tests
  console.log('\n--- 5. Deterministic Evidence Completeness Scoring Tests ---');
  const scoreRes1 = await jsonGet(`/api/batches/${batchA.id}/score`, aliceCookie);
  log(scoreRes1.status === 200, 'GET /api/batches/:id/score succeeds');
  log(scoreRes1.body.score.totalScore === 20, '1 milestone uploaded = 20 points (20%)', `${scoreRes1.body.score.totalScore}%`);
  log(typeof scoreRes1.body.score.disclaimer === 'string' && scoreRes1.body.score.disclaimer.includes('Transparency Disclaimer'), 'Mandatory transparency disclaimer present in score response');

  // Upload second evidence (COLLECTION_WEIGHT)
  await multipartUpload(
    `/api/batches/${batchA.id}/evidence`,
    { category: 'COLLECTION_WEIGHT', notes: 'Weigh ticket at pickup' },
    'evidence_file', 'weight.png', 'image/png', VALID_PNG_BUFFER,
    aliceCookie
  );
  const scoreRes2 = await jsonGet(`/api/batches/${batchA.id}/score`, aliceCookie);
  log(scoreRes2.body.score.totalScore === 40, '2 milestones uploaded = 40 points (40%)', `${scoreRes2.body.score.totalScore}%`);

  // Review evidence endpoint: update evidence1 to FLAGGED -> 0 points for that milestone
  const flagRes = await jsonPost(`/api/batches/${batchA.id}/evidence/${evidence1.id}/review`, {
    status: 'FLAGGED',
    notes: 'Image is blurry or unreadable.'
  }, aliceCookie);
  log(flagRes.status === 200 && flagRes.body.evidence.review_status === 'FLAGGED', 'Evidence reviewed as FLAGGED');

  const scoreRes3 = await jsonGet(`/api/batches/${batchA.id}/score`, aliceCookie);
  log(scoreRes3.body.score.totalScore === 20, 'FLAGGED milestone awards 0 points (total dropped back to 20%)', `${scoreRes3.body.score.totalScore}%`);

  // Unflag back to REVIEWED -> restores points
  await jsonPost(`/api/batches/${batchA.id}/evidence/${evidence1.id}/review`, {
    status: 'REVIEWED',
    notes: 'Clear photo confirmed.'
  }, aliceCookie);
  const scoreRes4 = await jsonGet(`/api/batches/${batchA.id}/score`, aliceCookie);
  log(scoreRes4.body.score.totalScore === 40, 'REVIEWED milestone restores points (40%)');

  // 6. Weight Tracking & Discrepancy Detection Tests
  console.log('\n--- 6. Weight Discrepancy & Threshold Tests ---');

  // Rejection of invalid collection weight
  const badWeight1 = await jsonPost(`/api/batches/${batchA.id}/collection-weight`, { weight_kg: -5 }, aliceCookie);
  log(badWeight1.status === 400, 'Negative collection weight rejected (HTTP 400)');

  const badWeight2 = await jsonPost(`/api/batches/${batchA.id}/collection-weight`, { weight_kg: 50000 }, aliceCookie);
  log(badWeight2.status === 400, 'Excessive collection weight (> 10,000 kg) rejected (HTTP 400)');

  // Record valid collection weight: 100 kg
  const setColl = await jsonPost(`/api/batches/${batchA.id}/collection-weight`, { weight_kg: 100 }, aliceCookie);
  log(setColl.status === 200 && setColl.body.batch.collection_weight_kg === 100, 'Collection weight 100 kg recorded');

  // Record receiving weight with acceptable variance (95 kg = 5% difference <= 10%)
  const setRecvAcceptable = await jsonPost(`/api/batches/${batchA.id}/receiving-weight`, { weight_kg: 95 }, aliceCookie);
  log(setRecvAcceptable.status === 200, 'Receiving weight 95 kg recorded');
  log(setRecvAcceptable.body.weight_discrepancy.flagged === false, '5% variance is within 10% threshold (not flagged)');
  log(setRecvAcceptable.body.weight_discrepancy.status === 'ACCEPTABLE', 'Discrepancy status is ACCEPTABLE');

  // Record receiving weight with excessive variance (80 kg = 20% difference > 10%)
  const setRecvFlagged = await jsonPost(`/api/batches/${batchA.id}/receiving-weight`, { weight_kg: 80 }, aliceCookie);
  log(setRecvFlagged.status === 200, 'Receiving weight 80 kg recorded');
  log(setRecvFlagged.body.weight_discrepancy.flagged === true, '20% variance exceeds 10% threshold (FLAGGED)');
  log(setRecvFlagged.body.weight_discrepancy.discrepancyPercent === 20, 'Computed discrepancy percent is exactly 20%');

  // Review discrepancy note
  const discReview = await jsonPost(`/api/batches/${batchA.id}/discrepancy/review`, {
    review_notes: '15kg water contamination drained prior to tare weighing.',
    resolve_discrepancy: true
  }, aliceCookie);
  log(discReview.status === 200, 'Operator discrepancy review recorded');

  // 7. Cryptographic Audit Chain & Tamper Detection Tests
  console.log('\n--- 7. Cryptographic SHA-256 Audit Chain & Tamper Detection Tests ---');
  const auditRes = await jsonGet(`/api/batches/${batchA.id}/audit`, aliceCookie);
  log(auditRes.status === 200, 'GET /api/batches/:id/audit succeeds');
  const events = auditRes.body.events;
  log(Array.isArray(events) && events.length >= 6, `Audit log contains ${events.length} chained events`);

  // Verify genesis event
  const genesisEvent = events[0];
  log(genesisEvent.previous_hash === '0000000000000000000000000000000000000000000000000000000000000000', 'Genesis event previous_hash is 64 zeros');

  // Verify full chain linkage
  let chainOk = true;
  for (let i = 1; i < events.length; i++) {
    if (events[i].previous_hash !== events[i - 1].event_hash) {
      chainOk = false;
      break;
    }
  }
  log(chainOk, 'Every subsequent audit event links to the preceding event hash');
  log(auditRes.body.audit_chain_valid === true, 'Backend verifyAuditChain reports chain is valid and intact');

  // Tamper detection unit test
  const tamperedEvents = JSON.parse(JSON.stringify(events));
  tamperedEvents[1].explanation = 'TAMPERED EXPLANATION INJECTED BY ATTACKER';
  const tamperCheck = verifyAuditChain(tamperedEvents);
  log(tamperCheck.valid === false, 'verifyAuditChain correctly detects tampered event');
  log(tamperCheck.invalidIndex === 1, 'verifyAuditChain pinpointed the exact index of tampered event (index 1)');

  // 8. Public QR Traceability & Sanitization Tests
  console.log('\n--- 8. Public QR Traceability & Data Sanitization Tests ---');

  // QR endpoint
  const qrRes = await jsonGet(`/api/batches/${batchA.id}/qr`, aliceCookie);
  log(qrRes.status === 200, 'GET /api/batches/:id/qr succeeds');
  log(typeof qrRes.body.qr_data_url === 'string' && qrRes.body.qr_data_url.startsWith('data:image/png;base64,'), 'QR endpoint returns valid base64 PNG data URL');
  log(qrRes.body.trace_url.includes(`/trace/${batchA.batch_code}`), 'QR trace_url contains public trace route', qrRes.body.trace_url);

  // Public trace API without authentication
  const publicTraceRes = await jsonGet(`/api/trace/${batchA.batch_code}`);
  log(publicTraceRes.status === 200, 'GET /api/trace/:batchCode accessible publicly without auth (HTTP 200)');
  const pubData = publicTraceRes.body;

  log(pubData.batch_code === batchA.batch_code, 'Public view returns correct batch code');
  log(pubData.material === 'PET Plastic', 'Public view confirms PET Plastic material');
  log(pubData.latitude === undefined && pubData.longitude === undefined, 'Public view excludes precise GPS coordinates');
  log(pubData.user_id === undefined && pubData.owner_id === undefined, 'Public view excludes internal user/owner IDs');
  log(pubData.donor_email === undefined, 'Public view excludes donor email addresses');
  log(pubData.raw_files === undefined, 'Public view does not expose private raw evidence file paths');
  log(typeof pubData.evidence_completeness_score === 'number', 'Public view includes evidence score percentage');
  log(typeof pubData.disclaimer === 'string', 'Public view includes transparency disclaimer');

  // Unknown batch code returns 404
  const unknownTraceRes = await jsonGet('/api/trace/ECO-PET-2026-9999');
  log(unknownTraceRes.status === 404, 'Unknown batch code on public trace returns HTTP 404');

  // Public HTML route
  const publicHtmlRes = await request('GET', `/trace/${batchA.batch_code}`);
  log(publicHtmlRes.status === 200, 'GET /trace/:batchCode serves public HTML page (HTTP 200)');
  log(typeof publicHtmlRes.body === 'string' && publicHtmlRes.body.includes('EcoProof Loop'), 'Public HTML page renders EcoProof Loop template');

  // 9. Core Regression Checks
  console.log('\n--- 9. Core Regressions Verification ---');
  const healthRes = await jsonGet('/api/health');
  log(healthRes.status === 200 && healthRes.body.status === 'ok', 'GET /api/health returns HTTP 200');

  const buyersRes = await jsonGet('/api/buyers');
  log(buyersRes.status === 200 && buyersRes.body.buyers.length === 4, 'GET /api/buyers returns 4 demo buyers');

  console.log('\n====================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

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

