/**
 * EcoCycle AI — Deterministic Buyer Matching Engine
 *
 * Matches confirmed waste listings against demo buyer profiles using:
 *   1. Hard eligibility filters (material, quantity range, zone, condition)
 *   2. Weighted scoring for ranking eligible buyers (0–100 heuristic score)
 *
 * All scoring logic is transparent, rule-based, and deterministic.
 * Scores are heuristic ranking scores — not probabilities of successful recycling.
 * No real prices, distances, transport costs, or environmental impact are inferred.
 */

// =============================================
// CONFIGURABLE SCORING WEIGHTS (must sum to 1.0)
// =============================================
const WEIGHTS = {
  material:  0.35,  // Material compatibility
  quantity:  0.20,  // Quantity fit within buyer's range
  location:  0.20,  // Location / zone coverage breadth
  demand:    0.15,  // Buyer's current demand level
  condition: 0.10   // Condition / quality fit
};

// =============================================
// DEMAND LEVEL → NUMERIC SCORE MAPPING
// =============================================
const DEMAND_SCORES = {
  'High':   1.0,
  'Medium': 0.6,
  'Low':    0.25
};

// =============================================
// CONDITION PREFERENCE RANKING
// Buyers who accept fewer conditions are pickier (higher quality preference).
// When a buyer accepts the user's condition AND has fewer total accepted
// conditions, the condition-fit score is higher — they're a better quality match.
// =============================================
const CONDITION_RANK = {
  'Clean':              3,  // Best condition
  'Mixed/Labels on':    2,
  'Contaminated/Dirty': 1   // Worst condition
};

/**
 * Normalize a string for comparison: trim and collapse whitespace.
 * Does NOT lowercase — we match exact allowed values after trimming.
 */
function normalize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
}

/**
 * Check if a value exists in an array, with normalized comparison.
 */
function includesNormalized(arr, value) {
  if (!Array.isArray(arr)) return false;
  const norm = normalize(value);
  return arr.some(item => normalize(item) === norm);
}

// =============================================
// HARD ELIGIBILITY FILTERS
// =============================================

/**
 * Determine whether a buyer is eligible for a listing.
 * Returns { eligible: true } or { eligible: false, reasons: [...] }.
 */
function checkEligibility(buyer, listing) {
  const reasons = [];

  // 1. Material check
  if (!includesNormalized(buyer.accepted_materials, listing.confirmed_material)) {
    reasons.push(`Does not accept ${listing.confirmed_material}`);
  }

  // 2. Quantity range check
  const qty = listing.quantity_kg;
  if (typeof buyer.min_kg === 'number' && qty < buyer.min_kg) {
    reasons.push(`Quantity ${qty} kg is below minimum ${buyer.min_kg} kg`);
  }
  if (typeof buyer.max_kg === 'number' && qty > buyer.max_kg) {
    reasons.push(`Quantity ${qty} kg exceeds maximum ${buyer.max_kg} kg`);
  }

  // 3. Zone / locality check
  if (!includesNormalized(buyer.supported_zones, listing.locality)) {
    reasons.push(`Does not serve ${listing.locality}`);
  }

  // 4. Condition check
  if (!includesNormalized(buyer.accepted_conditions, listing.condition)) {
    reasons.push(`Does not accept condition: ${listing.condition}`);
  }

  if (reasons.length > 0) {
    return { eligible: false, reasons };
  }
  return { eligible: true };
}

// =============================================
// SCORING COMPONENTS (each returns 0.0 – 1.0)
// =============================================

/**
 * Material compatibility score.
 * Since material is a hard filter, all eligible buyers score 1.0.
 * If the buyer's accepted_materials list contains ONLY the user's material
 * (specialist), they score 1.0. If they accept many materials, they still
 * score 1.0 since all demo buyers accept PET Plastic only in the current data.
 */
function scoreMaterial(buyer, listing) {
  // Eligible buyers always accept the material. Award full score.
  // A specialist (fewer materials accepted) gets a tiny bonus for tie-breaking.
  const totalMaterials = Array.isArray(buyer.accepted_materials)
    ? buyer.accepted_materials.length : 1;
  return totalMaterials === 1 ? 1.0 : 0.9;
}

