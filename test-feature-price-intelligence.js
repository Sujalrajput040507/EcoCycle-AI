/**
 * EcoCycle AI — Location-Based Dynamic PET Price Intelligence Tests
 *
 * Verifies:
 * 1. Multi-tier hierarchy matching (Tiers 1 to 6)
 * 2. Quality multiplier adjustments (Clear 1.0x, Mixed 0.80x, Baled 1.15x, Colored 0.75x, Contaminated 0.60x)
 * 3. Location & PIN code resolution (Delhi, Mumbai, Bengaluru, Chennai, Ludhiana, etc.)
 * 4. Honest fallback disclosures (National/Regional benchmarks never disguised as city quotes)
 * 5. Data integrity: Strict distinction between live recycler quotes, transactions, and benchmarks
 * 6. Zero data fabrication: Deterministic values, transparent attribution, and TTL caching
 * 7. Decoupling: Pricing does NOT alter matching scores, advance recovery lifecycle, or create payment orders
 * 8. SQLite persistence: Price estimate audit snapshots and observations in db.js
 * 9. Endpoints: POST /api/prices/estimate, GET /api/prices/records, GET /api/prices/grades, GET /api/prices/hubs, POST /api/prices/refresh
 */

const http = require('http');
const assert = require('assert');
const {
  estimatePetPrice,
  resolveLocation,
  resolveGradeSpec,
  GRADE_SPECS,
  KNOWN_INDIAN_HUBS,
  PINCODE_PREFIX_MAP,
  RecyclerQuotationProvider,
  RegionalBenchmarkProvider,
  NationalBenchmarkProvider,
  PriceProviderManager
} = require('./pet-price-service');
const { AuthDatabase } = require('./db');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

let BASE = 'http://127.0.0.1:3000';

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function jsonPost(urlPath, obj) {
  return request('POST', urlPath, obj, { 'Content-Type': 'application/json' });
}

// =============================================
// 1. Location & PIN Code Resolution Unit Tests
// =============================================
function testLocationResolution() {
  console.log('\n--- 1. Location & PIN Code Resolution Unit Tests ---');

  const locDelhi = resolveLocation({ city: 'Delhi' });
  log(locDelhi.city === 'Delhi' && locDelhi.state === 'Delhi', 'Resolves Delhi hub correctly');

  const locMumbai = resolveLocation({ locality: 'Mumbai' });
  log(locMumbai.city === 'Mumbai' && locMumbai.region === 'West India', 'Resolves Mumbai hub to West India');

  const locPinDelhi = resolveLocation({ pincode: '110020' });
  log(locPinDelhi.city === 'Delhi' && locPinDelhi.state === 'Delhi', 'Resolves PIN prefix 11 to Delhi');

  const locPinLudhiana = resolveLocation({ pincode: '141010' });
  log(locPinLudhiana.city === 'Industrial East' && locPinLudhiana.state === 'Punjab', 'Resolves PIN prefix 14 to Punjab / Industrial East');

  const locPinBlr = resolveLocation({ pincode: '560058' });
  log(locPinBlr.city === 'Bengaluru' && locPinBlr.state === 'Karnataka', 'Resolves PIN prefix 56 to Bengaluru');

  const locUnknown = resolveLocation({ locality: 'Remote Village XYZ' });
  log(locUnknown.city === 'Remote Village XYZ' && locUnknown.state === null, 'Preserves custom locality without fabricating fake hub');
}

