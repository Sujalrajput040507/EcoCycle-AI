/**
 * EcoCycle AI — Transport Feasibility Service Module
 *
 * Evaluates the logistical and economic feasibility of transporting a PET waste batch
 * from a seller's coordinates to a buyer's processing facility.
 *
 * Principles:
 * - Uses mathematically accurate Haversine distance with honest "STRAIGHT_LINE_ESTIMATE" label.
 * - Compares batch quantity against buyer's minimum collection thresholds.
 * - Computes configurable transport cost model (base pickup fee + per-km rate).
 * - Determines net economic value: gross_material_value - transport_cost.
 * - Explicitly classifies outcome as FEASIBLE, FEASIBLE_WITH_WARNING, NOT_FEASIBLE, or INSUFFICIENT_DATA.
 * - Never claims a real carrier quotation or confirmed collection booking.
 */

const fs = require('fs');
const path = require('path');

// Default facility coordinates and service radius for demo buyers
const BUYER_FACILITIES = {
  buyer_pet_01: {
    name: 'EcoPellet Processors (Demo)',
    lat: 28.6692,
    lng: 77.2167,
    address: 'North Sector Industrial Park, Delhi',
    max_radius_km: 45,
    min_pickup_kg: 10,
    max_kg: 500,
    supported_zones: ['North Sector', 'Central City']
  },
  buyer_pet_02: {
    name: 'GreenBottle Recyclers (Demo)',
    lat: 28.5355,
    lng: 77.2410,
    address: 'South Hub Eco Center, New Delhi',
    max_radius_km: 30,
    min_pickup_kg: 5,
    max_kg: 100,
    supported_zones: ['South Hub', 'Central City', 'Industrial East']
  },
  buyer_pet_03: {
    name: 'PET Granules Ltd (Demo)',
    lat: 28.6280,
    lng: 77.3000,
    address: 'Industrial East Flake Yard, Noida',
    max_radius_km: 60,
    min_pickup_kg: 50,
    max_kg: 2000,
    supported_zones: ['Industrial East']
  },
  buyer_pet_04: {
    name: 'ClearCycle Solutions (Demo)',
    lat: 28.6139,
    lng: 77.2090,
    address: 'Central City Processing Hub, Delhi',
    max_radius_km: 50,
    min_pickup_kg: 2,
    max_kg: 50,
    supported_zones: ['North Sector', 'South Hub', 'Central City', 'Industrial East']
  }
};

const TRANSPORT_DISCLAIMER =
  'Transport costs and feasibility are straight-line estimates based on available information. Actual charges and collection availability must be confirmed with the recycler or transport provider.';

/**
 * Calculates Haversine distance in kilometers between two GPS coordinates.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
    typeof lat2 !== 'number' || typeof lon2 !== 'number' ||
    Number.isNaN(lat1) || Number.isNaN(lon1) ||
    Number.isNaN(lat2) || Number.isNaN(lon2)
  ) {
    return null;
  }

  // Bounds check: latitude [-90, 90], longitude [-180, 180]
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
      lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
    return null;
  }

  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  // Decimal-safe rounding to 2 decimal places
  return Math.round(distance * 100) / 100;
}

/**
 * Loads buyer facility metadata, merging buyers.json with configured coordinates.
 */
function getBuyerFacility(buyerId, customBuyers = null) {
  if (customBuyers && customBuyers[buyerId]) {
    return customBuyers[buyerId];
  }

  if (BUYER_FACILITIES[buyerId]) {
    return BUYER_FACILITIES[buyerId];
  }

  // Try loading from buyers.json if available
  try {
    const buyersPath = path.join(__dirname, 'data', 'buyers.json');
    if (fs.existsSync(buyersPath)) {
      const data = JSON.parse(fs.readFileSync(buyersPath, 'utf8'));
      const found = data.find(b => b.id === buyerId);
      if (found) {
        return {
          name: found.name,
          lat: 28.6139,
          lng: 77.2090,
          address: `${found.supported_zones ? found.supported_zones.join(', ') : 'Central'} Processing Facility`,
          max_radius_km: 45,
          min_pickup_kg: found.min_kg || 5,
          max_kg: found.max_kg || 1000,
          supported_zones: found.supported_zones || []
        };
      }
    }
  } catch {
    // Fall back to null
  }

  return null;
}

/**
 * Evaluates transport feasibility between a seller location and buyer facility.
 *
 * @param {object} params
 * @param {number} [params.seller_lat]
 * @param {number} [params.seller_lng]
 * @param {string} params.buyer_id
 * @param {number} params.quantity_kg
 * @param {number} [params.price_per_kg] - Agreed or benchmark unit price
 * @param {string} [params.transport_mode] - 'RECYCLER_PICKUP' | 'SELLER_DROP'
 * @param {object} [params.customBuyers]
 * @returns {object} Transport feasibility report
 */
