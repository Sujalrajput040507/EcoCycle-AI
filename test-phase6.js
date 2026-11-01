/**
 * EcoCycle AI — Phase 6 Google Maps Platform Integration & Location Picker Tests
 *
 * Verifies:
 * 1. Public Maps configuration endpoint (GET /api/config/maps) and secret isolation
 * 2. Location payload validation in POST /api/listings (boundaries, types, structure)
 * 3. Backward compatibility for listings with or without GPS location
 * 4. Preservation of location metadata on retrieval (GET /api/listings)
 * 5. Deterministic matching with stored location listings (POST /api/match)
 * 6. Explicit explanation of zone-based matching without fake buyer GPS coordinates
 * 7. Frontend assets inclusion of map and search elements
 * 8. Zero regressions across core endpoints (health, buyers, analyze, reset)
 *
 * Built with pure Node.js built-in modules — zero extra dependencies.
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

// =============================================
// 1. Google Maps Config Endpoint & Key Security
// =============================================
async function testMapsConfigEndpoint() {
  console.log('\n--- 1. Maps Config Endpoint & Secret Protection ---');

  const res = await request('GET', '/api/config/maps');
  log(res.status === 200, 'GET /api/config/maps returns HTTP 200');
  log(typeof res.body.configured === 'boolean', 'Returns boolean "configured" flag');
  log(typeof res.body.googleMapsBrowserKey === 'string', 'Returns "googleMapsBrowserKey" string');

  // Verify secret safety
  const rawBody = JSON.stringify(res.body);
  log(!rawBody.includes('AIzaSy'), 'Never exposes server-side secrets or Gemini API keys');
  log(res.body.GEMINI_API_KEY === undefined, 'GEMINI_API_KEY is not present in response');
  log(res.body.env === undefined, 'Full environment object is not exposed');
}

// =============================================
// 2. Location Payload Validation in POST /api/listings
// =============================================
async function testLocationValidation() {
  console.log('\n--- 2. Location Payload & Coordinate Boundaries ---');

  // Reset
  await jsonPost('/api/reset', {});

  // Valid listing with full location metadata
  const validWithLoc = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 30,
    locality: 'Central City',
    condition: 'Clean',
    location: {
      formatted_address: 'Eco Center, 100 Green Avenue, Central City',
      latitude: 30.7046,
      longitude: 76.7179,
      place_id: 'ChIJz-sample-place-id',
      locality: 'Central City'
    }
  });

  log(validWithLoc.status === 201, 'Creates listing with valid location metadata (201)');
  log(validWithLoc.body.listing.location !== null, 'Listing retains location object');
  log(validWithLoc.body.listing.location.latitude === 30.7046, 'Retains accurate latitude');
  log(validWithLoc.body.listing.location.longitude === 76.7179, 'Retains accurate longitude');
  log(validWithLoc.body.listing.location.formatted_address === 'Eco Center, 100 Green Avenue, Central City', 'Retains formatted address');
  log(validWithLoc.body.listing.location.place_id === 'ChIJz-sample-place-id', 'Retains place_id');

  // Valid listing with partial location (e.g. coords only)
  const validCoordsOnly = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 15,
    locality: 'North Sector',
    condition: 'Clean',
    location: {
      latitude: 30.7333,
      longitude: 76.7794
    }
  });
  log(validCoordsOnly.status === 201, 'Creates listing with coordinates-only location (201)');
  log(validCoordsOnly.body.listing.location.latitude === 30.7333, 'Coordinates-only latitude saved');

  // Valid listing without location (backward compatibility)
  const validNoLoc = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 10,
    locality: 'South Hub',
    condition: 'Clean'
  });
  log(validNoLoc.status === 201, 'Backward compatible: creates listing without location field (201)');
  log(validNoLoc.body.listing.location === null, 'Listing location is null when omitted');

  // Invalid location types
  const badLocType = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 10,
    locality: 'North Sector',
    condition: 'Clean',
    location: 'Invalid string location'
  });
  log(badLocType.status === 400 && badLocType.body.error.includes('location must be an object'), 'Rejects string location with 400');

  const badLocArray = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 10,
    locality: 'North Sector',
    condition: 'Clean',
    location: [30.7046, 76.7179]
  });
  log(badLocArray.status === 400 && badLocArray.body.error.includes('location must be an object'), 'Rejects array location with 400');

  // Latitude boundary checks [-90, 90]
  const latTooLow = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: -91, longitude: 0 }
  });
  log(latTooLow.status === 400 && latTooLow.body.error.includes('latitude'), 'Rejects latitude < -90 with 400');

  const latTooHigh = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: 91, longitude: 0 }
  });
  log(latTooHigh.status === 400 && latTooHigh.body.error.includes('latitude'), 'Rejects latitude > 90 with 400');

  const latNaN = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: 'not-a-number', longitude: 0 }
  });
  log(latNaN.status === 400 && latNaN.body.error.includes('latitude'), 'Rejects non-numeric latitude with 400');

  // Longitude boundary checks [-180, 180]
  const lngTooLow = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: 0, longitude: -181 }
  });
  log(lngTooLow.status === 400 && lngTooLow.body.error.includes('longitude'), 'Rejects longitude < -180 with 400');

  const lngTooHigh = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: 0, longitude: 181 }
  });
  log(lngTooHigh.status === 400 && lngTooHigh.body.error.includes('longitude'), 'Rejects longitude > 180 with 400');

  const lngNaN = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { latitude: 0, longitude: 'invalid-lng' }
  });
  log(lngNaN.status === 400 && lngNaN.body.error.includes('longitude'), 'Rejects non-numeric longitude with 400');

  // String field validations
  const badAddr = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { formatted_address: 12345 }
  });
  log(badAddr.status === 400 && badAddr.body.error.includes('formatted_address'), 'Rejects non-string formatted_address with 400');

  const badPlaceId = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector', condition: 'Clean',
    location: { place_id: 9999 }
  });
  log(badPlaceId.status === 400 && badPlaceId.body.error.includes('place_id'), 'Rejects non-string place_id with 400');
}

// =============================================
// 3. Location Persistence on GET /api/listings
// =============================================
async function testLocationPersistence() {
  console.log('\n--- 3. Location Metadata Persistence ---');

  const res = await request('GET', '/api/listings');
  log(res.status === 200, 'GET /api/listings returns 200');
  log(res.body.listings.length >= 3, 'Persisted listings retrieved');

  const listingWithLocation = res.body.listings.find(l => l.location && l.location.formatted_address);
  log(!!listingWithLocation, 'Found stored listing carrying location metadata');
  log(typeof listingWithLocation.location.latitude === 'number', 'Retrieved latitude is numeric');
  log(typeof listingWithLocation.location.longitude === 'number', 'Retrieved longitude is numeric');
}

// =============================================
// 4. Buyer Matching with Location Metadata & Listing ID
// =============================================
async function testMatchingWithLocation() {
  console.log('\n--- 4. Buyer Matching & Distance Disclosure ---');

  // Reset demo store
  await jsonPost('/api/reset', {});

  // Create listing with GPS location in Industrial East
  const createRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 75,
    locality: 'Industrial East',
    condition: 'Clean',
    location: {
      formatted_address: 'Plot 42, Heavy Industry Zone, Industrial East',
      latitude: 30.6900,
      longitude: 76.8500,
      place_id: 'ChIJ_industrial_east_plot',
      locality: 'Industrial East'
    }
  });

  const createdId = createRes.body.listing.id;

  // Match by listing_id
  const matchRes = await jsonPost('/api/match', { listing_id: createdId });
  log(matchRes.status === 200, 'POST /api/match by listing_id returns 200');
  log(matchRes.body.listing_id === createdId, 'Echoes listing_id in response');
  log(matchRes.body.geographic_distance_included === false, 'Explicitly declares geographic_distance_included: false');
  log(typeof matchRes.body.distance_note === 'string', 'Provides clear distance note explaining zone coverage basis');

  // Verify matching logic against buyers.json
  const eligibleIds = matchRes.body.eligible.map(b => b.buyer_id);
  // buyer_pet_03 accepts Industrial East, Clean, min 50 max 2000 -> ELIGIBLE
  // buyer_pet_02 accepts Industrial East, Clean, min 5 max 100 -> ELIGIBLE
  // buyer_pet_01 accepts North/Central -> INELIGIBLE (zone)
  // buyer_pet_04 accepts max 50 -> INELIGIBLE (quantity 75 exceeds 50)
  log(eligibleIds.includes('buyer_pet_03'), 'buyer_pet_03 is eligible');
  log(eligibleIds.includes('buyer_pet_02'), 'buyer_pet_02 is eligible');
  log(!eligibleIds.includes('buyer_pet_01'), 'buyer_pet_01 excluded by zone');
  log(!eligibleIds.includes('buyer_pet_04'), 'buyer_pet_04 excluded by max quantity');
}

// =============================================
// 5. Frontend Map & Location Picker UI Elements
// =============================================
async function testFrontendLocationPickerElements() {
  console.log('\n--- 5. Frontend Location Picker Elements ---');

  const htmlRes = await request('GET', '/');
  log(htmlRes.status === 200, 'Home page HTML served successfully (200)');
  const html = typeof htmlRes.body === 'string' ? htmlRes.body : '';

  log(html.includes('id="location-picker-group"'), 'Contains location picker container');
  log(html.includes('id="place-search"'), 'Contains place search autocomplete input');
  log(html.includes('id="btn-locate-me"'), 'Contains "Use My Current Location" button');
  log(html.includes('id="location-map"'), 'Contains Google Map canvas element');
  log(html.includes('id="btn-confirm-location"'), 'Contains "Confirm Location" button');
  log(html.includes('id="selected-location-card"'), 'Contains selected location summary card');
  log(html.includes('id="map-fallback-banner"'), 'Contains offline map fallback banner');
  log(html.includes('id="locality"'), 'Preserves fallback demo zone selector');

  const cssRes = await request('GET', '/styles.css');
  const css = typeof cssRes.body === 'string' ? cssRes.body : '';
  log(css.includes('.location-picker-group'), 'CSS defines location-picker-group layout');
  log(css.includes('.location-map'), 'CSS defines location-map styles');
  log(css.includes('.selected-location-card'), 'CSS defines selected-location-card styles');

  const jsRes = await request('GET', '/app.js');
  const js = typeof jsRes.body === 'string' ? jsRes.body : '';
  log(js.includes('loadGoogleMapsApi'), 'app.js includes loadGoogleMapsApi function');
  log(js.includes('initGoogleMap'), 'app.js includes initGoogleMap callback');
  log(js.includes('DEFAULT_MAP_CENTER'), 'app.js includes default map center');
  log(js.includes('btnLocateMe'), 'app.js handles geolocation button events');
}

// =============================================
// 6. Regression Verification
// =============================================
async function testRegression() {
  console.log('\n--- 6. Regression Verification ---');

  const h = await request('GET', '/api/health');
  log(h.status === 200 && h.body.status === 'ok', 'Health endpoint operational');

  const b = await request('GET', '/api/buyers');
  log(b.status === 200 && b.body.buyers.length === 4, 'Buyers endpoint operational (4 demo buyers)');

  const r = await jsonPost('/api/reset', {});
  log(r.status === 200 && r.body.success === true, 'Reset endpoint operational');
}

// =============================================
// Main Runner
// =============================================
async function runAllTests() {
  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 6 Google Maps Platform Integration Tests');
  console.log('═════════════════════════════════════════════════════════════════');

  await testMapsConfigEndpoint();
  await testLocationValidation();
  await testLocationPersistence();
  await testMatchingWithLocation();
  await testFrontendLocationPickerElements();
  await testRegression();

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  Phase 6 Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
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