/**
 * Quantity fit score.
 * Measures how well the user's quantity fits within the buyer's operating range.
 * Best score when quantity is at the midpoint of [min_kg, max_kg].
 * Score tapers toward the edges of the range.
 */
function scoreQuantity(buyer, listing) {
  const qty = listing.quantity_kg;
  const min = buyer.min_kg || 0;
  const max = buyer.max_kg || 10000;
  const range = max - min;

  if (range <= 0) return 0.5; // Degenerate range

  // Position within range: 0.0 at edges, 1.0 at midpoint
  const midpoint = (min + max) / 2;
  const distFromMid = Math.abs(qty - midpoint);
  const halfRange = range / 2;

  // Linear taper: 1.0 at midpoint → 0.3 at the edges
  const fit = 1.0 - (distFromMid / halfRange) * 0.7;
  return Math.max(0.1, Math.min(1.0, fit));
}

/**
 * Location fit score.
 * Buyers who cover more zones get a slightly lower score (less specialized).
 * A buyer covering fewer zones but still matching is a tighter geographic fit.
 */
function scoreLocation(buyer, listing) {
  const totalZones = Array.isArray(buyer.supported_zones)
    ? buyer.supported_zones.length : 1;

  // 4 total demo zones. Fewer zones = more focused coverage = higher score.
  // 1 zone → 1.0, 2 → 0.85, 3 → 0.70, 4 → 0.55
  const score = 1.0 - (totalZones - 1) * 0.15;
  return Math.max(0.3, Math.min(1.0, score));
}

/**
 * Demand level score.
 * Maps the buyer's configured demand_level to a numeric value.
 */
function scoreDemand(buyer) {
  const level = normalize(buyer.demand_level);
  return DEMAND_SCORES[level] !== undefined ? DEMAND_SCORES[level] : 0.5;
}

/**
 * Condition / quality fit score.
 * Buyers who accept fewer conditions are pickier — matching them means
 * your waste meets a higher quality bar, which is a better fit.
 * Also gives a bonus when the user's condition is the best the buyer accepts.
 */
function scoreCondition(buyer, listing) {
  const totalConditions = Array.isArray(buyer.accepted_conditions)
    ? buyer.accepted_conditions.length : 1;
  const userRank = CONDITION_RANK[normalize(listing.condition)] || 1;

  // Fewer accepted conditions = pickier buyer = better quality match
  // 1 condition → 1.0, 2 → 0.75, 3 → 0.5
  const selectivityScore = 1.0 - (totalConditions - 1) * 0.25;

  // User's condition rank relative to 3 (max)
  const qualityScore = userRank / 3;

  // Blend: 60% selectivity, 40% user quality
  return Math.max(0.1, selectivityScore * 0.6 + qualityScore * 0.4);
}

// =============================================
// COMPOSITE SCORING
// =============================================

/**
 * Calculate the weighted composite score for an eligible buyer.
 * Returns a score between 0 and 100 (rounded to 1 decimal).
 */
function calculateScore(buyer, listing) {
  const components = {
    material:  scoreMaterial(buyer, listing),
    quantity:  scoreQuantity(buyer, listing),
    location:  scoreLocation(buyer, listing),
    demand:    scoreDemand(buyer),
    condition: scoreCondition(buyer, listing)
  };

  const raw =
    components.material  * WEIGHTS.material +
    components.quantity   * WEIGHTS.quantity +
    components.location   * WEIGHTS.location +
    components.demand     * WEIGHTS.demand +
    components.condition  * WEIGHTS.condition;

  // Scale to 0–100 and round to 1 decimal
  const score = Math.round(raw * 1000) / 10;
  return { score: Math.min(100, Math.max(0, score)), components };
}

// =============================================
// MATCH REASON GENERATION
// =============================================

/**
 * Generate human-readable match reasons for an eligible buyer.
 */