function evaluateTransportFeasibility({
  seller_lat,
  seller_lng,
  pickup_lat,
  pickup_lng,
  distance_km = null,
  is_road_distance = false,
  buyer_id,
  quantity_kg,
  price_per_kg = 15.0,
  unit_price = null,
  cost_per_km = null,
  base_pickup_fee = null,
  max_pickup_km = null,
  min_pickup_kg = null,
  transport_mode = 'RECYCLER_PICKUP',
  customBuyers = null
}) {
  const timestamp = new Date().toISOString();
  const warnings = [];
  const reasons = [];

  const qty = Number(quantity_kg);
  const price = Number(unit_price !== null ? unit_price : price_per_kg);
  const isPickup = transport_mode !== 'SELLER_DROP';

  const buyer = buyer_id ? getBuyerFacility(buyer_id, customBuyers) : {
    name: 'Regional Recycler',
    lat: 28.6139,
    lng: 77.2090,
    address: 'Central Processing Hub',
    max_radius_km: max_pickup_km || 45,
    min_pickup_kg: min_pickup_kg || 5,
    max_kg: 5000,
    supported_zones: ['Central City']
  };

  // 1. Check for insufficient data
  if (buyer_id && !buyer) {
    return {
      status: 'INSUFFICIENT_DATA',
      explanation: `Buyer "${buyer_id}" not found in available recycler profiles.`,
      distance_km: null,
      distance_method: 'UNKNOWN',
      distance_type: 'UNKNOWN',
      estimated_transport_cost: null,
      gross_material_value: null,
      estimated_net_value: null,
      checks: {
        location_valid: false,
        quantity_valid: false,
        economic_valid: false
      },
      warnings: ['Recycler location and operating constraints are unknown.'],
      reasons: ['Missing buyer facility information.'],
      disclaimer: TRANSPORT_DISCLAIMER,
      timestamp
    };
  }

  const sLat = typeof pickup_lat === 'number' ? pickup_lat : (typeof seller_lat === 'number' ? seller_lat : parseFloat(seller_lat));
  const sLng = typeof pickup_lng === 'number' ? pickup_lng : (typeof seller_lng === 'number' ? seller_lng : parseFloat(seller_lng));

  let distanceKm = null;
  let distanceMethod = 'STRAIGHT_LINE_ESTIMATE';

  if (typeof distance_km === 'number' && distance_km >= 0) {
    distanceKm = Math.round(distance_km * 100) / 100;
    distanceMethod = is_road_distance ? 'ROAD_DISTANCE' : 'STRAIGHT_LINE_ESTIMATE';
  } else if (!Number.isNaN(sLat) && !Number.isNaN(sLng) && sLat !== null && sLng !== null && buyer) {
    distanceKm = calculateHaversineDistance(sLat, sLng, buyer.lat, buyer.lng);
  }

  if (distanceKm === null) {
    return {
      status: 'INSUFFICIENT_DATA',
      buyer_id: buyer_id || null,
      buyer_name: buyer ? buyer.name : null,
      explanation: 'Seller GPS coordinates were not provided or are invalid.',
      distance_km: null,
      distance_method: 'UNKNOWN',
      distance_type: 'UNKNOWN',
      estimated_transport_cost: null,
      gross_material_value: !Number.isNaN(qty) && qty > 0 ? Math.round(qty * price * 100) / 100 : null,
      estimated_net_value: null,
      checks: {
        location_valid: false,
        quantity_valid: !Number.isNaN(qty) && qty >= (buyer ? buyer.min_pickup_kg : 5),
        economic_valid: false
      },
      warnings: ['Coordinates missing: distance and route cannot be evaluated.'],
      reasons: ['Pin your location on the map or enter coordinates to check transport feasibility.'],
      disclaimer: TRANSPORT_DISCLAIMER,
      timestamp
    };
  }

  if (distanceMethod === 'STRAIGHT_LINE_ESTIMATE') {
    warnings.push('Distance is a straight-line estimate. Real road travel distance may vary by 15–30%.');
  }

  // 3. Transport Cost Model
  const baseFee = base_pickup_fee !== null
    ? Number(base_pickup_fee)
    : (isPickup ? (Number(process.env.TRANSPORT_BASE_FEE) || 120.0) : 0.0);

  const perKmRate = cost_per_km !== null
    ? Number(cost_per_km)
    : (isPickup ? (Number(process.env.TRANSPORT_PER_KM_FEE) || 8.5) : 4.5);

  const rawTransportCost = baseFee + (distanceKm * perKmRate);
  const estimatedTransportCost = Math.round(rawTransportCost * 100) / 100;

  // 4. Economic Feasibility
  const grossMaterialValue = Math.round((qty * price) * 100) / 100;
  const estimatedNetValue = Math.round((grossMaterialValue - estimatedTransportCost) * 100) / 100;

  // 5. Check constraints
  const minRequiredQty = min_pickup_kg !== null ? min_pickup_kg : (buyer ? buyer.min_pickup_kg : 5);
  const maxAllowedRadius = max_pickup_km !== null ? max_pickup_km : (buyer ? buyer.max_radius_km : 45);

  const quantityValid = qty >= minRequiredQty && (!buyer || !buyer.max_kg || qty <= buyer.max_kg);
  const serviceAreaValid = distanceKm <= maxAllowedRadius;
  const economicValid = estimatedNetValue > 0;

  // Detail reasons
  if (!quantityValid) {
    if (qty < minRequiredQty) {
      reasons.push(`Batch quantity (${qty} kg) is below buyer's minimum pickup volume (${minRequiredQty} kg).`);
    } else if (buyer && buyer.max_kg && qty > buyer.max_kg) {
      reasons.push(`Batch quantity (${qty} kg) exceeds buyer's maximum single batch capacity (${buyer.max_kg} kg).`);
    }
  } else {
    reasons.push(`Batch volume (${qty} kg) meets operating thresholds (${minRequiredQty}–${buyer && buyer.max_kg ? buyer.max_kg : '10,000'} kg).`);
  }

  if (!serviceAreaValid) {
    reasons.push(`Estimated distance (${distanceKm.toFixed(1)} km) exceeds service radius (${maxAllowedRadius} km).`);
  } else {
    reasons.push(`Distance (${distanceKm.toFixed(1)} km) is within operational service area (${maxAllowedRadius} km).`);
  }

  if (!economicValid) {
    reasons.push(`Transport cost (₹${estimatedTransportCost.toFixed(2)}) exceeds gross material value (₹${grossMaterialValue.toFixed(2)}), resulting in net negative value (₹${estimatedNetValue.toFixed(2)}).`);
  } else {
    reasons.push(`Estimated net material yield is positive: ₹${estimatedNetValue.toFixed(2)} after logistics.`);
  }

  // 6. Overall Status Determination
  let status;
  if (!quantityValid || !serviceAreaValid || !economicValid) {
    status = 'NOT_FEASIBLE';
  } else if (
    distanceKm > maxAllowedRadius * 0.85 ||
    estimatedNetValue < grossMaterialValue * 0.25 ||
    distanceMethod === 'STRAIGHT_LINE_ESTIMATE'
  ) {
    if (distanceKm > maxAllowedRadius * 0.85) {
      warnings.push(`Distance (${distanceKm.toFixed(1)} km) is near the edge of service boundary (${maxAllowedRadius} km).`);
    }
    if (estimatedNetValue < grossMaterialValue * 0.25) {
      warnings.push(`Low net margin: transport consumes ${Math.round((estimatedTransportCost / grossMaterialValue) * 100)}% of gross material value. Consider aggregating more volume.`);
    }
    status = 'FEASIBLE_WITH_WARNING';
  } else {
    status = 'FEASIBLE';
  }

  return {
    status,
    buyer_id: buyer_id || null,
    buyer_name: buyer ? buyer.name : null,
    buyer_facility_address: buyer ? buyer.address : null,
    seller_coordinates: { lat: sLat, lng: sLng },
    buyer_coordinates: buyer ? { lat: buyer.lat, lng: buyer.lng } : null,
    distance_km: distanceKm,
    distance_method: distanceMethod,
    distance_type: distanceMethod,
    transport_mode,
    transport_cost_model: {
      base_fee: baseFee,
      per_km_rate: perKmRate
    },
    estimated_transport_cost: estimatedTransportCost,
    gross_material_value: grossMaterialValue,
    estimated_net_value: estimatedNetValue,
    checks: {
      quantity_valid: quantityValid,
      service_area_valid: serviceAreaValid,
      economic_valid: economicValid
    },
    warnings,
    reasons,
    disclaimer: TRANSPORT_DISCLAIMER,
    timestamp
  };
}

module.exports = {
  calculateHaversineDistance,
  evaluateTransportFeasibility,
  getBuyerFacility,
  BUYER_FACILITIES,
  TRANSPORT_DISCLAIMER
};
