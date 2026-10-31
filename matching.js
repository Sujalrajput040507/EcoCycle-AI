'use strict';

/**
 * EcoCycle AI — recycler matching (Task 2)
 *
 * This file ranks demo buyers with ordinary JavaScript arithmetic.
 * It never calls an AI model. A teammate can recompute any score with a calculator.
 *
 * Hard eligibility (must pass to be a full recommendation):
 * - The buyer list of accepted materials includes the listing material.
 * - The listing quantity is between the buyer's min and max kg.
 * Missing material or quantity fields fail eligibility. They do not get a perfect score.
 *
 * Soft factors (change the score, do not fail eligibility by themselves):
 * - Location fit, demand, and quality/condition.
 *
 * Weights (must add to 100%):
 * - Material 35%, quantity 20%, location 20%, demand 15%, quality 10%.
 */

var WEIGHTS = {
  material: 0.35,
  quantity: 0.2,
  location: 0.2,
  demand: 0.15,
  quality: 0.1
};

var CALCULATION_VERSION = 'matching-v1';

var DEMAND_SCORES = {
  high: 100,
  medium: 65,
  low: 30
};

function matchListing(listing, buyers) {
  var results = buyers.map(function (buyer) {
    return scoreBuyer(listing, buyer);
  });

  var eligibleMatches = results
    .filter(function (item) {
      return item.eligible;
    })
    .sort(function (a, b) {
      return b.totalScore - a.totalScore;
    });

  var ineligibleBuyers = results.filter(function (item) {
    return !item.eligible;
  });

  return {
    calculationVersion: CALCULATION_VERSION,
    weights: {
      materialCompatibility: '35%',
      quantityCompatibility: '20%',
      locationFit: '20%',
      buyerDemand: '15%',
      qualityCompatibility: '10%'
    },
    scoringNotes: [
      'Scores are 0–100 for each factor, then multiplied by the weights above.',
      'Missing buyer fields score 0 for that factor and are labelled unknown.',
      'A buyer is a full recommendation only if material and quantity both pass.',
      'All buyer profiles in this demo are fictitious sample data.'
    ],
    listing: {
      listingId: listing.listingId || null,
      materialCategory: listing.materialCategory,
      quantity: listing.quantity,
      unit: listing.unit || 'kg',
      locationArea: listing.locationArea,
      condition: listing.condition
    },
    eligibleCount: eligibleMatches.length,
    eligibleMatches: eligibleMatches,
    ineligibleBuyers: ineligibleBuyers
  };
}

function scoreBuyer(listing, buyer) {
  var material = scoreMaterial(listing.materialCategory, buyer.acceptedMaterialCategories);
  var quantity = scoreQuantity(listing.quantity, buyer.minQuantityKg, buyer.maxQuantityKg);
  var location = scoreLocation(listing.locationArea, buyer.supportedAreas);
  var demand = scoreDemand(buyer.demandLevel);
  var quality = scoreQuality(listing.condition, buyer.acceptedConditions);

  var failedHardRequirements = [];
  if (!material.passedHardCheck) {
    failedHardRequirements.push('material');
  }
  if (!quantity.passedHardCheck) {
    failedHardRequirements.push('quantity');
  }

  var eligible = failedHardRequirements.length === 0;
  var totalScore = roundOne(
    material.score * WEIGHTS.material +
      quantity.score * WEIGHTS.quantity +
      location.score * WEIGHTS.location +
      demand.score * WEIGHTS.demand +
      quality.score * WEIGHTS.quality
  );

  var breakdown = {
    materialCompatibility: component(material, WEIGHTS.material),
    quantityCompatibility: component(quantity, WEIGHTS.quantity),
    locationFit: component(location, WEIGHTS.location),
    buyerDemand: component(demand, WEIGHTS.demand),
    qualityCompatibility: component(quality, WEIGHTS.quality)
  };

  return {
    buyerId: buyer.buyerId,
    displayName: buyer.displayName,
    isDemoData: true,
    dataLabel: buyer.dataLabel || 'Fictitious sample recycler — not a real business',
    acceptedMaterials: buyer.acceptedMaterialCategories || [],
    quantityRangeKg: {
      min: missingNumber(buyer.minQuantityKg) ? null : buyer.minQuantityKg,
      max: missingNumber(buyer.maxQuantityKg) ? null : buyer.maxQuantityKg
    },
    supportedAreas: buyer.supportedAreas || [],
    acceptedConditions: buyer.acceptedConditions || [],
    demandLevel: buyer.demandLevel || 'unknown',
    eligible: eligible,
    isFullyCompatibleRecommendation: eligible,
    totalScore: totalScore,
    breakdown: breakdown,
    failedHardRequirements: failedHardRequirements,
    missingDataFields: collectMissing([material, quantity, location, demand, quality]),
    reasons: buildReasons(eligible, buyer, material, quantity, location, demand, quality),
    limitations: buildLimitations(eligible, material, quantity, location, demand, quality),
    calculationVersion: CALCULATION_VERSION
  };
}