function generateMatchReasons(buyer, listing, components) {
  const reasons = [];

  // Material
  reasons.push(`Accepts ${listing.confirmed_material}`);

  // Quantity
  reasons.push(
    `Accepts ${buyer.min_kg}–${buyer.max_kg} kg (your listing: ${listing.quantity_kg} kg)`
  );

  // Location
  reasons.push(`Serves ${listing.locality}`);

  // Demand
  reasons.push(`Current demand: ${buyer.demand_level || 'Unknown'}`);

  // Condition
  const condList = (buyer.accepted_conditions || []).join(', ');
  reasons.push(`Accepted conditions: ${condList}`);

  return reasons;
}

/**
 * Generate structured, explainable reasons for each factor (Feature 2).
 * Returns array of { factor, status: 'MATCH'|'PARTIAL'|'MISMATCH', score, weight, message }.
 */
function generateStructuredReasons(buyer, listing, components = null, isEligible = true, exclusionReasons = []) {
  if (isEligible && components) {
    const reasons = [
      {
        factor: 'MATERIAL',
        status: 'MATCH',
        score: Math.round(components.material * 100),
        weight: WEIGHTS.material,
        message: `This buyer accepts ${listing.confirmed_material} (${components.material === 1.0 ? 'dedicated PET specialist' : 'multi-resin processor'}).`
      },
      {
        factor: 'QUANTITY',
        status: components.quantity >= 0.75 ? 'MATCH' : 'PARTIAL',
        score: Math.round(components.quantity * 100),
        weight: WEIGHTS.quantity,
        message: `The listing quantity (${listing.quantity_kg} kg) falls comfortably within buyer intake range (${buyer.min_kg}–${buyer.max_kg} kg).`
      },
      {
        factor: 'LOCATION',
        status: components.location >= 0.85 ? 'MATCH' : 'PARTIAL',
        score: Math.round(components.location * 100),
        weight: WEIGHTS.location,
        message: `The buyer directly serves ${listing.locality} with ${Array.isArray(buyer.supported_zones) ? buyer.supported_zones.length : 1} regional operational zones.`
      },
      {
        factor: 'DEMAND',
        status: components.demand >= 0.6 ? 'MATCH' : 'PARTIAL',
        score: Math.round(components.demand * 100),
        weight: WEIGHTS.demand,
        message: `The buyer reports an active material intake demand level of ${buyer.demand_level || 'Medium'}.`
      },
      {
        factor: 'CONDITION',
        status: components.condition >= 0.6 ? 'MATCH' : 'PARTIAL',
        score: Math.round(components.condition * 100),
        weight: WEIGHTS.condition,
        message: `The buyer accepts the submitted "${listing.condition}" material condition.`
      }
    ];
    return reasons;
  }

  // Ineligible buyer reasons
  const reasons = [];

  // Material check
  const acceptsMat = includesNormalized(buyer.accepted_materials, listing.confirmed_material);
  reasons.push({
    factor: 'MATERIAL',
    status: acceptsMat ? 'MATCH' : 'MISMATCH',
    weight: WEIGHTS.material,
    message: acceptsMat
      ? `Accepts ${listing.confirmed_material}.`
      : `Incompatible material: buyer does not accept ${listing.confirmed_material}.`
  });

  // Quantity check
  const qty = listing.quantity_kg;
  const qtyValid = (typeof buyer.min_kg !== 'number' || qty >= buyer.min_kg) &&
                   (typeof buyer.max_kg !== 'number' || qty <= buyer.max_kg);
  reasons.push({
    factor: 'QUANTITY',
    status: qtyValid ? 'MATCH' : 'MISMATCH',
    weight: WEIGHTS.quantity,
    message: qtyValid
      ? `Quantity ${qty} kg is within accepted range (${buyer.min_kg}–${buyer.max_kg} kg).`
      : `Quantity ${qty} kg is outside buyer's operating range (${buyer.min_kg}–${buyer.max_kg} kg).`
  });

  // Location check
  const locValid = includesNormalized(buyer.supported_zones, listing.locality);
  reasons.push({
    factor: 'LOCATION',
    status: locValid ? 'MATCH' : 'MISMATCH',
    weight: WEIGHTS.location,
    message: locValid
      ? `Serves locality ${listing.locality}.`
      : `Buyer does not operate in ${listing.locality}.`
  });

  // Demand check
  reasons.push({
    factor: 'DEMAND',
    status: buyer.demand_level ? 'MATCH' : 'PARTIAL',
    weight: WEIGHTS.demand,
    message: `Buyer demand level is ${buyer.demand_level || 'Unknown'}.`
  });

  // Condition check
  const condValid = includesNormalized(buyer.accepted_conditions, listing.condition);
  reasons.push({
    factor: 'CONDITION',
    status: condValid ? 'MATCH' : 'MISMATCH',
    weight: WEIGHTS.condition,
    message: condValid
      ? `Accepts condition "${listing.condition}".`
      : `Buyer does not accept condition "${listing.condition}".`
  });

  return reasons;
}

