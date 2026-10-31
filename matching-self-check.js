'use strict';

/**
 * Runs the Task 2 matching scenarios against matching.js.
 * This is ordinary Node.js — not an AI score generator.
 */

var buyers = require('./data/buyers.json');
var matching = require('./matching');

var failed = 0;
var passed = 0;

function listing(overrides) {
  var base = {
    listingId: 'test',
    materialCategory: 'PET plastic bottles',
    quantity: 2.5,
    unit: 'kg',
    locationArea: 'Chandigarh',
    condition: 'clean'
  };
  Object.keys(overrides || {}).forEach(function (key) {
    base[key] = overrides[key];
  });
  return base;
}

function ids(rows) {
  return rows
    .map(function (row) {
      return row.buyerId;
    })
    .join(', ');
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS  ' + name);
  } else {
    failed += 1;
    console.log('FAIL  ' + name + ' — ' + (detail || ''));
  }
}

var cleanSmall = matching.matchListing(listing(), buyers);
check(
  '2.5 kg clean PET in Chandigarh: one eligible buyer',
  cleanSmall.eligibleCount === 1,
  'eligibleCount=' + cleanSmall.eligibleCount
);
check(
  '2.5 kg clean PET in Chandigarh: GreenGrid is the recommendation',
  cleanSmall.eligibleMatches[0] && cleanSmall.eligibleMatches[0].buyerId === 'demo-buyer-greengrid',
  ids(cleanSmall.eligibleMatches)
);
check(
  '2.5 kg clean PET in Chandigarh: GreenGrid total is 100',
  cleanSmall.eligibleMatches[0] && cleanSmall.eligibleMatches[0].totalScore === 100,
  cleanSmall.eligibleMatches[0] && String(cleanSmall.eligibleMatches[0].totalScore)
);
check(
  '2.5 kg: Tricity and Punjab fail quantity (not full recommendations)',
  cleanSmall.ineligibleBuyers.length === 2 &&
    cleanSmall.ineligibleBuyers.every(function (row) {
      return row.failedHardRequirements.indexOf('quantity') !== -1 && row.eligible === false;
    }),
  ids(cleanSmall.ineligibleBuyers)
);

var belowMin = matching.matchListing(listing({ quantity: 0.5 }), buyers);
check(
  'Quantity below all buyer minimums: no eligible buyer',
  belowMin.eligibleCount === 0,
  'eligibleCount=' + belowMin.eligibleCount
);
check(
  'Quantity below all buyer minimums: every buyer fails quantity',
  belowMin.ineligibleBuyers.length === 3 &&
    belowMin.ineligibleBuyers.every(function (row) {
      return row.failedHardRequirements.indexOf('quantity') !== -1;
    }),
  ids(belowMin.ineligibleBuyers)
);

var overOne = matching.matchListing(listing({ quantity: 80, locationArea: 'Panchkula' }), buyers);
check(
  '80 kg exceeds GreenGrid and Tricity capacity',
  overOne.ineligibleBuyers.some(function (row) {
    return row.buyerId === 'demo-buyer-greengrid' && row.failedHardRequirements.indexOf('quantity') !== -1;
  }) &&
    overOne.ineligibleBuyers.some(function (row) {
      return row.buyerId === 'demo-buyer-tricity' && row.failedHardRequirements.indexOf('quantity') !== -1;
    }),
  ids(overOne.ineligibleBuyers)
);
check(
  '80 kg Panchkula: Punjab remains eligible (15–150 kg)',
  overOne.eligibleCount === 1 && overOne.eligibleMatches[0].buyerId === 'demo-buyer-punjab',
  ids(overOne.eligibleMatches)
);

var overAll = matching.matchListing(listing({ quantity: 300 }), buyers);
check(
  'Quantity above all maxima: no eligible buyer',
  overAll.eligibleCount === 0,
  'eligibleCount=' + overAll.eligibleCount
);

var mixed = matching.matchListing(listing({ quantity: 8, condition: 'mixed' }), buyers);
check(
  'Mixed 8 kg Chandigarh: Tricity ranks above GreenGrid',
  mixed.eligibleCount === 2 &&
    mixed.eligibleMatches[0].buyerId === 'demo-buyer-tricity' &&
    mixed.eligibleMatches[1].buyerId === 'demo-buyer-greengrid',
  ids(mixed.eligibleMatches)
);
check(
  'Mixed 8 kg: GreenGrid quality is 15, not 100',
  mixed.eligibleMatches[1] && mixed.eligibleMatches[1].breakdown.qualityCompatibility.score === 15,
  mixed.eligibleMatches[1] && String(mixed.eligibleMatches[1].breakdown.qualityCompatibility.score)
);
check(
  'Unknown 8 kg: GreenGrid quality is 40 (not a perfect score)',
  matching.matchListing(listing({ quantity: 8, condition: 'unknown' }), buyers).eligibleMatches.some(
    function (row) {
      return row.buyerId === 'demo-buyer-greengrid' && row.breakdown.qualityCompatibility.score === 40;
    }
  ),
  'quality score check'
);

var elsewhere = matching.matchListing(listing({ locationArea: 'Mumbai' }), buyers);
check(
  'Different location Mumbai: still eligible on material+quantity',
  elsewhere.eligibleCount === 1 && elsewhere.eligibleMatches[0].buyerId === 'demo-buyer-greengrid',
  ids(elsewhere.eligibleMatches)
);
check(
  'Different location Mumbai: location score is 20, not 100',
  elsewhere.eligibleMatches[0] && elsewhere.eligibleMatches[0].breakdown.locationFit.score === 20,
  elsewhere.eligibleMatches[0] && String(elsewhere.eligibleMatches[0].breakdown.locationFit.score)
);
check(
  'Different location Mumbai: total is 84, not a silent perfect score',
  elsewhere.eligibleMatches[0] && elsewhere.eligibleMatches[0].totalScore === 84,
  elsewhere.eligibleMatches[0] && String(elsewhere.eligibleMatches[0].totalScore)
);

var missingBuyer = {
  buyerId: 'demo-incomplete',
  displayName: 'Incomplete Demo Buyer',
  isDemoData: true,
  dataLabel: 'Fictitious sample recycler — not a real business or confirmed offer',
  acceptedMaterialCategories: ['PET plastic bottles']
};
var missing = matching.scoreBuyer(listing(), missingBuyer);
check(
  'Missing quantity limits: not eligible and quantity score 0',
  missing.eligible === false &&
    missing.breakdown.quantityCompatibility.score === 0 &&
    missing.breakdown.quantityCompatibility.missingData === true,
  JSON.stringify(missing.failedHardRequirements)
);
check(
  'Every demo buyer is labelled fictitious',
  buyers.every(function (buyer) {
    return buyer.isDemoData === true && /fictitious/i.test(buyer.dataLabel);
  }),
  'buyer labels'
);

var whitespaceArea = matching.matchListing(listing({ locationArea: '   ' }), buyers);
check(
  'Whitespace area treated as missing (scores 50, not 70)',
  whitespaceArea.eligibleMatches[0] &&
    whitespaceArea.eligibleMatches[0].breakdown.locationFit.score === 50 &&
    whitespaceArea.eligibleMatches[0].breakdown.locationFit.missingData === true,
  'location score check'
);

console.log('');
console.log('Passed: ' + passed + '  Failed: ' + failed);
if (failed > 0) {
  process.exit(1);
}