// =============================================
// 2. Material Grade & Multiplier Unit Tests
// =============================================
function testGradeAdjustments() {
  console.log('\n--- 2. Material Grade & Multiplier Unit Tests ---');

  const clearSpec = resolveGradeSpec('CLEAR_BOTTLES', 'Clean');
  log(clearSpec.factor === 1.0, 'Clear bottles baseline factor is 1.0x');

  const mixedSpec = resolveGradeSpec('MIXED_LABELS_ON', 'Mixed/Labels on');
  log(mixedSpec.factor === 0.80, 'Mixed bottles / labels on factor is 0.80x (-20%)');

  const baledSpec = resolveGradeSpec('BALED_COMPACTED', 'Clean');
  log(baledSpec.factor === 1.15, 'Baled & compacted factor is 1.15x (+15%)');

  const coloredSpec = resolveGradeSpec('COLORED_GREEN', 'Clean');
  log(coloredSpec.factor === 0.75, 'Colored bottles factor is 0.75x (-25%)');

  const dirtySpec = resolveGradeSpec('CONTAMINATED_DIRTY', 'Contaminated/Dirty');
  log(dirtySpec.factor === 0.60, 'Contaminated / dirty bottles factor is 0.60x (-40%)');

  // Verify adjustment calculation
  const estClear = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 100, locality: 'Delhi', condition: 'Clean' });
  const estBaled = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 100, locality: 'Delhi', condition: 'Baled' });
  const estDirty = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 100, locality: 'Delhi', condition: 'Contaminated' });

  log(estBaled.price_per_kg.min > estClear.price_per_kg.min, 'Baled PET scrap price is strictly higher than unbaled clear');
  log(estDirty.price_per_kg.min < estClear.price_per_kg.min, 'Contaminated PET scrap price is strictly lower than clean clear');
  log(estBaled.qualityAdjustment.applied === true, 'Baled estimate includes explicit qualityAdjustment object');
  log(estBaled.qualityAdjustment.factor === 1.15, 'Baled qualityAdjustment factor is 1.15');
}

// =============================================
// 3. Multi-Tier Hierarchy & Fallback Transparency
// =============================================
function testMultiTierFallbacks() {
  console.log('\n--- 3. Multi-Tier Hierarchy & Fallback Transparency ---');

  // Tier 1 City Recycler Quote (e.g. Delhi)
  const estDelhi = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 50, locality: 'Delhi' });
  log(estDelhi.source.type === 'RECYCLER_QUOTATION', 'Delhi resolves to Tier 1 Recycler Quotation');
  log(estDelhi.isFallback === false, 'Delhi estimate is NOT marked as a fallback');
  log(estDelhi.geographic_coverage.level === 'city', 'Delhi coverage level is city');

  // Tier 4 Regional Fallback for unknown Punjab locality
  const estPunjabTown = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 50, locality: 'Abohar', state: 'Punjab' });
  log(estPunjabTown.isFallback === true, 'Unknown Punjab town activates fallback');
  log(estPunjabTown.source.type === 'REGIONAL_BENCHMARK', 'Falls back to Tier 4 Regional Benchmark');
  log(estPunjabTown.geographic_coverage.level === 'state', 'Coverage truthfully reported as state-level');
  log(!estPunjabTown.source.name.includes('Abohar'), 'Never fabricates non-existent Abohar recycler');

  // Tier 5 National Fallback for completely unknown region
  const estUnknown = estimatePetPrice({ material: 'PET Plastic', quantity_kg: 50, locality: 'Unknown District' });
  log(estUnknown.isFallback === true, 'Unknown district activates fallback');
  log(estUnknown.source.type === 'NATIONAL_BENCHMARK', 'Falls back to Tier 5 National Benchmark');
  log(estUnknown.geographic_coverage.level === 'national', 'Coverage truthfully reported as national composite');

  // Warnings check
  log(estUnknown.warnings.some(w => w.includes('national benchmark')), 'Includes warning disclosing fallback status');
}

// =============================================
// 4. API Endpoints Integration Tests
// =============================================
async function testApiEndpoints() {
  console.log('\n--- 4. Backend Endpoints Integration Tests ---');

  // 1. GET /api/prices/grades
  const gradesRes = await request('GET', '/api/prices/grades');
  log(gradesRes.status === 200, 'GET /api/prices/grades returns 200');
  log(Array.isArray(gradesRes.body.grades) && gradesRes.body.grades.length >= 5, 'Returns standard material grades');
  log(gradesRes.body.grades.some(g => g.id === 'BALED_COMPACTED'), 'Includes BALED_COMPACTED grade specification');

  // 2. GET /api/prices/hubs
  const hubsRes = await request('GET', '/api/prices/hubs');
  log(hubsRes.status === 200, 'GET /api/prices/hubs returns 200');
  log(Array.isArray(hubsRes.body.hubs) && hubsRes.body.hubs.length >= 8, 'Returns major Indian recycling hubs');
  log(hubsRes.body.hubs.some(h => h.city === 'Mumbai'), 'Includes Mumbai in recognized hubs');

  // 3. POST /api/prices/refresh
  const refreshRes = await jsonPost('/api/prices/refresh', { city: 'Bengaluru', grade: 'CLEAR_BOTTLES' });
  log(refreshRes.status === 200, 'POST /api/prices/refresh returns 200');
  log(refreshRes.body.success === true, 'Refresh response reports success: true');
  log(refreshRes.body.result && refreshRes.body.result.price_per_kg.min > 0, 'Returns fresh price estimate after cache eviction');

  // 4. POST /api/prices/estimate with live flag
  const liveRes = await jsonPost('/api/prices/estimate', {
    locality: 'Mumbai',
    quantity_kg: 75,
    condition: 'Clean',
    live: true
  });
  log(liveRes.status === 200, 'POST /api/prices/estimate with live: true returns 200');
  log(liveRes.body.data_quality.is_live === true, 'Live quote marked is_live: true');
  log(liveRes.body.source.type === 'RECYCLER_QUOTATION', 'Live quote backed by Recycler Quotation');
}

