/**
 * EcoCycle AI — Phase 4 Integration & Unit Tests
 *
 * Comprehensive test suite verifying:
 * 1. Unit tests for deterministic matching engine (matching.js)
 * 2. API integration tests for POST /api/match
 * 3. Regression tests for Phase 2 and Phase 3 endpoints
 *
 * Uses only Node.js built-in modules — no external test framework needed.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  matchBuyers,
  checkEligibility,
  calculateScore,
  scoreMaterial,
  scoreQuantity,
  scoreLocation,
  scoreDemand,
  scoreCondition,
  generateMatchReasons,
  normalize,
  includesNormalized,
  WEIGHTS,
  DEMAND_SCORES
} = require('./matching');

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

// --- HTTP helpers ---
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

function tinyJpeg() {
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

// Load buyers demo fixture for unit testing
const demoBuyers = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'buyers.json'), 'utf-8'));

// =============================================
// 1. Unit Tests for matching.js
// =============================================
function runMatchingUnitTests() {
  console.log('\n--- 1. matching.js Unit Tests ---');

  // String helpers
  log(normalize('  PET   Plastic  ') === 'PET Plastic', 'normalize trims and collapses whitespace');
  log(normalize(null) === '', 'normalize handles non-string safely');
  log(includesNormalized(['North Sector', 'South Hub'], '  North Sector  '), 'includesNormalized matches with whitespace variation');
  log(!includesNormalized(['North Sector'], 'Central City'), 'includesNormalized rejects non-member');

  // Hard eligibility: Material
  const sampleBuyer = {
    id: 'buyer_test',
    name: 'Test Buyer',
    accepted_materials: ['PET Plastic'],
    min_kg: 10,
    max_kg: 100,
    supported_zones: ['North Sector'],
    accepted_conditions: ['Clean'],
    demand_level: 'High'
  };

  const validListing = {
    confirmed_material: 'PET Plastic',
    quantity_kg: 50,
    locality: 'North Sector',
    condition: 'Clean'
  };

  log(checkEligibility(sampleBuyer, validListing).eligible === true, 'checkEligibility passes valid listing');

  // Reject wrong material
  const wrongMaterial = { ...validListing, confirmed_material: 'HDPE Plastic' };
  const matResult = checkEligibility(sampleBuyer, wrongMaterial);
  log(matResult.eligible === false && matResult.reasons.some(r => r.includes('material') || r.includes('HDPE Plastic')), 'checkEligibility fails on incompatible material');

  // Reject below min_kg
  const tooSmall = { ...validListing, quantity_kg: 5 };
  const minResult = checkEligibility(sampleBuyer, tooSmall);
  log(minResult.eligible === false && minResult.reasons.some(r => r.includes('below minimum')), 'checkEligibility fails when quantity < min_kg');

  // Reject above max_kg
  const tooLarge = { ...validListing, quantity_kg: 200 };
  const maxResult = checkEligibility(sampleBuyer, tooLarge);
  log(maxResult.eligible === false && maxResult.reasons.some(r => r.includes('exceeds maximum')), 'checkEligibility fails when quantity > max_kg');

  // Reject unsupported zone
  const wrongZone = { ...validListing, locality: 'South Hub' };
  const zoneResult = checkEligibility(sampleBuyer, wrongZone);
  log(zoneResult.eligible === false && zoneResult.reasons.some(r => r.includes('South Hub')), 'checkEligibility fails on unsupported zone');

  // Reject unsupported condition
  const wrongCond = { ...validListing, condition: 'Contaminated/Dirty' };
  const condResult = checkEligibility(sampleBuyer, wrongCond);
  log(condResult.eligible === false && condResult.reasons.some(r => r.includes('Contaminated/Dirty')), 'checkEligibility fails on unsupported condition');

  // Multiple failures recorded
  const multiFail = { ...validListing, quantity_kg: 2, condition: 'Contaminated/Dirty' };
  const multiResult = checkEligibility(sampleBuyer, multiFail);
  log(multiResult.reasons.length >= 2, 'checkEligibility captures all failing constraints');

  // Component scoring
  const matScore = scoreMaterial(sampleBuyer, validListing);
  log(matScore >= 0.9 && matScore <= 1.0, 'scoreMaterial returns valid score between 0.9 and 1.0');

  const midQtyScore = scoreQuantity({ min_kg: 10, max_kg: 100 }, { quantity_kg: 55 }); // Midpoint = 55
  const edgeQtyScore = scoreQuantity({ min_kg: 10, max_kg: 100 }, { quantity_kg: 10 }); // Edge = 10
  log(midQtyScore > edgeQtyScore, 'scoreQuantity awards higher score at midpoint than range edge');

  const singleZoneScore = scoreLocation({ supported_zones: ['North Sector'] }, validListing);
  const multiZoneScore = scoreLocation({ supported_zones: ['North Sector', 'South Hub', 'Central City', 'Industrial East'] }, validListing);
  log(singleZoneScore > multiZoneScore, 'scoreLocation awards higher score for focused/specialized coverage');

  log(scoreDemand({ demand_level: 'High' }) === 1.0, 'scoreDemand: High = 1.0');
  log(scoreDemand({ demand_level: 'Medium' }) === 0.6, 'scoreDemand: Medium = 0.6');
  log(scoreDemand({ demand_level: 'Low' }) === 0.25, 'scoreDemand: Low = 0.25');

  const condClean = scoreCondition({ accepted_conditions: ['Clean'] }, { condition: 'Clean' });
  const condDirty = scoreCondition({ accepted_conditions: ['Clean', 'Mixed/Labels on', 'Contaminated/Dirty'] }, { condition: 'Contaminated/Dirty' });
  log(condClean > condDirty, 'scoreCondition awards higher score for high-quality match with selective buyer');

  // Composite score & bounds
  const { score, components } = calculateScore(sampleBuyer, validListing);
  log(typeof score === 'number' && score >= 0 && score <= 100, 'calculateScore returns number bounded between 0 and 100');
  log(Object.keys(components).length === 5, 'calculateScore returns all 5 breakdown components');

  // Weights sum to 1.0
  const weightSum = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);
  log(Math.abs(weightSum - 1.0) < 0.0001, 'Configured scoring weights sum exactly to 1.0');

  // matchBuyers overall function
  const matchRes = matchBuyers(validListing, demoBuyers);
  log(Array.isArray(matchRes.eligible), 'matchBuyers returns eligible array');
  log(Array.isArray(matchRes.ineligible), 'matchBuyers returns ineligible array');
  log(typeof matchRes.message === 'string', 'matchBuyers returns message');
  log(matchRes.eligible.length + matchRes.ineligible.length === demoBuyers.length, 'matchBuyers partitions all buyers into eligible or ineligible');

  // Check descending sort order
  let sorted = true;
  for (let i = 1; i < matchRes.eligible.length; i++) {
    if (matchRes.eligible[i].score > matchRes.eligible[i - 1].score) {
      sorted = false;
      break;
    }
  }
  log(sorted, 'matchBuyers returns eligible buyers sorted descending by score');

  // Empty buyers handling
  const emptyRes = matchBuyers(validListing, []);
  log(emptyRes.eligible.length === 0 && emptyRes.ineligible.length === 0, 'matchBuyers handles empty buyers list gracefully');
}

// =============================================
// 2. API Integration Tests: POST /api/match
// =============================================
async function runApiMatchTests() {
  console.log('\n--- 2. POST /api/match API Integration Tests ---');

  // Scenario A: Valid request with multiple matches
  // Quantity: 20kg, Central City, Clean
  // Expected: buyer_pet_01 (10-500kg, Central, Clean/Mixed), buyer_pet_02 (5-100kg, Central, all cond), buyer_pet_04 (2-50kg, Central, Clean/Mixed)
  // Ineligible: buyer_pet_03 (Industrial East only, min 50kg)
  const resA = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 20,
    locality: 'Central City',
    condition: 'Clean'
  });

  log(resA.status === 200, 'Valid match request returns HTTP 200');
  log(resA.body.success === true, 'Response contains success: true');
  log(Array.isArray(resA.body.eligible) && resA.body.eligible.length === 3, 'Finds exactly 3 eligible buyers for 20kg Central City Clean PET');
  log(Array.isArray(resA.body.ineligible) && resA.body.ineligible.length === 1, 'Identifies 1 ineligible buyer');

  // Check structure of eligible buyer item
  const topMatch = resA.body.eligible[0];
  log(typeof topMatch.buyer_id === 'string' && topMatch.buyer_id.startsWith('buyer_'), 'Eligible buyer includes buyer_id');
  log(typeof topMatch.buyer_name === 'string' && topMatch.buyer_name.length > 0, 'Eligible buyer includes buyer_name');
  log(typeof topMatch.score === 'number' && topMatch.score >= 0 && topMatch.score <= 100, 'Eligible buyer has 0-100 score');
  log(Array.isArray(topMatch.match_reasons) && topMatch.match_reasons.length >= 4, 'Eligible buyer includes human-readable match_reasons');
  log(topMatch.score_breakdown && typeof topMatch.score_breakdown.material === 'number', 'Eligible buyer includes detailed score_breakdown');

  // Ineligible buyer structure
  const inelig = resA.body.ineligible[0];
  log(inelig.buyer_id === 'buyer_pet_03', 'Ineligible buyer is correctly identified as buyer_pet_03');
  log(Array.isArray(inelig.exclusion_reasons) && inelig.exclusion_reasons.length > 0, 'Ineligible buyer includes exclusion_reasons');

  // Scenario B: Specific large industrial match
  // 100 kg, Industrial East, Clean
  // buyer_pet_03 accepts: Industrial East, Clean, min 50 max 2000 -> ELIGIBLE
  // buyer_pet_02 accepts: Industrial East, Clean, min 5 max 100 -> ELIGIBLE (at max)
  // buyer_pet_01 accepts: North/Central -> INELIGIBLE (zone)
  // buyer_pet_04 accepts: max 50 -> INELIGIBLE (quantity)
  const resB = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 100,
    locality: 'Industrial East',
    condition: 'Clean'
  });
  log(resB.status === 200, 'Scenario B returns HTTP 200');
  const bEligibleIds = resB.body.eligible.map(b => b.buyer_id);
  log(bEligibleIds.includes('buyer_pet_03'), 'buyer_pet_03 is eligible for 100kg Industrial East');
  log(!bEligibleIds.includes('buyer_pet_01'), 'buyer_pet_01 excluded (zone mismatch)');
  log(!bEligibleIds.includes('buyer_pet_04'), 'buyer_pet_04 excluded (exceeds max 50kg)');

  // Scenario C: Small household quantity
  // 3 kg, South Hub, Clean
  // buyer_pet_04 accepts 2-50kg, all zones -> ELIGIBLE
  // all others min >= 5kg -> INELIGIBLE
  const resC = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 3,
    locality: 'South Hub',
    condition: 'Clean'
  });
  log(resC.status === 200, 'Scenario C returns HTTP 200');
  log(resC.body.eligible.length === 1 && resC.body.eligible[0].buyer_id === 'buyer_pet_04', 'Only buyer_pet_04 matches 3kg small batch');

  // Scenario D: No match found
  // 5000 kg exceeds all buyer maxes
  const resD = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 5000,
    locality: 'Industrial East',
    condition: 'Clean'
  });
  log(resD.status === 200, 'No-match scenario returns HTTP 200');
  log(resD.body.eligible.length === 0, 'No buyers eligible for 5000kg batch');
  log(resD.body.ineligible.length === 4, 'All 4 buyers marked ineligible');
  log(resD.body.message.includes('No compatible recycling partners found'), 'Helpful message returned on zero matches');

  // Scenario E: Dirty condition filter
  // Only buyer_pet_02 accepts "Contaminated/Dirty"
  const resE = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 20,
    locality: 'South Hub',
    condition: 'Contaminated/Dirty'
  });
  log(resE.status === 200, 'Dirty condition request returns HTTP 200');
  const eEligibleIds = resE.body.eligible.map(b => b.buyer_id);
  log(eEligibleIds.length === 1 && eEligibleIds[0] === 'buyer_pet_02', 'Only buyer_pet_02 matches Contaminated/Dirty condition');

  // Input Validation (HTTP 400 tests)
  const inv1 = await jsonPost('/api/match', {});
  log(inv1.status === 400 && inv1.body.error.includes('confirmed_material is required'), 'Rejects missing confirmed_material with 400');

  const inv2 = await jsonPost('/api/match', { confirmed_material: 'PVC Plastic' });
  log(inv2.status === 400 && inv2.body.error.includes('Invalid material'), 'Rejects unsupported material with 400');

  const inv3 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic' });
  log(inv3.status === 400 && inv3.body.error.includes('quantity_kg is required'), 'Rejects missing quantity_kg with 400');

  const inv4 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: -5 });
  log(inv4.status === 400 && inv4.body.error.includes('positive finite number'), 'Rejects negative quantity with 400');

  const inv5 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: 'abc' });
  log(inv5.status === 400 && inv5.body.error.includes('positive finite number'), 'Rejects non-numeric quantity with 400');

  const inv6 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: 10 });
  log(inv6.status === 400 && inv6.body.error.includes('locality is required'), 'Rejects missing locality with 400');

  const inv7 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'Mars Sector' });
  log(inv7.status === 400 && inv7.body.error.includes('Invalid locality'), 'Rejects invalid locality with 400');

  const inv8 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector' });
  log(inv8.status === 400 && inv8.body.error.includes('condition is required'), 'Rejects missing condition with 400');

  const inv9 = await jsonPost('/api/match', { confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Crushed' });
  log(inv9.status === 400 && inv9.body.error.includes('Invalid condition'), 'Rejects invalid condition with 400');
}

// =============================================
// 3. Regression Tests (Phase 2 & Phase 3 Core)
// =============================================
async function runRegressionTests() {
  console.log('\n--- 3. Phase 2 & 3 Regression Tests ---');

  // Health endpoint
  const h = await request('GET', '/api/health');
  log(h.status === 200, 'GET /api/health returns 200');
  log(h.body.status === 'ok', 'Health status is ok');
  log(typeof h.body.buyersLoaded === 'number' && h.body.buyersLoaded === 4, 'Health reports 4 buyers loaded');

  // Buyers endpoint
  const b = await request('GET', '/api/buyers');
  log(b.status === 200, 'GET /api/buyers returns 200');
  log(Array.isArray(b.body.buyers) && b.body.buyers.length === 4, 'Buyers list contains 4 profiles');

  // Reset listings
  const r0 = await jsonPost('/api/reset', {});
  log(r0.status === 200, 'POST /api/reset returns 200');

  // Listings GET (empty initially)
  const l0 = await request('GET', '/api/listings');
  log(l0.status === 200 && l0.body.listings.length === 0, 'GET /api/listings returns empty array after reset');

  // Create valid listing
  const createRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 15.5,
    locality: 'North Sector',
    condition: 'Clean'
  });
  log(createRes.status === 201, 'POST /api/listings returns 201 on success');
  log(createRes.body.listing.id.startsWith('list_'), 'Created listing has unique list_ ID');
  log(createRes.body.listing.status === 'LISTED', 'Listing status defaults to LISTED');

  // Verify listing retrieved
  const l1 = await request('GET', '/api/listings');
  log(l1.body.listings.length === 1 && l1.body.listings[0].id === createRes.body.listing.id, 'Created listing is persisted in memory');

  // Listing validation errors
  const badListing = await jsonPost('/api/listings', {
    confirmed_material: 'Glass',
    quantity_kg: 10,
    locality: 'North Sector',
    condition: 'Clean'
  });
  log(badListing.status === 400, 'POST /api/listings rejects unsupported material');

  // Image analysis endpoint (fallback mode when no real key)
  const imgRes = await multipartUpload('/api/analyze', 'waste-image', 'test.jpg', 'image/jpeg', tinyJpeg());
  log(imgRes.status === 200, 'POST /api/analyze accepts valid JPEG upload');
  log(imgRes.body.material === 'PET Plastic', 'Analyze returns material estimate');
  log(typeof imgRes.body.fallback_used === 'boolean', 'Analyze returns fallback_used flag');

  // Bad image upload
  const badImgRes = await multipartUpload('/api/analyze', 'waste-image', 'test.txt', 'text/plain', Buffer.from('not an image'));
  log(badImgRes.status === 400, 'POST /api/analyze rejects invalid mime type with 400');

  // Reset again
  const r1 = await jsonPost('/api/reset', {});
  log(r1.status === 200 && r1.body.success === true, 'POST /api/reset resets state');
}

// =============================================
// Main Runner
// =============================================
async function runAllTests() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 4 Matching Engine Tests');
  console.log('══════════════════════════════════════════════════');

  runMatchingUnitTests();
  await runApiMatchTests();
  await runRegressionTests();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
  console.log('══════════════════════════════════════════════════\n');

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