function scoreMaterial(listingMaterial, accepted) {
  if (!accepted || accepted.length === 0) {
    return factor(0, false, true, 'Buyer accepted materials are missing, so material scores 0.');
  }
  if (!listingMaterial) {
    return factor(0, false, true, 'Listing material is missing, so material scores 0.');
  }
  if (accepted.indexOf(listingMaterial) !== -1) {
    return factor(100, true, false, 'Buyer accepts ' + listingMaterial + '.');
  }
  return factor(0, false, false, 'Buyer does not accept ' + listingMaterial + '.');
}

function scoreQuantity(quantity, minKg, maxKg) {
  var minMissing = missingNumber(minKg);
  var maxMissing = missingNumber(maxKg);
  if (minMissing || maxMissing) {
    return factor(0, false, true, 'Buyer quantity limits are incomplete, so quantity scores 0.');
  }
  if (!Number.isFinite(quantity)) {
    return factor(0, false, true, 'Listing quantity is missing, so quantity scores 0.');
  }
  if (quantity < minKg) {
    return factor(
      0,
      false,
      false,
      'Submitted ' + quantity + ' kg is below this buyer’s minimum of ' + minKg + ' kg.'
    );
  }
  if (quantity > maxKg) {
    return factor(
      0,
      false,
      false,
      'Submitted ' + quantity + ' kg is above this buyer’s maximum of ' + maxKg + ' kg.'
    );
  }
  return factor(100, true, false, 'Submitted ' + quantity + ' kg is inside ' + minKg + '–' + maxKg + ' kg.');
}

function scoreLocation(listingArea, supportedAreas) {
  if (!supportedAreas || supportedAreas.length === 0) {
    return factor(
      50,
      true,
      true,
      'Buyer service area is unspecified. Location scores 50, not 100.'
    );
  }
  var listing = normalizePlace(listingArea);
  if (!listing) {
    return factor(50, true, true, 'Listing area is missing. Location scores 50, not 100.');
  }

  var index;
  for (index = 0; index < supportedAreas.length; index += 1) {
    if (listing === normalizePlace(supportedAreas[index])) {
      return factor(100, true, false, 'Listing area matches ' + supportedAreas[index] + '.');
    }
  }
  for (index = 0; index < supportedAreas.length; index += 1) {
    var area = normalizePlace(supportedAreas[index]);
    if (area && (listing.indexOf(area) !== -1 || area.indexOf(listing) !== -1)) {
      return factor(70, true, false, 'Listing area is a partial match for ' + supportedAreas[index] + '.');
    }
  }
  return factor(
    20,
    true,
    false,
    'Listing area is outside the demo service areas (' + supportedAreas.join(', ') + ').'
  );
}

