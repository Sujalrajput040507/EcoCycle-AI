/**
 * EcoCycle AI — Feature 2: Smart Buyer Matching Explainable Reasons Test Suite
 */

const http = require('http');
const { matchBuyers, generateStructuredReasons, FACTOR_WEIGHTS } = require('./matching');

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
  console.log('   EcoCycle AI — Feature 2: Smart Buyer Matching Reasons Suite   ');
  console.log('===================================================================\n');

  // 1. Service-Level Unit Tests
  console.log('--- 1. Matching Service & Factor Weight Unit Tests ---');
  log(FACTOR_WEIGHTS.MATERIAL === 35, 'Material factor weight is 35 points');
  log(FACTOR_WEIGHTS.QUANTITY === 20, 'Quantity factor weight is 20 points');
  log(FACTOR_WEIGHTS.LOCATION === 20, 'Location factor weight is 20 points');
  log(FACTOR_WEIGHTS.DEMAND === 15, 'Demand factor weight is 15 points');
  log(FACTOR_WEIGHTS.CONDITION === 10, 'Condition factor weight is 10 points');
  log(
    FACTOR_WEIGHTS.MATERIAL + FACTOR_WEIGHTS.QUANTITY + FACTOR_WEIGHTS.LOCATION + FACTOR_WEIGHTS.DEMAND + FACTOR_WEIGHTS.CONDITION === 100,
    'Weights sum to exactly 100 points'
  );

  const sampleBuyer = {
    id: 'buyer_pet_01',
    name: 'EcoPlast Industries',
    accepted_materials: ['PET Plastic'],
    min_quantity_kg: 5,
    max_quantity_kg: 500,
    localities: ['Central City'],
    accepted_conditions: ['Clean', 'Mixed/Labels on'],
    demand_level: 'High'
  };

  const reasons = generateStructuredReasons(sampleBuyer, {
    confirmed_material: 'PET Plastic',
    quantity_kg: 25,
    locality: 'Central City',
    condition: 'Clean'
  }, { material: 1.0, quantity: 1.0, location: 1.0, demand: 1.0, condition: 1.0 }, true);

  log(Array.isArray(reasons), 'generateStructuredReasons returns an array');
  log(reasons.length === 5, 'Contains exactly 5 structured factor assessments');

  const matFactor = reasons.find(r => r.factor === 'MATERIAL');
  log(matFactor && matFactor.status === 'MATCH' && matFactor.weight === 0.35, 'Material evaluated as MATCH with 0.35 weight');

  const locFactor = reasons.find(r => r.factor === 'LOCATION');
  log(locFactor && locFactor.status === 'MATCH' && locFactor.weight === 0.20, 'Location evaluated as MATCH with 0.20 weight');

  // 2. Integration Tests via POST /api/match
  console.log('\n--- 2. POST /api/match Integration Tests ---');

  const matchRes = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 25,
    locality: 'Central City',
    condition: 'Clean'
  });

  log(matchRes.status === 200, 'POST /api/match responds with 200');
  log(Array.isArray(matchRes.body.eligible), 'Returns eligible buyers array');
  log(matchRes.body.eligible.length > 0, 'Found at least 1 eligible buyer');

  const firstBuyer = matchRes.body.eligible[0];
  log(typeof firstBuyer.score === 'number', 'Buyer includes numerical score');
  log(Array.isArray(firstBuyer.reasons), 'Buyer includes structured reasons array');
  log(firstBuyer.reasons.length === 5, 'Structured reasons contain all 5 factors');
  
  firstBuyer.reasons.forEach(f => {
    log(
      ['MATERIAL', 'QUANTITY', 'LOCATION', 'DEMAND', 'CONDITION'].includes(f.factor),
      `Factor ${f.factor} is recognized`
    );
    log(
      ['MATCH', 'PARTIAL', 'MISMATCH'].includes(f.status),
      `Factor ${f.factor} status is valid enum: ${f.status}`
    );
    log(
      typeof f.message === 'string' && f.message.length > 0,
      `Factor ${f.factor} includes explainable message`
    );
  });

  // Backwards compatibility check
  log(Array.isArray(firstBuyer.match_reasons), 'Preserves legacy match_reasons string array');
  log(typeof firstBuyer.score_breakdown === 'object', 'Preserves legacy score_breakdown object');

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
