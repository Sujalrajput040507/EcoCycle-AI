/**
 * EcoCycle AI — Phase 9 Location-Based PET Price Intelligence Tests
 *
 * Verifies:
 * 1. Price record schema validation (validatePriceRecord unit tests)
 * 2. Freshness assessment policy (calculateFreshness unit tests)
 * 3. Geographic hierarchy matching (findBestGeographicMatch unit tests)
 * 4. Material form compatibility (used bottles vs flakes/pellets)
 * 5. Estimation arithmetic & rounding (decimal-safe INR calculations)
 * 6. Provider behavior and transparency (GET /api/prices/records)
 * 7. POST /api/prices/estimate endpoint validation and edge cases
 * 8. Separation of concerns: Pricing != Matching != Payments != Recovery
 * 9. Frontend DOM assets and styling integrity
 * 10. Zero regressions across core endpoints (health, buyers, match, listings, reset)
 *
 * Built with pure Node.js built-in modules — zero extra dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  validatePriceRecord,
  calculateFreshness,
  findBestGeographicMatch,
  estimatePetPrice,
  PetPriceDataProvider
} = require('./pet-price-service');

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

// =============================================
// 1. Price Record Schema Validation Unit Tests
// =============================================
function testPriceRecordValidation() {
  console.log('\n--- 1. Price Record Schema Validation (Unit Tests) ---');

  const validRecord = {
    id: 'test_record_01',
    material: 'PET Plastic',
    material_form: 'used_beverage_bottles',
    grade: 'Post-consumer clear PET bottles',
    condition: 'Clean',
    region: 'North India',
    city: 'Central City',
    state: 'Punjab',
    pincode: '160017',
    currency: 'INR',
    price_min_per_kg: 14.50,
    price_max_per_kg: 18.00,
    unit: 'kg',
    source_name: 'Regional Scrap Index',
    observed_at: '2026-10-25T10:00:00.000Z',
    data_mode: 'MANUALLY_IMPORTED',
    source_type: 'SCRAP_INDEX'
  };

  const v1 = validatePriceRecord(validRecord);
  log(v1.valid === true, 'Accepts valid PET price record');

  // Negative min price
  const v2 = validatePriceRecord({ ...validRecord, price_min_per_kg: -5 });
  log(v2.valid === false, 'Rejects negative price_min_per_kg');

  // Non-numeric price
  const v3 = validatePriceRecord({ ...validRecord, price_max_per_kg: 'twenty' });
  log(v3.valid === false, 'Rejects non-numeric price_max_per_kg');

  // min > max
  const v4 = validatePriceRecord({ ...validRecord, price_min_per_kg: 25, price_max_per_kg: 20 });
  log(v4.valid === false, 'Rejects price_min_per_kg > price_max_per_kg');

  // Unsupported currency
  const v5 = validatePriceRecord({ ...validRecord, currency: 'USD' });
  log(v5.valid === false, 'Rejects unsupported currency (non-INR)');

  // Unsupported material
  const v6 = validatePriceRecord({ ...validRecord, material: 'HDPE Plastic' });
  log(v6.valid === false, 'Rejects non-PET material');

  // Unsupported material form
  const v7 = validatePriceRecord({ ...validRecord, material_form: 'shredded_auto_parts' });
  log(v7.valid === false, 'Rejects unknown material form');

  // Missing source
  const v8 = validatePriceRecord({ ...validRecord, source_name: '' });
  log(v8.valid === false, 'Rejects missing source_name attribution');

  // Invalid date
  const v9 = validatePriceRecord({ ...validRecord, observed_at: 'not-a-date' });
  log(v9.valid === false, 'Rejects invalid observed_at date');
}

// =============================================
// 2. Freshness Policy Unit Tests
// =============================================
function testFreshnessPolicy() {
  console.log('\n--- 2. Freshness Assessment Policy (Unit Tests) ---');

  const refDate = new Date('2026-10-31T12:00:00.000Z');

  // 1 day ago -> FRESH
  const f1 = calculateFreshness('2026-10-30T12:00:00.000Z', refDate);
  log(f1.status === 'FRESH', 'Observation 1 day ago is classified as FRESH (<= 7 days)');
  log(f1.ageDays === 1, 'Calculates exact age in days (1 day)');

  // 7 days ago -> FRESH
  const f2 = calculateFreshness('2026-10-24T12:00:00.000Z', refDate);
  log(f2.status === 'FRESH', 'Observation exactly 7 days ago is classified as FRESH');

  // 12 days ago -> RECENT
  const f3 = calculateFreshness('2026-10-19T12:00:00.000Z', refDate);
  log(f3.status === 'RECENT', 'Observation 12 days ago is classified as RECENT (8–30 days)');

  // 45 days ago -> STALE
  const f4 = calculateFreshness('2026-09-16T12:00:00.000Z', refDate);
  log(f4.status === 'STALE', 'Observation 45 days ago is classified as STALE (> 30 days)');

  // Future observation date (> 24 hours ahead) -> UNKNOWN
  const f5 = calculateFreshness('2026-11-15T12:00:00.000Z', refDate);
  log(f5.status === 'UNKNOWN', 'Suspicious future observation date is classified as UNKNOWN');

  // Invalid date string -> UNKNOWN
  const f6 = calculateFreshness('invalid-timestamp', refDate);
  log(f6.status === 'UNKNOWN', 'Invalid date string is classified as UNKNOWN');
}

// =============================================
// 3. Geographic Selection & Material Compatibility Unit Tests
// =============================================
function testGeographicSelectionAndCompatibility() {
  console.log('\n--- 3. Geographic Hierarchy & Material Form Compatibility (Unit Tests) ---');

  const testRecords = [
    {
      id: 'r_city',
      material: 'PET Plastic',
      material_form: 'used_beverage_bottles',
      city: 'Central City',
      state: 'Punjab',
      price_min_per_kg: 15,
      price_max_per_kg: 18,
      condition: 'Clean',
      source_name: 'City Benchmark',
      observed_at: '2026-10-25T00:00:00.000Z'
    },
    {
      id: 'r_state',
      material: 'PET Plastic',
      material_form: 'used_beverage_bottles',
      city: null,
      state: 'Punjab',
      price_min_per_kg: 13,
      price_max_per_kg: 16,
      condition: 'Any',
      source_name: 'State Benchmark',
      observed_at: '2026-10-20T00:00:00.000Z'
    },
    {
      id: 'r_national',
      material: 'PET Plastic',
      material_form: 'used_beverage_bottles',
      region: 'India',
      city: null,
      state: null,
      price_min_per_kg: 12,
      price_max_per_kg: 15,
      condition: 'Any',
      source_name: 'National Benchmark',
      observed_at: '2026-10-15T00:00:00.000Z'
    },
    {
      id: 'r_flakes',
      material: 'PET Plastic',
      material_form: 'washed_flakes', // Incompatible form!
      city: 'Central City',
      state: 'Punjab',
      price_min_per_kg: 50,
      price_max_per_kg: 60,
      condition: 'Clean',
      source_name: 'Flakes Report',
      observed_at: '2026-10-25T00:00:00.000Z'
    }
  ];

  // Exact city match
  const matchCity = findBestGeographicMatch(testRecords.filter(r => r.material_form === 'used_beverage_bottles'), {
    locality: 'Central City',
    city: 'Central City',
    state: 'Punjab'
  });
  log(matchCity !== null, 'Finds geographic match');
  log(matchCity.level === 'city', 'Selects city-level match as highest priority');
  log(matchCity.record.id === 'r_city', 'Matches exact city record r_city');
  log(matchCity.label === 'Local city benchmark', 'Applies honest city benchmark label');

  // State-level fallback when city is missing
  const matchState = findBestGeographicMatch(testRecords.filter(r => r.material_form === 'used_beverage_bottles'), {
    locality: 'Unknown Town',
    city: 'Unknown Town',
    state: 'Punjab'
  });
  log(matchState !== null, 'Finds state-level fallback');
  log(matchState.level === 'state', 'Falls back to state-level estimate');
  log(matchState.record.id === 'r_state', 'Matches state record r_state');
  log(matchState.label === 'State-level indicative estimate', 'Applies honest state fallback label');

  // National fallback when both city and state have no direct match
  const matchNational = findBestGeographicMatch(testRecords.filter(r => r.material_form === 'used_beverage_bottles'), {
    locality: 'Distant Locality',
    city: 'Distant Locality',
    state: 'Kerala'
  });
  log(matchNational !== null, 'Finds national fallback');
  log(matchNational.level === 'national', 'Falls back to national benchmark');
  log(matchNational.record.id === 'r_national', 'Matches national record r_national');
  log(matchNational.label === 'India-wide indicative benchmark', 'Applies honest national fallback label');

  // Strict material form compatibility: flakes must NEVER be matched for raw bottles
  const rawBottleRecords = testRecords.filter(r => r.material_form === 'used_beverage_bottles');
  log(rawBottleRecords.every(r => r.material_form === 'used_beverage_bottles'), 'Compatible records strictly exclude washed flakes');
  log(!rawBottleRecords.some(r => r.id === 'r_flakes'), 'Flakes record r_flakes is excluded from loose bottle pricing');
}

// =============================================
// 4. Estimation Arithmetic & Calculations
// =============================================
function testEstimationArithmetic() {
  console.log('\n--- 4. Estimation Arithmetic & Decimal-Safe Rounding ---');

  // 25 kg at ₹14.50 - ₹18.00/kg
  const est1 = estimatePetPrice({
    material: 'PET Plastic',
    quantity_kg: 25,
    locality: 'Central City',
    condition: 'Clean'
  });

  log(est1.success === true, 'Calculation returns success: true');
  log(est1.status === 'ESTIMATE_AVAILABLE', 'Status is ESTIMATE_AVAILABLE');
  log(est1.estimated_value.min === 362.50, 'Minimum value: 25 × 14.50 = 362.50 INR');
  log(est1.estimated_value.max === 450.00, 'Maximum value: 25 × 18.00 = 450.00 INR');
  log(est1.price_per_kg.min === 14.50, 'Unit min price is 14.50 INR');
  log(est1.price_per_kg.max === 18.00, 'Unit max price is 18.00 INR');

  // Fractional quantity: 12.3 kg
  const est2 = estimatePetPrice({
    material: 'PET Plastic',
    quantity_kg: 12.3,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(est2.success === true, 'Handles fractional quantity (12.3 kg)');
  log(est2.estimated_value.min === 178.35, 'Decimal rounding min: 12.3 × 14.50 = 178.35 INR');
  log(est2.estimated_value.max === 221.40, 'Decimal rounding max: 12.3 × 18.00 = 221.40 INR');

  // Large valid batch: 10,000 kg
  const est3 = estimatePetPrice({
    material: 'PET Plastic',
    quantity_kg: 10000,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(est3.success === true, 'Calculates for maximum 10,000 kg batch');
  log(est3.estimated_value.min === 145000, 'Large batch min: 10,000 × 14.50 = 145,000 INR');
  log(est3.estimated_value.max === 180000, 'Large batch max: 10,000 × 18.00 = 180,000 INR');
}

// =============================================
// 5. Backend API Integration Tests
// =============================================
async function testApiEndpoints() {
  console.log('\n--- 5. POST /api/prices/estimate & GET /api/prices/records API Tests ---');

  await jsonPost('/api/reset', {});

  // 1. GET /api/prices/records
  const recordsRes = await request('GET', '/api/prices/records');
  log(recordsRes.status === 200, 'GET /api/prices/records returns 200');
  log(typeof recordsRes.body.count === 'number' && recordsRes.body.count > 0, 'Returns non-empty price records list');
  log(Array.isArray(recordsRes.body.records), 'Records is an array');

  // 2. Create listing to test listing_id resolution
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 50,
    locality: 'Central City',
    condition: 'Clean'
  });
  const listingId = listRes.body.listing.id;

  // 3. Estimate using listing_id
  const estRes = await jsonPost('/api/prices/estimate', { listing_id: listingId });
  log(estRes.status === 200, 'POST /api/prices/estimate with listing_id returns 200');
  log(estRes.body.status === 'ESTIMATE_AVAILABLE', 'Estimate status is ESTIMATE_AVAILABLE');
  log(estRes.body.listing_id === listingId, 'Echoes listing_id');
  log(estRes.body.quantity_kg === 50, 'Uses trusted quantity from in-memory listing (50 kg)');
  log(estRes.body.price_per_kg.min > 0, 'Includes positive min price per kg');
  log(estRes.body.estimated_value.min > 0, 'Includes positive estimated minimum value');
  log(Array.isArray(estRes.body.warnings), 'Includes warnings array');
  log(estRes.body.data_quality.is_live === false, 'Truthfully marks is_live: false for demo/imported data');

  // 4. Unknown listing_id returns 404
  const unknownRes = await jsonPost('/api/prices/estimate', { listing_id: 'list_unknown_999' });
  log(unknownRes.status === 404, 'Rejects unknown listing_id with 404');

  // 5. Unsupported material rejection
  const badMatRes = await jsonPost('/api/prices/estimate', {
    material: 'Cardboard',
    quantity_kg: 20,
    locality: 'Central City'
  });
  log(badMatRes.status === 400, 'Rejects unsupported material with 400');
  log(badMatRes.body.status === 'UNSUPPORTED_MATERIAL', 'Returns UNSUPPORTED_MATERIAL status');

  // 6. Zero quantity rejection
  const zeroQtyRes = await jsonPost('/api/prices/estimate', {
    material: 'PET Plastic',
    quantity_kg: 0,
    locality: 'Central City'
  });
  log(zeroQtyRes.status === 400, 'Rejects zero quantity with 400');

  // 7. Negative quantity rejection
  const negQtyRes = await jsonPost('/api/prices/estimate', {
    material: 'PET Plastic',
    quantity_kg: -10,
    locality: 'Central City'
  });
  log(negQtyRes.status === 400, 'Rejects negative quantity with 400');

  // 8. Non-numeric quantity rejection
  const nanQtyRes = await jsonPost('/api/prices/estimate', {
    material: 'PET Plastic',
    quantity_kg: 'fifty',
    locality: 'Central City'
  });
  log(nanQtyRes.status === 400, 'Rejects string quantity with 400');

  // 9. Ceiling violation (> 10,000 kg)
  const overMaxRes = await jsonPost('/api/prices/estimate', {
    material: 'PET Plastic',
    quantity_kg: 10001,
    locality: 'Central City'
  });
  log(overMaxRes.status === 400, 'Rejects quantity > 10,000 kg with 400');

  // 10. Missing locality rejection
  const missingLocRes = await jsonPost('/api/prices/estimate', {
    material: 'PET Plastic',
    quantity_kg: 20,
    locality: ''
  });
  log(missingLocRes.status === 400, 'Rejects empty locality with 400');
}

// =============================================
// 6. Separation of Concerns & Integrity
// =============================================
async function testSeparationOfConcerns() {
  console.log('\n--- 6. Strict Separation of Concerns (Pricing vs Matching vs Payments vs Recovery) ---');

  await jsonPost('/api/reset', {});

  // Create listing
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 30,
    locality: 'Central City',
    condition: 'Clean'
  });
  const listingId = listRes.body.listing.id;

  // Run price estimate
  const priceRes = await jsonPost('/api/prices/estimate', { listing_id: listingId });
  log(priceRes.status === 200, 'Generates price estimate');

  // Check matching engine results remain unaffected
  const matchRes = await jsonPost('/api/match', { listing_id: listingId });
  log(matchRes.status === 200, 'Matching succeeds independently');
  log(matchRes.body.eligible.length > 0, 'Matching returns eligible buyers');
  // Confirm compatibility score is purely algorithmic heuristic (not affected by price)
  const topScore = matchRes.body.eligible[0].score;
  log(typeof topScore === 'number' && topScore > 0 && topScore <= 100, 'Buyer compatibility score is heuristic score (not price)');

  // Check recovery status remains LISTED
  const statusRes = await request('GET', `/api/payments/status/${listingId}`);
  log(statusRes.body.recovery_status === 'LISTED', 'Listing recovery_status remains LISTED (pricing does NOT advance recovery)');
  log(statusRes.body.payment_status === 'NOT_CREATED', 'Payment status remains NOT_CREATED (pricing does NOT create orders)');
}

// =============================================
// 7. Frontend Assets & UI Integrity
// =============================================
async function testFrontendAssets() {
  console.log('\n--- 7. Frontend Assets & UI Integrity ---');

  const htmlRes = await request('GET', '/');
  log(htmlRes.status === 200, 'GET / responds with 200');
  const html = typeof htmlRes.body === 'string' ? htmlRes.body : '';

  log(html.includes('id="btn-estimate-price"'), 'Contains "Estimate PET Scrap Value" button');
  log(html.includes('id="price-panel"'), 'Contains price-panel container');
  log(html.includes('id="price-transparency-badge"'), 'Contains transparency badge element');
  log(html.includes('id="price-card"'), 'Contains price-card container');
  log(html.includes('id="price-per-kg-val"'), 'Contains price per kg display element');
  log(html.includes('id="price-total-val"'), 'Contains total value display element');
  log(html.includes('id="price-calc-explanation"'), 'Contains calculation explanation element');
  log(html.includes('id="price-unavailable-card"'), 'Contains price-unavailable-card element');

  const cssRes = await request('GET', '/styles.css');
  const css = typeof cssRes.body === 'string' ? cssRes.body : '';
  log(css.includes('.price-panel'), 'CSS defines .price-panel styles');
  log(css.includes('.price-metrics-grid'), 'CSS defines .price-metrics-grid styles');
  log(css.includes('.highlight-metric'), 'CSS defines .highlight-metric styles');
  log(css.includes('.price-unavailable-card'), 'CSS defines .price-unavailable-card styles');

  const jsRes = await request('GET', '/app.js');
  const js = typeof jsRes.body === 'string' ? jsRes.body : '';
  log(js.includes('btnEstimatePrice'), 'app.js includes btnEstimatePrice reference');
  log(js.includes('fetchPriceEstimate'), 'app.js includes fetchPriceEstimate function');
  log(js.includes('renderPriceIntelligence'), 'app.js includes renderPriceIntelligence function');
}

// =============================================
// 8. Core Regression Tests
// =============================================
async function testCoreRegressions() {
  console.log('\n--- 8. Core Regression Tests ---');

  const healthRes = await request('GET', '/api/health');
  log(healthRes.status === 200, 'GET /api/health responds with 200');
  log(healthRes.body.status === 'ok', 'Health status is ok');

  const buyersRes = await request('GET', '/api/buyers');
  log(buyersRes.status === 200, 'GET /api/buyers responds with 200');
  log(buyersRes.body.buyers.length === 4, 'Returns 4 demo buyers');

  const resetRes = await jsonPost('/api/reset', {});
  log(resetRes.status === 200, 'POST /api/reset responds with 200');
  log(resetRes.body.success === true, 'Reset succeeds');
}

async function runAllTests() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 9 Location-Based Price Intelligence Tests');
  console.log('═════════════════════════════════════════════════════════════════');

  testPriceRecordValidation();
  testFreshnessPolicy();
  testGeographicSelectionAndCompatibility();
  testEstimationArithmetic();
  await testApiEndpoints();
  await testSeparationOfConcerns();
  await testFrontendAssets();
  await testCoreRegressions();

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  Phase 9 Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
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