// =============================================
// MAIN MATCHING FUNCTION
// =============================================

/**
 * Match a confirmed listing against all buyer profiles.
 *
 * @param {object} listing - { confirmed_material, quantity_kg, locality, condition }
 * @param {Array}  buyers  - Array of buyer profile objects from buyers.json
 * @returns {object} { eligible: [...], ineligible: [...], message: string }
 */
function matchBuyers(listing, buyers) {
  if (!Array.isArray(buyers) || buyers.length === 0) {
    return {
      eligible: [],
      ineligible: [],
      message: 'No buyer profiles are loaded. Please check the data configuration.'
    };
  }

  const eligible = [];
  const ineligible = [];

  for (const buyer of buyers) {
    const eligibility = checkEligibility(buyer, listing);

    if (eligibility.eligible) {
      const { score, components } = calculateScore(buyer, listing);
      const stringReasons = generateMatchReasons(buyer, listing, components);
      const structuredReasons = generateStructuredReasons(buyer, listing, components, true);

      eligible.push({
        buyer_id: buyer.id,
        buyerId: buyer.id,
        buyer_name: buyer.name,
        buyerName: buyer.name,
        score,
        matchScore: score,
        eligibility: 'ELIGIBLE',
        reasons: structuredReasons,
        match_reasons: stringReasons,
        demand_level: buyer.demand_level || 'Unknown',
        notes: buyer.notes || '',
        score_breakdown: {
          material:  Math.round(components.material * 100) / 100,
          quantity:  Math.round(components.quantity * 100) / 100,
          location:  Math.round(components.location * 100) / 100,
          demand:    Math.round(components.demand * 100) / 100,
          condition: Math.round(components.condition * 100) / 100
        }
      });
    } else {
      const structuredReasons = generateStructuredReasons(buyer, listing, null, false, eligibility.reasons);
      ineligible.push({
        buyer_id: buyer.id,
        buyerId: buyer.id,
        buyer_name: buyer.name,
        buyerName: buyer.name,
        eligibility: 'INELIGIBLE',
        reasons: structuredReasons,
        exclusion_reasons: eligibility.reasons
      });
    }
  }

  // Sort by descending score, then by buyer_id for stable tie-breaking
  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.buyer_id.localeCompare(b.buyer_id);
  });

  // Build summary message
  let message;
  if (eligible.length === 0) {
    message = `No compatible recycling partners found for ${listing.quantity_kg} kg of ${listing.confirmed_material} (${listing.condition}) in ${listing.locality}. Try adjusting your quantity or zone.`;
  } else if (eligible.length === 1) {
    message = `Found 1 compatible recycling partner for your listing.`;
  } else {
    message = `Found ${eligible.length} compatible recycling partners, ranked by compatibility score.`;
  }

  return { eligible, ineligible, message };
}

// =============================================
// EXPORTS
// =============================================
module.exports = {
  matchBuyers,
  checkEligibility,
  calculateScore,
  scoreMaterial,
  scoreQuantity,
  scoreLocation,
  scoreDemand,
  scoreCondition,
  generateMatchReasons,
  generateStructuredReasons,
  normalize,
  includesNormalized,
  WEIGHTS,
  FACTOR_WEIGHTS: {
    MATERIAL: 35,
    QUANTITY: 20,
    LOCATION: 20,
    DEMAND: 15,
    CONDITION: 10
  },
  DEMAND_SCORES
};