function scoreDemand(demandLevel) {
  if (!demandLevel) {
    return factor(0, true, true, 'Buyer demand is missing, so demand scores 0.');
  }
  if (DEMAND_SCORES[demandLevel] === undefined) {
    return factor(0, true, true, 'Buyer demand "' + demandLevel + '" is not recognised, so demand scores 0.');
  }
  return factor(
    DEMAND_SCORES[demandLevel],
    true,
    false,
    'Buyer demand level is ' + demandLevel + ' (' + DEMAND_SCORES[demandLevel] + '/100).'
  );
}

function scoreQuality(condition, acceptedConditions) {
  if (!acceptedConditions || acceptedConditions.length === 0) {
    return factor(0, true, true, 'Buyer quality rules are missing, so quality scores 0.');
  }
  if (!condition) {
    return factor(50, true, true, 'Listing condition is missing. Quality scores 50, not 100.');
  }
  if (acceptedConditions.indexOf(condition) !== -1) {
    return factor(100, true, false, 'Buyer accepts the stated condition (' + condition + ').');
  }
  if (condition === 'unknown') {
    return factor(
      40,
      true,
      false,
      'Condition is unknown and this buyer does not list unknown as accepted. Quality scores 40.'
    );
  }
  if (condition === 'mixed') {
    return factor(
      15,
      true,
      false,
      'Condition is mixed and this buyer does not accept mixed lots. Quality scores 15.'
    );
  }
  return factor(
    25,
    true,
    false,
    'Condition ' + condition + ' is not in the buyer’s accepted list. Quality scores 25.'
  );
}

function factor(score, passedHardCheck, missingData, note) {
  return {
    score: score,
    passedHardCheck: passedHardCheck,
    missingData: missingData,
    note: note
  };
}

function component(part, weight) {
  return {
    score: part.score,
    weightedScore: roundOne(part.score * weight),
    missingData: part.missingData,
    note: part.note
  };
}

function collectMissing(parts) {
  var fields = [];
  if (parts[0].missingData) {
    fields.push('material');
  }
  if (parts[1].missingData) {
    fields.push('quantity');
  }
  if (parts[2].missingData) {
    fields.push('location');
  }
  if (parts[3].missingData) {
    fields.push('demand');
  }
  if (parts[4].missingData) {
    fields.push('quality');
  }
  return fields;
}

function buildReasons(eligible, buyer, material, quantity, location, demand, quality) {
  var reasons = [buyer.dataLabel || 'Fictitious sample recycler — not a real business'];
  if (eligible) {
    reasons.push(
      'Recommended because material and quantity pass the hard checks. Weighted total uses published weights only.'
    );
  } else {
    reasons.push('Not a full recommendation because a hard check failed.');
  }
  reasons.push(material.note);
  reasons.push(quantity.note);
  reasons.push(location.note);
  reasons.push(demand.note);
  reasons.push(quality.note);
  return reasons;
}

function buildLimitations(eligible, material, quantity, location, demand, quality) {
  var limitations = [];
  if (!eligible) {
    limitations.push('Not presented as a fully compatible match.');
  }
  if (material.score < 100) {
    limitations.push(material.note);
  }
  if (quantity.score < 100) {
    limitations.push(quantity.note);
  }
  if (location.score < 100) {
    limitations.push(location.note);
  }
  if (demand.score < 100) {
    limitations.push(demand.note);
  }
  if (quality.score < 100) {
    limitations.push(quality.note);
  }
  if (material.missingData || quantity.missingData || location.missingData || demand.missingData || quality.missingData) {
    limitations.push('At least one field was unknown, so that factor did not receive a perfect score.');
  }
  return unique(limitations);
}

function unique(items) {
  var seen = {};
  var output = [];
  items.forEach(function (item) {
    if (!seen[item]) {
      seen[item] = true;
      output.push(item);
    }
  });
  return output;
}

function normalizePlace(value) {
  return String(value).trim().toLowerCase();
}

function missingNumber(value) {
  return value === undefined || value === null || value === '' || !Number.isFinite(Number(value));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

module.exports = {
  WEIGHTS: WEIGHTS,
  CALCULATION_VERSION: CALCULATION_VERSION,
  matchListing: matchListing,
  scoreBuyer: scoreBuyer
};