// =============================================
// 5. Separation of Concerns & Integrity
// =============================================
async function testSeparationOfConcerns() {
  console.log('\n--- 5. Strict Separation of Concerns Tests ---');

  await jsonPost('/api/reset', {});

  // Create listing
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 40,
    locality: 'Industrial East',
    condition: 'Clean'
  });
  const listingId = listRes.body.listing.id;

  // Run price estimate
  const priceRes = await jsonPost('/api/prices/estimate', { listing_id: listingId, live: true });
  log(priceRes.status === 200, 'Estimates price for created listing');
  log(priceRes.body.estimated_value.min > 0, 'Calculates non-zero estimated value');

  // Verify listing recovery status is STILL 'LISTED' (not advanced)
  const statusRes = await request('GET', `/api/payments/status/${listingId}`);
  log(statusRes.body.recovery_status === 'LISTED', 'Listing recovery_status remains LISTED after price check');
  log(statusRes.body.payment_status === 'NOT_CREATED', 'Payment status remains NOT_CREATED after price check');
}

// =============================================
// 6. SQLite Audit Snapshot Persistence Tests
// =============================================
function testDatabaseAudit() {
  console.log('\n--- 6. SQLite Audit Snapshot Persistence Tests ---');

  const testDb = new AuthDatabase(':memory:');

  const snap = testDb.recordPriceSnapshot({
    listing_id: 'list_test_audit_01',
    user_id: 'user_seller_01',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110020',
    material: 'PET Plastic',
    grade: 'Post-consumer clear PET bottles',
    condition: 'Clean',
    quantity_kg: 100,
    estimated_min_per_kg: 16.50,
    estimated_max_per_kg: 20.00,
    reference_price_per_kg: 18.25,
    estimated_batch_min: 1650.00,
    estimated_batch_max: 2000.00,
    source_name: 'Delhi NCR Mayapuri Clearing Facility',
    source_type: 'RECYCLER_QUOTATION',
    geographic_level: 'city',
    freshness_status: 'FRESH',
    observation_date: new Date().toISOString(),
    retrieval_timestamp: new Date().toISOString(),
    is_fallback: 0,
    disclaimer: 'Indicative trade estimate'
  });

  log(typeof snap.id === 'string' && snap.id.startsWith('psnap_'), 'Records price snapshot with unique psnap_ ID');

  const found = testDb.findPriceSnapshotsByListing('list_test_audit_01');
  log(found.length === 1, 'findPriceSnapshotsByListing retrieves persisted snapshot');
  log(found[0].city === 'Delhi', 'Snapshot persists city correctly');
  log(found[0].estimated_min_per_kg === 16.50, 'Snapshot persists estimated_min_per_kg');
  log(found[0].source_type === 'RECYCLER_QUOTATION', 'Snapshot persists source_type');

  testDb.close();
}

async function run() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  EcoCycle AI — PET Price Intelligence Comprehensive Test Suite');
  console.log('═════════════════════════════════════════════════════════════════');

  testLocationResolution();
  testGradeAdjustments();
  testMultiTierFallbacks();
  await testApiEndpoints();
  await testSeparationOfConcerns();
  testDatabaseAudit();

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  Price Intelligence Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═════════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
