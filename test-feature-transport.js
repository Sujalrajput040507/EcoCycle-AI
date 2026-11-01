/**
 * EcoCycle AI — Feature 4: Transport Feasibility Checker Test Suite
 */

const http = require('http');
const {
  calculateHaversineDistance,
  evaluateTransportFeasibility,
  TRANSPORT_DISCLAIMER
} = require('./transport-service');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

let BASE;

function jsonPost(urlPath, obj) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const body = JSON.stringify(obj);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

async function runTests() {
  console.log('===================================================================');
  console.log('   EcoCycle AI — Feature 4: Transport Feasibility Test Suite     ');
  console.log('===================================================================\n');

  // 1. Service Unit Tests
  console.log('--- 1. Haversine Distance & Cost Model Unit Tests ---');
  // Identical coordinates
  const distZero = calculateHaversineDistance(12.9716, 77.5946, 12.9716, 77.5946);
  log(distZero === 0, 'Distance between identical coordinates is 0 km');

  // Known distance: Bangalore Central (12.9716, 77.5946) to Whitefield (12.9698, 77.7500) ~ 16.8 km straight-line
  const distBlr = calculateHaversineDistance(12.9716, 77.5946, 12.9698, 77.7500);
  log(distBlr > 15 && distBlr < 18, 'Haversine calculation accurate within expected range (~16.8 km)', `${distBlr} km`);

  // Evaluate feasibility helper
  const feas1 = evaluateTransportFeasibility({
    seller_lat: 12.9716,
    seller_lng: 77.5946,
    buyer_id: 'buyer_pet_01',
    quantity_kg: 50,
    price_per_kg: 16.50
  });

  log(feas1.distance_method === 'STRAIGHT_LINE_ESTIMATE', 'Honest distance attribution: STRAIGHT_LINE_ESTIMATE');
  log(typeof feas1.distance_km === 'number' && feas1.distance_km > 0, 'Computes distance in km');
  log(typeof feas1.estimated_transport_cost === 'number', 'Calculates estimated transport cost');
  log(feas1.gross_material_value === 825.00, 'Calculates gross material value (50 * 16.50 = 825.00)');
  log(feas1.estimated_net_value === Math.round((825.00 - feas1.estimated_transport_cost) * 100) / 100, 'Calculates net value (gross - transport)');
  log(typeof feas1.disclaimer === 'string' && feas1.disclaimer.includes('straight-line'), 'Includes mandatory transport disclaimer');

  // Negative net value triggers warning
  const feasWarning = evaluateTransportFeasibility({
    distance_km: 80,
    quantity_kg: 10,
    price_per_kg: 10.00,
    cost_per_km: 15.00,
    base_pickup_fee: 250.00
  });
  log(feasWarning.status === 'FEASIBLE_WITH_WARNING' || feasWarning.status === 'NOT_FEASIBLE', 'High transport cost vs low scrap value triggers warning/not-feasible', feasWarning.status);

  // Exceeding maximum radius
  const feasExceed = evaluateTransportFeasibility({
    distance_km: 500,
    quantity_kg: 100,
    price_per_kg: 18.00,
    max_pickup_km: 100
  });
  log(feasExceed.status === 'NOT_FEASIBLE', 'Exceeding max pickup distance marks NOT_FEASIBLE');

  // 2. Integration Tests via POST /api/transport/feasibility
  console.log('\n--- 2. POST /api/transport/feasibility API Tests ---');

  const apiRes = await jsonPost('/api/transport/feasibility', {
    buyer_id: 'buyer_pet_01',
    pickup_lat: 12.9716,
    pickup_lng: 77.5946,
    quantity_kg: 75,
    unit_price: 17.00
  });

  log(apiRes.status === 200, 'POST /api/transport/feasibility responds with 200');
  const d = apiRes.body;
  log(d.success === true, 'Response declares success: true');
  log(d.distance_type === 'STRAIGHT_LINE_ESTIMATE', 'Returns honest distance_type attribute');
  log(typeof d.distance_km === 'number', 'Returns numeric distance_km');
  log(typeof d.estimated_transport_cost === 'number', 'Returns numeric estimated_transport_cost');
  log(typeof d.gross_material_value === 'number', 'Returns numeric gross_material_value');
  log(typeof d.estimated_net_value === 'number', 'Returns numeric estimated_net_value');
  log(['FEASIBLE', 'FEASIBLE_WITH_WARNING', 'NOT_FEASIBLE'].includes(d.status), 'Returns valid feasibility status enum: ' + d.status);
  log(typeof d.disclaimer === 'string', 'Mandatory disclaimer string present in API response');

  // Rejection with invalid buyer ID
  const invalidBuyerRes = await jsonPost('/api/transport/feasibility', {
    buyer_id: 'non_existent_buyer_xyz'
  });
  log(invalidBuyerRes.status === 404, 'Rejects non-existent buyer with HTTP 404');

  console.log('\n===================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('===================================================================\n');

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
    failures = await runTests();
  } catch (err) {
    console.error('Test runner crashed:', err);
    failures = 1;
  }

  if (serverRef) serverRef.close();
  process.exit(failures > 0 ? 1 : 0);
}

main();

