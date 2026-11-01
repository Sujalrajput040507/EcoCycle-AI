/**
 * EcoCycle AI — Frontend Application Logic
 * 
 * Phase 4: Image upload → AI analysis → review/confirm → create listing → match buyers.
 * Handles loading states, error display, and duplicate submission prevention.
 * The user always confirms or corrects the AI estimate before creating a listing.
 */

// =============================================
// CONSTANTS
// =============================================
const API_BASE = ''; // Same origin
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// =============================================
// HELPER: SAFE HTML ESCAPING
// =============================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =============================================
// STATE
// =============================================
let isSubmitting = false;     // Prevents duplicate analyze calls
let isConfirming = false;     // Prevents duplicate listing calls
let isMatching = false;       // Prevents duplicate match calls
let currentAnalysis = null;   // Stores the last analysis response
let currentListing = null;    // Stores the created listing for matching
let confirmedLocation = null; // Confirmed Google Maps location object
let candidateLocation = null; // Staged location from search, click, or drag

// Google Maps state
let googleMap = null;
let googleMarker = null;
let googleGeocoder = null;
let googleAutocomplete = null;
let isMapScriptLoaded = false;
let isMapsConfigured = false;
const DEFAULT_MAP_CENTER = { lat: 30.7046, lng: 76.7179 }; // Mohali / Chandigarh region (default demo center)

// =============================================
// DOM REFERENCES
// =============================================
const uploadArea       = document.getElementById('upload-area');
const uploadPreview    = document.getElementById('upload-preview');
const fileInput        = document.getElementById('waste-image');
const wasteForm        = document.getElementById('waste-form');
const submitBtn        = document.getElementById('submit-btn');
const submitText       = document.getElementById('submit-text');

// Review panel
const reviewPanel      = document.getElementById('review-panel');
const reviewBadge      = document.getElementById('review-badge');
const reviewNote       = document.getElementById('review-note');
const reviewMaterial   = document.getElementById('review-material');
const reviewCondition  = document.getElementById('review-condition');
const reviewConfidence = document.getElementById('review-confidence');
const reviewQuantity   = document.getElementById('review-quantity');
const reviewLocality   = document.getElementById('review-locality');
const reviewAddressRow = document.getElementById('review-address-row');
const reviewAddress    = document.getElementById('review-address');
const confirmMaterial  = document.getElementById('confirm-material');
const confirmCondition = document.getElementById('confirm-condition');
const confirmBtn       = document.getElementById('confirm-btn');
const confirmText      = document.getElementById('confirm-text');
const resetFormBtn     = document.getElementById('reset-form-btn');

// Location Picker DOM
const placeSearchInput       = document.getElementById('place-search');
const btnLocateMe            = document.getElementById('btn-locate-me');
const btnConfirmLocation     = document.getElementById('btn-confirm-location');
const btnConfirmLocText      = document.getElementById('btn-confirm-location-text');
const btnRetryMap            = document.getElementById('btn-retry-map');
const mapContainerWrapper    = document.getElementById('map-container-wrapper');
const mapLoadingOverlay      = document.getElementById('map-loading-overlay');
const mapLoadingText         = document.getElementById('map-loading-text');
const mapStatusBadge         = document.getElementById('map-status-badge');
const mapFallbackBanner      = document.getElementById('map-fallback-banner');
const mapFallbackMsg         = document.getElementById('map-fallback-msg');
const locationErrorMsg       = document.getElementById('location-error-msg');
const selectedLocationCard   = document.getElementById('selected-location-card');
const locCoordsDisplay       = document.getElementById('loc-coords-display');
const locAddressDisplay      = document.getElementById('loc-address-display');
const locLatInput            = document.getElementById('loc-lat');
const locLngInput            = document.getElementById('loc-lng');
const locAddressInput        = document.getElementById('loc-address');
const locPlaceIdInput        = document.getElementById('loc-place-id');
const zoneSelect             = document.getElementById('locality');
const zoneHint               = document.getElementById('zone-hint');

// Success panel
const successPanel     = document.getElementById('success-panel');
const successDetails   = document.getElementById('success-details');
const newListingBtn    = document.getElementById('new-listing-btn');
const findBuyersBtn    = document.getElementById('find-buyers-btn');
const findBuyersText   = document.getElementById('find-buyers-text');

// Match panel
const matchPanel       = document.getElementById('match-panel');
const matchMessage     = document.getElementById('match-message');
const buyerCardsEl     = document.getElementById('buyer-cards');
const noMatchEl        = document.getElementById('no-match');
const matchNewBtn      = document.getElementById('match-new-listing-btn');

// Phase 7: Payment & Recovery Tracker DOM
const paymentPanel         = document.getElementById('payment-panel');
const paymentFallbackBanner= document.getElementById('payment-fallback-banner');
const paymentPrereqCard    = document.getElementById('payment-prereq-card');
const paymentCard          = document.getElementById('payment-card');
const payListingId         = document.getElementById('pay-listing-id');
const payMaterial          = document.getElementById('pay-material');
const payQuantity          = document.getElementById('pay-quantity');
const payBuyer             = document.getElementById('pay-buyer');
const btnPayRazorpay       = document.getElementById('btn-pay-razorpay');
const btnPayText           = document.getElementById('btn-pay-text');
const paySpinner           = document.getElementById('pay-spinner');
const paymentError         = document.getElementById('payment-error');
const paymentSuccessCard   = document.getElementById('payment-success-card');
const successPaymentId     = document.getElementById('success-payment-id');
const successOrderId       = document.getElementById('success-order-id');
const successTimestamp     = document.getElementById('success-timestamp');
const btnGotoPayment       = document.getElementById('btn-goto-payment');
const navPayLink           = document.getElementById('nav-pay-link');
const mobileNavPay         = document.getElementById('mobile-nav-pay');
const btnPrereqStart       = document.getElementById('btn-prereq-start');
const razorpayModeBadge    = document.getElementById('razorpay-mode-badge');
const btnRecheckRazorpay   = document.getElementById('btn-recheck-razorpay');
const paymentBannerTitle   = document.getElementById('payment-banner-title');

const recoveryTrackerPanel = document.getElementById('recovery-tracker-panel');
const stepListed           = document.getElementById('step-listed');
const stepMatched          = document.getElementById('step-matched');
const stepCollection       = document.getElementById('step-collection');
const stepRecovery         = document.getElementById('step-recovery');
const conn1                = document.getElementById('conn-1');
const conn2                = document.getElementById('conn-2');
const conn3                = document.getElementById('conn-3');
const btnAdvanceCollection = document.getElementById('btn-advance-collection');
const btnAdvanceRecovery   = document.getElementById('btn-advance-recovery');
const auditList            = document.getElementById('audit-list');

// Phase 7 State
let selectedBuyer          = null;
let razorpayConfig         = null;
let isPaying               = false;

// Phase 9: PET Price Intelligence DOM
const btnEstimatePrice       = document.getElementById('btn-estimate-price');
const btnEstimatePriceText   = document.getElementById('btn-estimate-price-text');
const priceSpinner           = document.getElementById('price-spinner');
const pricePanel             = document.getElementById('price-panel');
const priceTransparencyBadge = document.getElementById('price-transparency-badge');
const priceCard              = document.getElementById('price-card');
const pricePerKgVal          = document.getElementById('price-per-kg-val');
const priceTotalVal          = document.getElementById('price-total-val');
const priceQtySub            = document.getElementById('price-qty-sub');
const priceCalcExplanation   = document.getElementById('price-calc-explanation');
const priceGradeData         = document.getElementById('price-grade-data');
const priceCoverageData      = document.getElementById('price-coverage-data');
const priceFreshnessData     = document.getElementById('price-freshness-data');
const priceSourceData        = document.getElementById('price-source-data');
const priceWarningsList      = document.getElementById('price-warnings-list');
const priceUnavailableCard   = document.getElementById('price-unavailable-card');
const priceUnavailableMsg    = document.getElementById('price-unavailable-msg');

let isEstimatingPrice        = false;
let currentPriceEstimate     = null;

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = 'info', duration = 3500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// =============================================
// BUTTON LOADING STATE
// =============================================
function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// =============================================
// IMAGE UPLOAD HANDLING
// =============================================

function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('Please upload a JPG, PNG, or WebP image.', 'error');
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast('Image must be under 5 MB.', 'error');
    return false;
  }
  return true;
}

function previewImage(file) {
  if (!validateFile(file)) {
    fileInput.value = '';
    uploadArea.classList.remove('has-image');
    uploadPreview.src = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadPreview.src = e.target.result;
    uploadArea.classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

// Click to open file picker
uploadArea.addEventListener('click', () => fileInput.click());

// File selected via picker
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) previewImage(file);
});

// Drag and drop support
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    previewImage(file);
  }
});

// =============================================
// PANEL VISIBILITY HELPERS
// =============================================
function showForm() {
  wasteForm.classList.remove('hidden');
  reviewPanel.classList.add('hidden');
  successPanel.classList.add('hidden');
  matchPanel.classList.add('hidden');
  if (paymentPanel) paymentPanel.classList.add('hidden');
  if (recoveryTrackerPanel) recoveryTrackerPanel.classList.add('hidden');
  if (pricePanel) pricePanel.classList.add('hidden');
}

function showReview() {
  wasteForm.classList.add('hidden');
  reviewPanel.classList.remove('hidden');
  successPanel.classList.add('hidden');
  matchPanel.classList.add('hidden');
  if (paymentPanel) paymentPanel.classList.add('hidden');
  if (recoveryTrackerPanel) recoveryTrackerPanel.classList.add('hidden');
  if (pricePanel) pricePanel.classList.add('hidden');

  if (currentAnalysis && currentAnalysis.user_location && currentAnalysis.user_location.formatted_address) {
    if (reviewAddress) reviewAddress.textContent = currentAnalysis.user_location.formatted_address;
    if (reviewAddressRow) reviewAddressRow.classList.remove('hidden');
  } else {
    if (reviewAddressRow) reviewAddressRow.classList.add('hidden');
  }

  reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showSuccess() {
  wasteForm.classList.add('hidden');
  reviewPanel.classList.add('hidden');
  successPanel.classList.remove('hidden');
  matchPanel.classList.add('hidden');
  if (paymentPanel) paymentPanel.classList.add('hidden');
  if (recoveryTrackerPanel) recoveryTrackerPanel.classList.add('hidden');
  if (pricePanel) pricePanel.classList.add('hidden');
  successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showMatch() {
  wasteForm.classList.add('hidden');
  reviewPanel.classList.add('hidden');
  successPanel.classList.add('hidden');
  matchPanel.classList.remove('hidden');
  matchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =============================================
// PHASE 6: GOOGLE MAPS PLATFORM INTEGRATION
// =============================================

// Dark mode map theme styling
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0f1612" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0f0d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a8a0" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#34d399" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#5f7a6e" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#14251c" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#22c55e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c2b23" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#141e19" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#94a8a0" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#243830" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#166534" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#34d399" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#06130d" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3b82f6" }] }
];

function showLocationError(msg) {
  if (!locationErrorMsg) return;
  locationErrorMsg.textContent = msg;
  locationErrorMsg.classList.remove('hidden');
}

function clearLocationError() {
  if (!locationErrorMsg) return;
  locationErrorMsg.textContent = '';
  locationErrorMsg.classList.add('hidden');
}

function suggestMatchingZone(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  if (lower.includes('north')) return 'North Sector';
  if (lower.includes('south')) return 'South Hub';
  if (lower.includes('east') || lower.includes('industrial')) return 'Industrial East';
  if (lower.includes('central') || lower.includes('city') || lower.includes('downtown')) return 'Central City';
  return null;
}

function handleMapsUnavailable(reason) {
  console.warn('Google Maps unavailable:', reason);
  isMapsConfigured = false;
  if (mapLoadingOverlay) mapLoadingOverlay.classList.add('loaded');
  if (mapFallbackBanner) {
    mapFallbackBanner.classList.remove('hidden');
    if (mapFallbackMsg && reason) mapFallbackMsg.textContent = reason;
  }
  if (mapStatusBadge) {
    mapStatusBadge.textContent = '📍 Manual Zone Mode';
    mapStatusBadge.classList.add('badge-offline');
  }
  if (btnRetryMap) btnRetryMap.classList.remove('hidden');
  if (mapContainerWrapper) mapContainerWrapper.style.display = 'none';
  if (btnConfirmLocation) btnConfirmLocation.disabled = true;
}

window.gm_authFailure = function() {
  handleMapsUnavailable('Google Maps authentication failed. Please check your API key, billing, enabled APIs, and HTTP referrer restrictions.');
};

window.initGoogleMap = function() {
  const mapElement = document.getElementById('location-map');
  if (!mapElement || !window.google || !window.google.maps) {
    handleMapsUnavailable('Google Maps library failed to initialize.');
    return;
  }

  try {
    googleMap = new google.maps.Map(mapElement, {
      center: DEFAULT_MAP_CENTER,
      zoom: 12,
      styles: DARK_MAP_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true
    });

    googleGeocoder = new google.maps.Geocoder();

    googleMarker = new google.maps.Marker({
      position: DEFAULT_MAP_CENTER,
      map: googleMap,
      draggable: true,
      title: 'Waste Pickup Location (Drag to adjust)'
    });

    // Places Autocomplete
    if (window.google.maps.places && placeSearchInput) {
      googleAutocomplete = new google.maps.places.Autocomplete(placeSearchInput, {
        fields: ['formatted_address', 'geometry', 'name', 'place_id']
      });
      googleAutocomplete.bindTo('bounds', googleMap);

      googleAutocomplete.addListener('place_changed', () => {
        clearLocationError();
        const place = googleAutocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) {
          showLocationError('No location details available for: ' + (place.name || 'selected place'));
          return;
        }

        const latLng = place.geometry.location;
        googleMap.setCenter(latLng);
        googleMap.setZoom(15);
        googleMarker.setPosition(latLng);

        setCandidateLocation(
          latLng.lat(),
          latLng.lng(),
          place.formatted_address || place.name || 'Selected Place',
          place.place_id || null
        );
      });
    }

    // Map Click Listener
    googleMap.addListener('click', (e) => {
      clearLocationError();
      const latLng = e.latLng;
      googleMarker.setPosition(latLng);
      reverseGeocodeAndStage(latLng.lat(), latLng.lng());
    });

    // Marker Dragend Listener
    googleMarker.addListener('dragend', (e) => {
      clearLocationError();
      const latLng = e.latLng;
      reverseGeocodeAndStage(latLng.lat(), latLng.lng());
    });

    // Geocode initial position
    reverseGeocodeAndStage(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng, true);

    // Hide loading overlay
    if (mapLoadingOverlay) mapLoadingOverlay.classList.add('loaded');
    if (mapStatusBadge) {
      mapStatusBadge.textContent = '📍 Google Maps Ready';
      mapStatusBadge.classList.remove('badge-offline');
    }
  } catch (err) {
    console.error('Map init error:', err);
    handleMapsUnavailable('Failed to initialize Google Maps: ' + err.message);
  }
};

function reverseGeocodeAndStage(lat, lng, isInitial = false) {
  if (!googleGeocoder) {
    setCandidateLocation(lat, lng, `Pinned: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, null);
    return;
  }

  googleGeocoder.geocode({ location: { lat, lng } }, (results, status) => {
    if (status === 'OK' && results && results[0]) {
      const address = results[0].formatted_address;
      const placeId = results[0].place_id || null;
      setCandidateLocation(lat, lng, address, placeId);
      if (!isInitial && placeSearchInput) {
        placeSearchInput.value = address;
      }
    } else {
      setCandidateLocation(lat, lng, `Pinned: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, null);
    }
  });
}

function setCandidateLocation(lat, lng, address, placeId) {
  candidateLocation = {
    latitude: lat,
    longitude: lng,
    formatted_address: address,
    place_id: placeId
  };

  if (btnConfirmLocation) {
    btnConfirmLocation.disabled = false;
    if (btnConfirmLocText) btnConfirmLocText.textContent = 'Confirm Pinned Location';
  }

  // Suggest demo zone if possible
  const suggested = suggestMatchingZone(address);
  if (suggested && zoneSelect) {
    zoneSelect.value = suggested;
    if (zoneHint) {
      zoneHint.textContent = `Auto-selected "${suggested}" based on pinned address. You can adjust it if needed.`;
    }
  }
}

function confirmLocationSelection() {
  if (!candidateLocation) {
    showLocationError('Please search for a place or click on the map to pin a location first.');
    return;
  }

  confirmedLocation = {
    ...candidateLocation,
    locality: zoneSelect ? zoneSelect.value : 'Central City'
  };

  if (locLatInput) locLatInput.value = confirmedLocation.latitude;
  if (locLngInput) locLngInput.value = confirmedLocation.longitude;
  if (locAddressInput) locAddressInput.value = confirmedLocation.formatted_address;
  if (locPlaceIdInput) locPlaceIdInput.value = confirmedLocation.place_id || '';

  if (selectedLocationCard) {
    selectedLocationCard.classList.remove('hidden');
    if (locCoordsDisplay) {
      locCoordsDisplay.textContent = `${confirmedLocation.latitude.toFixed(4)}, ${confirmedLocation.longitude.toFixed(4)}`;
    }
    if (locAddressDisplay) {
      locAddressDisplay.textContent = confirmedLocation.formatted_address;
    }
  }

  if (btnConfirmLocText) {
    btnConfirmLocText.textContent = 'Location Confirmed ✓';
  }
  if (btnConfirmLocation) {
    btnConfirmLocation.disabled = true;
  }

  clearLocationError();
  showToast('Location confirmed for waste pickup!', 'success');
}

if (btnConfirmLocation) {
  btnConfirmLocation.addEventListener('click', confirmLocationSelection);
}

// "Use My Current Location" button handler
if (btnLocateMe) {
  btnLocateMe.addEventListener('click', () => {
    clearLocationError();
    if (!navigator.geolocation) {
      showLocationError('Geolocation is not supported by your browser.');
      return;
    }

    setButtonLoading(btnLocateMe, true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setButtonLoading(btnLocateMe, false);
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const latLng = { lat, lng };

        if (googleMap) {
          googleMap.setCenter(latLng);
          googleMap.setZoom(15);
        }
        if (googleMarker) {
          googleMarker.setPosition(latLng);
        }

        reverseGeocodeAndStage(lat, lng);
        showToast('Found your current location!', 'info');
      },
      (error) => {
        setButtonLoading(btnLocateMe, false);
        if (error.code === 1) { // PERMISSION_DENIED
          showLocationError('Device location permission was denied. You can search an address or click the map directly.');
          showToast('Location permission denied.', 'warning');
        } else {
          showLocationError('Could not determine your location. Please search for an address.');
          showToast('Location acquisition failed.', 'error');
        }
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  });
}

// Retry map load button
if (btnRetryMap) {
  btnRetryMap.addEventListener('click', () => {
    btnRetryMap.classList.add('hidden');
    if (mapContainerWrapper) mapContainerWrapper.style.display = 'block';
    if (mapFallbackBanner) mapFallbackBanner.classList.add('hidden');
    if (mapLoadingOverlay) mapLoadingOverlay.classList.remove('loaded');
    loadGoogleMapsApi();
  });
}

// Load Google Maps API via config endpoint
async function loadGoogleMapsApi() {
  try {
    const res = await fetch(`${API_BASE}/api/config/maps`);
    if (!res.ok) {
      handleMapsUnavailable('Could not check Google Maps configuration.');
      return;
    }

    const config = await res.json();
    if (!config.configured || !config.googleMapsBrowserKey) {
      handleMapsUnavailable('Google Maps API key is not configured in .env (GOOGLE_MAPS_BROWSER_KEY). Interactive map is offline; you can use the manual zone selector below.');
      return;
    }

    isMapsConfigured = true;

    // Check if script already injected
    if (document.getElementById('google-maps-script')) {
      if (window.google && window.google.maps) {
        window.initGoogleMap();
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsBrowserKey)}&libraries=places&loading=async&callback=initGoogleMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      handleMapsUnavailable('Failed to load Google Maps script. Check network connection or API key validity.');
    };

    document.head.appendChild(script);
  } catch (err) {
    console.error('Error fetching Maps config:', err);
    handleMapsUnavailable('Error contacting server for Maps configuration.');
  }
}

// =============================================
// FORM SUBMISSION → /api/analyze
// =============================================
wasteForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (isSubmitting) return;

  const file = fileInput.files[0];
  const quantity = parseFloat(document.getElementById('quantity').value);
  const locality = document.getElementById('locality').value;
  const condition = document.getElementById('condition').value;

  // Client-side validation
  if (!file) {
    showToast('Please upload an image of your waste.', 'error');
    return;
  }
  if (!validateFile(file)) return;

  if (!quantity || quantity <= 0 || !Number.isFinite(quantity)) {
    showToast('Please enter a valid positive quantity in kilograms.', 'error');
    return;
  }

  if (!locality) {
    showToast('Please select a locality/zone.', 'error');
    return;
  }

  if (!condition) {
    showToast('Please select the waste condition.', 'error');
    return;
  }

  // Send image to /api/analyze
  isSubmitting = true;
  setButtonLoading(submitBtn, true);
  submitText.textContent = 'Analyzing…';

  try {
    const formData = new FormData();
    formData.append('waste-image', file);

    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      body: formData
      // Do NOT set Content-Type — browser sets multipart boundary automatically
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Analysis failed. Please try again.', 'error');
      return;
    }

    // Auto-confirm candidate location if pinned on map but not explicitly confirmed
    if (!confirmedLocation && candidateLocation) {
      confirmedLocation = {
        ...candidateLocation,
        locality: locality
      };
    }

    // Store analysis + user inputs for the confirmation step
    currentAnalysis = {
      ...data,
      user_quantity_kg: quantity,
      user_locality: locality,
      user_condition: condition,
      user_location: confirmedLocation ? {
        formatted_address: confirmedLocation.formatted_address || '',
        latitude: confirmedLocation.latitude,
        longitude: confirmedLocation.longitude,
        place_id: confirmedLocation.place_id || null,
        locality: locality
      } : null
    };

    // Populate review panel
    reviewMaterial.textContent = data.material || '—';
    reviewCondition.textContent = data.visible_condition || '—';
    reviewNote.textContent = data.note || '';
    if (reviewQuantity) reviewQuantity.textContent = `${quantity} kg`;
    if (reviewLocality) reviewLocality.textContent = locality;
    if (confirmCondition) confirmCondition.value = condition;

    // Feature 1: Detailed Vision Breakdown
    const aiPetDetectedBadge = document.getElementById('ai-pet-detected-badge');
    const aiBottleCountVal = document.getElementById('ai-bottle-count-val');
    const aiRoughEstimateBadge = document.getElementById('ai-rough-estimate-badge');
    const aiContaminationTags = document.getElementById('ai-contamination-tags');
    const aiLimitationsTags = document.getElementById('ai-limitations-tags');
    const aiWarningsBox = document.getElementById('ai-warnings-box');
    const aiWarningsList = document.getElementById('ai-warnings-list');

    if (aiPetDetectedBadge) {
      if (data.is_pet_bottle) {
        aiPetDetectedBadge.textContent = '✅ PET Bottles Confirmed';
        aiPetDetectedBadge.style.color = 'var(--color-emerald-700)';
      } else {
        aiPetDetectedBadge.textContent = '⚠️ Non-PET or Unconfirmed';
        aiPetDetectedBadge.style.color = '#b45309';
      }
    }

    if (aiBottleCountVal) {
      if (typeof data.estimated_bottle_count === 'number' && data.estimated_bottle_count > 0) {
        aiBottleCountVal.textContent = `~${data.estimated_bottle_count} bottles`;
      } else {
        aiBottleCountVal.textContent = 'Not estimated';
      }
    }

    if (aiRoughEstimateBadge) {
      aiRoughEstimateBadge.textContent = data.is_rough_estimate ? 'Rough Visual Estimate' : 'Verified Inspection';
      aiRoughEstimateBadge.className = data.is_rough_estimate ? 'badge badge-test' : 'badge badge-success';
    }

    if (aiContaminationTags) {
      const contamList = Array.isArray(data.contamination_indicators) ? data.contamination_indicators : [];
      if (contamList.length > 0) {
        aiContaminationTags.innerHTML = contamList.map(item => `
          <span class="inspection-tag inspection-tag-warning">⚠️ ${escapeHtml(item)}</span>
        `).join('');
      } else {
        aiContaminationTags.innerHTML = '<span class="inspection-tag inspection-tag-clean">✓ No visible surface contaminants</span>';
      }
    }

    if (aiLimitationsTags) {
      const limitList = Array.isArray(data.image_quality_limitations) ? data.image_quality_limitations : [];
      if (limitList.length > 0) {
        aiLimitationsTags.innerHTML = limitList.map(item => `
          <span class="inspection-tag inspection-tag-info">ℹ️ ${escapeHtml(item)}</span>
        `).join('');
      } else {
        aiLimitationsTags.innerHTML = '<span class="tag-empty">Standard resolution image</span>';
      }
    }

    if (aiWarningsBox && aiWarningsList) {
      const warnList = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnList.length > 0) {
        aiWarningsBox.classList.remove('hidden');
        aiWarningsList.innerHTML = warnList.map(w => `<li>${escapeHtml(w)}</li>`).join('');
      } else {
        aiWarningsBox.classList.add('hidden');
      }
    }

    // Populate Rich 5-Section AI Classification Cards
    const detail = data.detailed_classification || {};
    const matComp = detail.material_composition || {};
    const recCirc = detail.recovery_and_circularity || {};
    const qualAssess = detail.quality_assessment || {};
    const adv = detail.circular_economy_advisory || {};

    const aiBackendStatusBadge = document.getElementById('ai-backend-status-badge');
    if (aiBackendStatusBadge) {
      if (data.fallback_used) {
        aiBackendStatusBadge.textContent = 'Fallback Mode (Offline Heuristics)';
        aiBackendStatusBadge.className = 'badge badge-test';
      } else {
        aiBackendStatusBadge.textContent = 'Gemini 2.5 Flash Verified';
        aiBackendStatusBadge.className = 'badge badge-secure';
      }
    }

    const aiResinCode = document.getElementById('ai-resin-code');
    if (aiResinCode) aiResinCode.textContent = matComp.resin_identification_code || '#1 PET (Polyethylene Terephthalate)';

    const aiTransparency = document.getElementById('ai-transparency');
    if (aiTransparency) aiTransparency.textContent = matComp.transparency_clarity || 'Transparent / Clear';

    const aiBottleType = document.getElementById('ai-bottle-type');
    if (aiBottleType) aiBottleType.textContent = matComp.container_type || 'Rigid Beverage Bottles';

    const aiLabelsCaps = document.getElementById('ai-labels-caps');
    if (aiLabelsCaps) aiLabelsCaps.textContent = matComp.cap_and_closure_presence || 'Mixed / Partially Attached';

    const aiUnitWeight = document.getElementById('ai-unit-weight');
    if (aiUnitWeight) {
      aiUnitWeight.textContent = matComp.estimated_single_unit_weight_grams 
        ? `~${matComp.estimated_single_unit_weight_grams}g / bottle` 
        : '~20g - 28g / bottle';
    }

    const aiCommercialGrade = document.getElementById('ai-commercial-grade');
    if (aiCommercialGrade) aiCommercialGrade.textContent = matComp.commercial_recycling_grade || 'Grade A Post-Consumer';

    const aiCircularityIndex = document.getElementById('ai-circularity-index');
    if (aiCircularityIndex) {
      const circScore = recCirc.circularity_potential_score || 85;
      aiCircularityIndex.textContent = `High (${circScore}/100)`;
    }

    const aiFlakingViability = document.getElementById('ai-flaking-viability');
    if (aiFlakingViability) aiFlakingViability.textContent = recCirc.flaking_suitability || 'Direct Hot-Wash Flaking Ready';

    const aiRpetPotential = document.getElementById('ai-rpet-potential');
    if (aiRpetPotential) aiRpetPotential.textContent = recCirc.rpet_pellet_viability || 'Food-Contact & Fiber Grade rPET';

    const aiWashingRequired = document.getElementById('ai-washing-required');
    if (aiWashingRequired) aiWashingRequired.textContent = recCirc.washing_protocol_recommended || 'Standard Alkaline Wash';

    const aiRecList = document.getElementById('ai-recommendations-list');
    if (aiRecList) {
      const steps = Array.isArray(adv.next_recommended_steps) && adv.next_recommended_steps.length > 0
        ? adv.next_recommended_steps
        : [
            'Rinse & Flatten: Empty liquids and remove caps to boost recycler match scores.',
            'Price Benchmark: Run price intelligence to discover local scrap market rates.',
            'Submit Proposals: Connect with verified recyclers and submit price counteroffers.'
          ];
      aiRecList.innerHTML = steps.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    }

    if (data.fallback_used) {
      reviewBadge.textContent = '⚠️ Fallback Mode — AI not available';
      reviewBadge.style.background = 'rgba(251, 191, 36, 0.15)';
      reviewBadge.style.borderColor = 'rgba(251, 191, 36, 0.3)';
      reviewBadge.style.color = '#fbbf24';
      reviewConfidence.textContent = 'Fallback estimate — please verify';
    } else {
      reviewBadge.textContent = '🤖 Gemini AI Analysis';
      reviewBadge.style.background = 'rgba(52, 211, 153, 0.15)';
      reviewBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
      reviewBadge.style.color = '#34d399';
      reviewConfidence.textContent = (data.confidence || '—') + ' confidence (AI estimate)';
    }

    // Pre-select detected material in dropdown — only if it's PET Plastic
    // If AI detected something else, default to PET Plastic and show a note
    if (data.material === 'PET Plastic') {
      confirmMaterial.value = 'PET Plastic';
    } else {
      // AI detected non-PET material — user must confirm
      confirmMaterial.value = 'PET Plastic';
      if (!data.fallback_used) {
        reviewNote.textContent = (data.note || '') +
          '\n\n⚠️ The AI detected "' + data.material + '" which is not PET Plastic. ' +
          'This app currently supports PET Plastic only. Please confirm the material below, ' +
          'or start over if this is not PET plastic.';
      }
    }

    showReview();
    if (data.fallback_used) {
      showToast('Fallback estimate shown — AI was not available. Please review.', 'warning');
    } else {
      showToast('AI analysis complete — please review and confirm.', 'success');
    }

  } catch (err) {
    console.error('Analyze error:', err);
    showToast('Could not reach the server. Is it running?', 'error');
  } finally {
    isSubmitting = false;
    setButtonLoading(submitBtn, false);
    submitText.textContent = 'Analyze My Waste';
  }
});

// =============================================
// CONFIRM & CREATE LISTING → /api/listings
// =============================================
confirmBtn.addEventListener('click', async () => {
  if (isConfirming || !currentAnalysis) return;

  const confirmedMaterial = confirmMaterial.value;
  const confirmedCondition = confirmCondition ? confirmCondition.value : currentAnalysis.user_condition;

  if (!confirmedMaterial) {
    showToast('Please select a material.', 'error');
    return;
  }
  if (confirmedMaterial !== 'PET Plastic') {
    showToast('EcoCycle AI currently supports PET plastic beverage bottles only. Non-PET materials cannot be listed.', 'error');
    return;
  }
  if (!confirmedCondition) {
    showToast('Please select a condition.', 'error');
    return;
  }

  isConfirming = true;
  setButtonLoading(confirmBtn, true);
  confirmText.textContent = 'Creating listing…';

  try {
    const res = await fetch(`${API_BASE}/api/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        confirmed_material: confirmedMaterial,
        quantity_kg: currentAnalysis.user_quantity_kg,
        locality: currentAnalysis.user_locality,
        condition: confirmedCondition,
        location: currentAnalysis.user_location || null
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to create listing.', 'error');
      return;
    }

    // Show success
    const listing = data.listing;
    currentListing = listing;

    let locationInfo = '';
    if (listing.location && listing.location.formatted_address) {
      locationInfo += `<strong>Address:</strong> ${escapeHtml(listing.location.formatted_address)}<br>`;
      if (listing.location.latitude !== null && listing.location.longitude !== null) {
        locationInfo += `<strong>GPS:</strong> ${escapeHtml(listing.location.latitude.toFixed(4))}, ${escapeHtml(listing.location.longitude.toFixed(4))}<br>`;
      }
    }

    const ownershipInfo = listing.user_id
      ? `<span class="badge badge-success">👤 Private (${escapeHtml(currentUser ? currentUser.email : 'Your Account')})</span>`
      : `<span class="badge badge-test">Demo Mode (Guest)</span>`;

    successDetails.innerHTML = `
      <strong>Listing ID:</strong> ${escapeHtml(listing.id)}<br>
      <strong>Material:</strong> ${escapeHtml(listing.confirmed_material)}<br>
      <strong>Quantity:</strong> ${escapeHtml(listing.quantity_kg)} kg<br>
      <strong>Zone:</strong> ${escapeHtml(listing.locality)}<br>
      ${locationInfo}
      <strong>Condition:</strong> ${escapeHtml(listing.condition)}<br>
      <strong>Scope:</strong> ${ownershipInfo}<br>
      <strong>Status:</strong> ${escapeHtml(listing.status)}<br>
      <strong>Created:</strong> ${escapeHtml(new Date(listing.created_at).toLocaleString())}
    `;

    showSuccess();
    showToast('Listing created successfully!', 'success');

  } catch (err) {
    console.error('Listing error:', err);
    showToast('Could not reach the server. Is it running?', 'error');
  } finally {
    isConfirming = false;
    setButtonLoading(confirmBtn, false);
    confirmText.textContent = 'Confirm & Create Listing';
  }
});

// =============================================
// FIND MATCHING BUYERS → /api/match
// =============================================
findBuyersBtn.addEventListener('click', async () => {
  if (isMatching || !currentListing) return;

  isMatching = true;
  setButtonLoading(findBuyersBtn, true);
  findBuyersText.textContent = 'Finding matches…';

  try {
    const res = await fetch(`${API_BASE}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listing_id: currentListing.id,
        confirmed_material: currentListing.confirmed_material,
        quantity_kg: currentListing.quantity_kg,
        locality: currentListing.locality,
        condition: currentListing.condition
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Matching request failed.', 'error');
      return;
    }

    matchMessage.textContent = data.message || '';
    buyerCardsEl.innerHTML = '';

    if (data.eligible && data.eligible.length > 0) {
      noMatchEl.classList.add('hidden');

      data.eligible.forEach(buyer => {
        const card = document.createElement('div');
        card.className = 'buyer-card';

        const demandClass = escapeHtml((buyer.demand_level || 'Low').toLowerCase());
        const demandLevel = escapeHtml(buyer.demand_level || 'Unknown');
        const buyerName = escapeHtml(buyer.buyer_name || 'Buyer');
        const score = Number(buyer.score) || 0;
        const reasonsHtml = (buyer.match_reasons || [])
          .map(r => `<li>${escapeHtml(r)}</li>`)
          .join('');
        const notesHtml = buyer.notes
          ? `<div class="buyer-notes">${escapeHtml(buyer.notes)}</div>`
          : '';

        // Feature 2: Explainable structured factors
        let factorsHtml = '';
        if (Array.isArray(buyer.reasons) && buyer.reasons.length > 0) {
          const rows = buyer.reasons.map(f => {
            const statusKey = (f.status || 'MATCH').toLowerCase();
            const statusLabel = f.status === 'MATCH' ? '✓ MATCH' : (f.status === 'PARTIAL' ? '⚡ PARTIAL' : '✗ MISMATCH');
            const pct = f.weight > 0 ? Math.min(100, Math.round((f.score / f.weight) * 100)) : 0;
            return `
              <div class="factor-row">
                <div class="factor-top">
                  <span class="factor-name-wrap">
                    <span class="factor-badge factor-badge-${statusKey}">${statusLabel}</span>
                    <span>${escapeHtml(f.factor)}</span>
                  </span>
                  <span class="factor-score-val">${f.score} / ${f.weight} pts</span>
                </div>
                <div class="factor-bar-bg">
                  <div class="factor-bar-fill factor-fill-${statusKey}" style="width: ${pct}%"></div>
                </div>
                <span class="factor-msg">${escapeHtml(f.message)}</span>
              </div>
            `;
          }).join('');

          factorsHtml = `
            <div class="buyer-factors-breakdown">
              <div class="factors-title">
                <span>Deterministic Compatibility Scoring</span>
                <span>${score}/100</span>
              </div>
              <div class="factors-list">
                ${rows}
              </div>
            </div>
          `;
        }

        card.innerHTML = `
          <div class="buyer-card-header">
            <span class="buyer-name">${buyerName}</span>
            <span class="buyer-score-badge">Score: ${score}/100</span>
          </div>
          <div class="score-bar">
            <div class="score-fill" style="width: ${Math.min(100, Math.max(0, score))}%"></div>
          </div>
          <div>
            <span class="buyer-demand demand-${demandClass}">Demand: ${demandLevel}</span>
          </div>
          ${factorsHtml ? factorsHtml : `<ul class="buyer-reasons">${reasonsHtml}</ul>`}
          ${notesHtml}
          
          <!-- In-Card Transport Feasibility Container -->
          <div class="buyer-transport-box hidden" id="transport-box-${escapeHtml(buyer.buyer_id)}"></div>

          <!-- Buyer Card Actions -->
          <div class="buyer-card-actions">
            <button type="button" class="btn btn-secondary btn-sm btn-select-buyer" id="btn-select-${escapeHtml(buyer.buyer_id)}">
              🤝 Select Partner & Reserve Pickup (₹50 Demo Fee)
            </button>
            <div class="buyer-btn-row">
              <button type="button" class="btn btn-outline btn-sm btn-check-transport" id="btn-transport-${escapeHtml(buyer.buyer_id)}">
                🚚 Transport
              </button>
              <button type="button" class="btn btn-primary btn-sm btn-negotiate" id="btn-neg-${escapeHtml(buyer.buyer_id)}">
                🤝 Negotiate
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-buyer-chat" id="btn-chat-${escapeHtml(buyer.buyer_id)}">
                💬 Chat
              </button>
            </div>
          </div>
        `;

        // Wire up buttons
        const selectBtn = card.querySelector(`#btn-select-${CSS.escape(buyer.buyer_id)}`);
        if (selectBtn) {
          selectBtn.addEventListener('click', () => {
            selectBuyerForPayment(buyer);
          });
        }

        const transportBtn = card.querySelector(`#btn-transport-${CSS.escape(buyer.buyer_id)}`);
        if (transportBtn) {
          transportBtn.addEventListener('click', () => {
            checkBuyerTransportFeasibility(buyer);
          });
        }

        const negBtn = card.querySelector(`#btn-neg-${CSS.escape(buyer.buyer_id)}`);
        if (negBtn) {
          negBtn.addEventListener('click', () => {
            startBuyerNegotiation(buyer);
          });
        }

        const chatBtn = card.querySelector(`#btn-chat-${CSS.escape(buyer.buyer_id)}`);
        if (chatBtn) {
          chatBtn.addEventListener('click', () => {
            startBuyerChat(buyer);
          });
        }

        buyerCardsEl.appendChild(card);
      });
    } else {
      noMatchEl.classList.remove('hidden');
    }

    showMatch();
    showToast('Matching completed!', 'success');

  } catch (err) {
    console.error('Match error:', err);
    showToast('Could not reach the server. Is it running?', 'error');
  } finally {
    isMatching = false;
    setButtonLoading(findBuyersBtn, false);
    findBuyersText.textContent = 'Find Matching Buyers';
  }
});

// =============================================
// RESET / START OVER
// =============================================
function resetToForm() {
  currentAnalysis = null;
  currentListing = null;
  confirmedLocation = null;
  candidateLocation = null;
  selectedBuyer = null;
  isPaying = false;

  // Reset form fields
  wasteForm.reset();
  uploadArea.classList.remove('has-image');
  uploadArea.classList.remove('drag-over');
  uploadPreview.src = '';
  fileInput.value = '';

  // Reset location UI
  if (placeSearchInput) placeSearchInput.value = '';
  if (selectedLocationCard) selectedLocationCard.classList.add('hidden');
  if (reviewAddressRow) reviewAddressRow.classList.add('hidden');
  if (btnConfirmLocText) btnConfirmLocText.textContent = 'Confirm Pinned Location';
  if (btnConfirmLocation) btnConfirmLocation.disabled = true;
  if (locationErrorMsg) locationErrorMsg.classList.add('hidden');
  if (googleMap && googleMarker) {
    googleMap.setCenter(DEFAULT_MAP_CENTER);
    googleMap.setZoom(12);
    googleMarker.setPosition(DEFAULT_MAP_CENTER);
  }

  // Reset Phase 7 Payment & Recovery UI
  if (paymentPanel) paymentPanel.classList.add('hidden');
  if (paymentPrereqCard) paymentPrereqCard.classList.add('hidden');
  if (paymentSuccessCard) paymentSuccessCard.classList.add('hidden');
  if (paymentError) paymentError.classList.add('hidden');
  if (recoveryTrackerPanel) recoveryTrackerPanel.classList.add('hidden');
  if (btnPayRazorpay) {
    btnPayRazorpay.classList.remove('hidden');
    btnPayRazorpay.disabled = false;
    btnPayText.textContent = 'Pay ₹50.00 via Razorpay (Test Mode)';
  }
  if (paySpinner) paySpinner.classList.add('hidden');

  // Reset Phase 9 Price Intelligence UI
  if (pricePanel) pricePanel.classList.add('hidden');
  if (priceCard) priceCard.classList.remove('hidden');
  if (priceUnavailableCard) priceUnavailableCard.classList.add('hidden');
  if (priceSpinner) priceSpinner.classList.add('hidden');
  if (btnEstimatePrice) {
    btnEstimatePrice.disabled = false;
    if (btnEstimatePriceText) btnEstimatePriceText.textContent = 'Estimate PET Scrap Value';
  }
  isEstimatingPrice = false;
  currentPriceEstimate = null;

  showForm();
}

resetFormBtn.addEventListener('click', resetToForm);
newListingBtn.addEventListener('click', resetToForm);
matchNewBtn.addEventListener('click', resetToForm);

// =============================================
// PHASE 7: RAZORPAY TEST PAYMENT WORKFLOW
// =============================================

async function loadRazorpayConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config/razorpay`);
    const data = await res.json();
    razorpayConfig = data;

    if (!data.configured) {
      if (paymentFallbackBanner) paymentFallbackBanner.classList.remove('hidden');
      if (razorpayModeBadge) {
        razorpayModeBadge.textContent = 'Razorpay Test Mode Offline';
        razorpayModeBadge.className = 'badge badge-warning';
      }
      if (btnPayRazorpay) {
        btnPayRazorpay.disabled = true;
        if (btnPayText) btnPayText.textContent = 'Razorpay Test Mode Offline (Configure .env)';
      }
    } else {
      if (paymentFallbackBanner) paymentFallbackBanner.classList.add('hidden');
      if (razorpayModeBadge) {
        const isLive = data.environment === 'live';
        const maskedKey = data.key_id ? `${data.key_id.substring(0, 8)}…` : '';
        razorpayModeBadge.textContent = isLive ? `Razorpay Live (${maskedKey})` : `Razorpay Test Mode Active (${maskedKey})`;
        razorpayModeBadge.className = isLive ? 'badge badge-primary' : 'badge badge-test';
      }
      if (btnPayRazorpay) {
        btnPayRazorpay.disabled = false;
        if (btnPayText) btnPayText.textContent = `Pay ₹${data.facilitation_fee_inr || '50.00'} via Razorpay (${data.test_mode ? 'Test Mode' : 'Checkout'})`;
      }
    }
  } catch (err) {
    console.warn('Could not fetch Razorpay config:', err.message);
  }
}

if (btnRecheckRazorpay) {
  btnRecheckRazorpay.addEventListener('click', async () => {
    btnRecheckRazorpay.disabled = true;
    btnRecheckRazorpay.innerHTML = '<span>Checking…</span>';
    await loadRazorpayConfig();
    btnRecheckRazorpay.disabled = false;
    btnRecheckRazorpay.innerHTML = '<span>Recheck .env</span>';
    if (razorpayConfig && razorpayConfig.configured) {
      showToast('Razorpay credentials detected and active!', 'success');
    } else {
      showToast('Razorpay keys not detected in .env yet.', 'warning');
    }
  });
}

function openPaymentPanel() {
  if (paymentPanel) {
    paymentPanel.classList.remove('hidden');
    paymentPanel.scrollIntoView({ behavior: 'smooth' });
  }

  if (!currentListing) {
    if (paymentPrereqCard) paymentPrereqCard.classList.remove('hidden');
    if (paymentCard) paymentCard.classList.add('hidden');
  } else {
    if (paymentPrereqCard) paymentPrereqCard.classList.add('hidden');
    if (paymentCard) paymentCard.classList.remove('hidden');
    if (payListingId) payListingId.textContent = currentListing.id;
    if (payMaterial) payMaterial.textContent = currentListing.confirmed_material || 'PET Plastic';
    if (payQuantity) payQuantity.textContent = `${currentListing.quantity_kg} kg`;
    if (payBuyer) {
      payBuyer.textContent = selectedBuyer
        ? `${selectedBuyer.buyer_name} (${selectedBuyer.buyer_id})`
        : 'Demo Partner Allocation (Pending)';
    }
  }
}

function selectBuyerForPayment(buyer) {
  selectedBuyer = buyer;
  if (payListingId) payListingId.textContent = currentListing ? currentListing.id : '—';
  if (payMaterial) payMaterial.textContent = currentListing ? currentListing.confirmed_material : 'PET Plastic';
  if (payQuantity) payQuantity.textContent = currentListing ? `${currentListing.quantity_kg} kg` : '—';
  if (payBuyer) payBuyer.textContent = `${buyer.buyer_name} (${buyer.buyer_id})`;

  if (paymentPrereqCard) paymentPrereqCard.classList.add('hidden');
  if (paymentCard) paymentCard.classList.remove('hidden');

  if (paymentPanel) {
    paymentPanel.classList.remove('hidden');
    paymentPanel.scrollIntoView({ behavior: 'smooth' });
  }

  if (recoveryTrackerPanel) {
    recoveryTrackerPanel.classList.remove('hidden');
  }

  // Record that a buyer match has been selected in physical lifecycle
  if (currentListing) {
    fetch(`${API_BASE}/api/listings/${currentListing.id}/recovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'MATCHED',
        note: `Matched with recycler ${buyer.buyer_name} (ID: ${buyer.buyer_id}). Scheduled for demo collection reservation.`,
        verified_by: 'Demo Operator (User-Entered)'
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          renderRecoveryUI(data.recovery_status, data.recovery_history);
        }
      })
      .catch(err => console.error('Failed to advance recovery state to MATCHED:', err));
  }
}

if (btnPayRazorpay) {
  btnPayRazorpay.addEventListener('click', async () => {
    if (isPaying) return;
    if (paymentError) paymentError.classList.add('hidden');

    if (!currentListing) {
      if (paymentError) {
        paymentError.textContent = 'Please create or confirm a PET listing first before initiating payment.';
        paymentError.classList.remove('hidden');
      }
      showToast('Please create or confirm a PET listing first.', 'warning');
      return;
    }

    if (!razorpayConfig || !razorpayConfig.configured) {
      if (paymentError) {
        paymentError.textContent = 'Razorpay Test Mode is offline. Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your server .env file.';
        paymentError.classList.remove('hidden');
      }
      showToast('Razorpay keys not configured on server.', 'warning');
      return;
    }

    if (!window.Razorpay) {
      // Dynamic fallback load
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.head.appendChild(script);
      await new Promise(r => setTimeout(r, 800));

      if (!window.Razorpay) {
        if (paymentError) {
          paymentError.textContent = 'Razorpay Checkout script could not be loaded. Please check your internet connection or ad blocker.';
          paymentError.classList.remove('hidden');
        }
        showToast('Razorpay Checkout script could not be loaded.', 'error');
        return;
      }
    }

    isPaying = true;
    btnPayRazorpay.disabled = true;
    if (paySpinner) paySpinner.classList.remove('hidden');
    btnPayText.textContent = 'Initializing Checkout…';

    try {
      const res = await fetch(`${API_BASE}/api/payments/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: currentListing.id,
          amount_paise: razorpayConfig.facilitation_fee_paise || 5000,
          currency: 'INR'
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (paymentError) {
          paymentError.textContent = data.error || 'Failed to initiate Razorpay test order.';
          paymentError.classList.remove('hidden');
        }
        const feeStr = razorpayConfig.facilitation_fee_inr || '50.00';
        btnPayText.textContent = `Pay ₹${feeStr} via Razorpay (Test Mode)`;
        btnPayRazorpay.disabled = false;
        if (paySpinner) paySpinner.classList.add('hidden');
        isPaying = false;
        return;
      }

      // Configure official Razorpay Standard Checkout
      const defaultName = (currentUser && currentUser.name) || 'EcoCycle Partner';
      const defaultEmail = (currentUser && currentUser.email) || 'partner@ecocycle.ai';
      const defaultContact = (currentUser && currentUser.phone) || '9876543210';

      const options = {
        key: data.key_id,
        amount: data.amount,
        currency: data.currency || 'INR',
        name: 'EcoCycle AI',
        description: 'PET Recycling Deposit & Facilitation (Test Mode)',
        order_id: data.order_id,
        handler: async function (response) {
          await verifyPayment(response);
        },
        prefill: {
          name: defaultName,
          email: defaultEmail,
          contact: defaultContact
        },
        notes: {
          listing_id: currentListing.id,
          platform: 'EcoCycle AI'
        },
        theme: {
          color: '#10b981'
        },
        modal: {
          ondismiss: function () {
            const feeStr = razorpayConfig.facilitation_fee_inr || '50.00';
            btnPayText.textContent = `Pay ₹${feeStr} via Razorpay (Test Mode)`;
            btnPayRazorpay.disabled = false;
            if (paySpinner) paySpinner.classList.add('hidden');
            isPaying = false;
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (resp) {
        const desc = resp.error ? (resp.error.description || resp.error.reason || 'Payment failed or was cancelled.') : 'Payment simulation failed.';
        if (paymentError) {
          paymentError.textContent = desc;
          paymentError.classList.remove('hidden');
        }
        const feeStr = razorpayConfig.facilitation_fee_inr || '50.00';
        btnPayText.textContent = `Retry Payment (₹${feeStr})`;
        btnPayRazorpay.disabled = false;
        if (paySpinner) paySpinner.classList.add('hidden');
        isPaying = false;
      });

      rzp.open();

    } catch (err) {
      console.error('Order creation error:', err);
      if (paymentError) {
        paymentError.textContent = 'Network error while contacting payment service.';
        paymentError.classList.remove('hidden');
      }
      const feeStr = (razorpayConfig && razorpayConfig.facilitation_fee_inr) || '50.00';
      btnPayText.textContent = `Pay ₹${feeStr} via Razorpay (Test Mode)`;
      btnPayRazorpay.disabled = false;
      if (paySpinner) paySpinner.classList.add('hidden');
      isPaying = false;
    }
  });
}

async function verifyPayment(response) {
  if (btnPayText) btnPayText.textContent = 'Verifying Payment…';

  try {
    const res = await fetch(`${API_BASE}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (paymentError) {
        paymentError.textContent = data.error || 'Server signature verification failed.';
        paymentError.classList.remove('hidden');
      }
      if (btnPayRazorpay) {
        btnPayRazorpay.classList.remove('hidden');
        btnPayRazorpay.disabled = false;
      }
      if (btnPayText) btnPayText.textContent = 'Retry Payment';
      showToast('Payment verification failed on server.', 'error');
      return;
    }

    // Success! Show verified payment receipt
    if (paymentSuccessCard) paymentSuccessCard.classList.remove('hidden');
    if (paymentError) paymentError.classList.add('hidden');
    if (successPaymentId) successPaymentId.textContent = data.payment_id;
    if (successOrderId) successOrderId.textContent = data.order_id;
    if (successTimestamp) successTimestamp.textContent = new Date(data.verified_at).toLocaleString();

    if (btnPayRazorpay) btnPayRazorpay.classList.add('hidden');
    showToast('Payment verified successfully in test mode!', 'success');

    // Refresh recovery status
    await refreshListingStatus();
  } catch (err) {
    console.error('Verification error:', err);
    if (paymentError) {
      paymentError.textContent = 'Network error while verifying test payment.';
      paymentError.classList.remove('hidden');
    }
    if (btnPayRazorpay) {
      btnPayRazorpay.classList.remove('hidden');
      btnPayRazorpay.disabled = false;
    }
    if (btnPayText) btnPayText.textContent = 'Retry Payment';
  } finally {
    isPaying = false;
    if (paySpinner) paySpinner.classList.add('hidden');
  }
}

// =============================================
// PHASE 7: HONEST PHYSICAL RECOVERY LIFECYCLE
// =============================================

async function refreshListingStatus() {
  if (!currentListing) return;
  try {
    const res = await fetch(`${API_BASE}/api/payments/status/${currentListing.id}`);
    const data = await res.json();
    if (res.ok) {
      renderRecoveryUI(data.recovery_status, data.recovery_history);
    }
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

function renderRecoveryUI(status, history) {
  const steps = ['LISTED', 'MATCHED', 'COLLECTION_CONFIRMED', 'RECOVERY_CONFIRMED'];
  const currentIndex = steps.indexOf(status);

  const stepEls = [stepListed, stepMatched, stepCollection, stepRecovery];
  const connEls = [conn1, conn2, conn3];

  stepEls.forEach((el, idx) => {
    if (!el) return;
    el.classList.remove('step-completed', 'step-active');
    if (idx < currentIndex) {
      el.classList.add('step-completed');
    } else if (idx === currentIndex) {
      el.classList.add('step-completed');
    }
  });

  connEls.forEach((el, idx) => {
    if (!el) return;
    if (idx < currentIndex) {
      el.classList.add('conn-active');
    } else {
      el.classList.remove('conn-active');
    }
  });

  if (btnAdvanceCollection) {
    btnAdvanceCollection.disabled = (currentIndex >= 2);
  }
  if (btnAdvanceRecovery) {
    btnAdvanceRecovery.disabled = (currentIndex < 2 || currentIndex >= 3);
  }

  if (auditList && Array.isArray(history)) {
    auditList.innerHTML = history.map(h => `
      <li class="audit-item">
        <span class="audit-meta">${escapeHtml(new Date(h.timestamp).toLocaleTimeString())} — ${escapeHtml(h.verified_by)}</span>
        <span class="audit-note"><strong>${escapeHtml(h.status)}:</strong> ${escapeHtml(h.note)}</span>
      </li>
    `).join('');
  }
}

if (btnAdvanceCollection) {
  btnAdvanceCollection.addEventListener('click', async () => {
    if (!currentListing) return;
    try {
      const res = await fetch(`${API_BASE}/api/listings/${currentListing.id}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'COLLECTION_CONFIRMED',
          note: 'Physical pickup confirmed on-site. Batch collected by logistics carrier.',
          verified_by: 'Logistics Fleet Driver (Demo)'
        })
      });
      const data = await res.json();
      if (res.ok) {
        renderRecoveryUI(data.recovery_status, data.recovery_history);
        showToast('Physical collection confirmed (demo)!', 'success');
      }
    } catch (err) {
      showToast('Failed to update collection status.', 'error');
    }
  });
}

if (btnAdvanceRecovery) {
  btnAdvanceRecovery.addEventListener('click', async () => {
    if (!currentListing) return;
    try {
      const res = await fetch(`${API_BASE}/api/listings/${currentListing.id}/recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'RECOVERY_CONFIRMED',
          note: 'PET bottles weighed at facility, shredded, washed, and accepted into circular flaking stream.',
          verified_by: 'Recycling Facility Manager (Demo)'
        })
      });
      const data = await res.json();
      if (res.ok) {
        renderRecoveryUI(data.recovery_status, data.recovery_history);
        showToast('Material recovery confirmed by facility!', 'success');
      }
    } catch (err) {
      showToast('Failed to update recovery status.', 'error');
    }
  });
}

// =============================================
// BACKEND HEALTH CHECK & BOOTSTRAP
// =============================================
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    if (data.status === 'ok') {
      console.log('✅ Backend health check passed:', data);
    } else {
      console.warn('⚠️ Backend returned unexpected status:', data);
    }
  } catch (err) {
    console.warn('⚠️ Backend not reachable:', err.message);
  }
}

checkHealth();

// =============================================
// PHASE 10: AUTHENTICATION STATE & SESSION
// =============================================
let currentUser = null;
const authGuestControls = document.getElementById('auth-guest-controls');
const authUserControls = document.getElementById('auth-user-controls');
const navUserName = document.getElementById('nav-user-name');
const btnNavLogout = document.getElementById('btn-nav-logout');
const listingAuthCallout = document.getElementById('listing-auth-callout');

async function checkAuthState() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        renderAuthState();
        return;
      }
    }
  } catch (err) {
    console.warn('Auth check failed:', err.message);
  }
  currentUser = null;
  renderAuthState();
}

function renderAuthState() {
  if (currentUser) {
    if (authGuestControls) authGuestControls.classList.add('hidden');
    if (authUserControls) authUserControls.classList.remove('hidden');
    if (navUserName) navUserName.textContent = currentUser.name || currentUser.email;

    const navRoleBadge = document.getElementById('nav-role-badge');
    if (navRoleBadge) {
      const role = currentUser.role || 'SELLER';
      navRoleBadge.textContent = role;
      navRoleBadge.className = role === 'BUYER' ? 'badge badge-sm badge-role-buyer' : 'badge badge-sm badge-role-seller';
    }

    if (listingAuthCallout) {
      listingAuthCallout.className = 'listing-auth-callout listing-auth-callout-authed';
      listingAuthCallout.innerHTML = `
        <span class="callout-icon">👤</span>
        <span>Signed in as <strong>${escapeHtml(currentUser.name)}</strong> (${escapeHtml(currentUser.email)}) [${escapeHtml(currentUser.role || 'SELLER')}]. Listing will be saved to your private account.</span>
      `;
    }

    // Trigger dashboard and unread counters
    pollUnreadCounts();
    if (currentUser.role === 'BUYER') {
      loadBuyerDashboard();
    } else {
      loadSellerDashboard();
    }
  } else {
    if (authGuestControls) authGuestControls.classList.remove('hidden');
    if (authUserControls) authUserControls.classList.add('hidden');

    const sellerDashboardPanel = document.getElementById('seller-dashboard-panel');
    const buyerDashboardPanel = document.getElementById('buyer-dashboard-panel');
    if (sellerDashboardPanel) sellerDashboardPanel.classList.add('hidden');
    if (buyerDashboardPanel) buyerDashboardPanel.classList.add('hidden');

    if (listingAuthCallout) {
      listingAuthCallout.className = 'listing-auth-callout listing-auth-callout-guest';
      listingAuthCallout.innerHTML = `
        <span class="callout-icon">ℹ️</span>
        <span>You are listing in <strong>Demo Mode</strong>. <a href="/login.html">Sign in</a> to save private listings to your personal account.</span>
      `;
    }
  }
}

async function handleLogout() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin'
    });
    if (res.ok) {
      currentUser = null;
      renderAuthState();
      showToast('Logged out successfully.', 'info');
      showForm();
    }
  } catch (err) {
    console.error('Logout error:', err);
    showToast('Failed to log out cleanly.', 'error');
  }
}

if (btnNavLogout) {
  btnNavLogout.addEventListener('click', handleLogout);
}

checkAuthState();
loadGoogleMapsApi();
loadRazorpayConfig();

// =============================================
// PHASE 9: PET PRICE INTELLIGENCE LOGIC
// =============================================

const priceHubSelect       = document.getElementById('price-hub-select');
const customPincodeGroup   = document.getElementById('custom-pincode-group');
const priceCustomInput     = document.getElementById('price-custom-input');
const priceGradeSelect     = document.getElementById('price-grade-select');
const btnRefreshPrice      = document.getElementById('btn-refresh-price');
const priceRefreshIcon     = document.getElementById('price-refresh-icon');
const priceRefreshText     = document.getElementById('price-refresh-text');
const priceFallbackBanner  = document.getElementById('price-fallback-banner');
const priceFallbackText    = document.getElementById('price-fallback-text');
const priceTierSub         = document.getElementById('price-tier-sub');
const priceSourceTypeData  = document.getElementById('price-source-type-data');
const priceAdjustmentData  = document.getElementById('price-adjustment-data');
const priceTimestampData   = document.getElementById('price-timestamp-data');

async function fetchPriceEstimate(options = {}) {
  if (isEstimatingPrice || !currentListing) return;

  isEstimatingPrice = true;
  if (btnEstimatePrice) btnEstimatePrice.disabled = true;
  if (btnRefreshPrice) btnRefreshPrice.disabled = true;
  if (priceSpinner) priceSpinner.classList.remove('hidden');
  if (btnEstimatePriceText) btnEstimatePriceText.textContent = 'Estimating…';
  if (priceRefreshText) priceRefreshText.textContent = 'Refreshing…';

  try {
    const selectedHub = priceHubSelect ? priceHubSelect.value : '';
    const customLoc = priceCustomInput ? priceCustomInput.value.trim() : '';
    const selectedGrade = priceGradeSelect ? priceGradeSelect.value : '';

    const payload = {
      listing_id: currentListing.id,
      live: options.live === true
    };

    if (selectedHub === 'custom' && customLoc) {
      payload.locality = customLoc;
      payload.city = customLoc;
    } else if (selectedHub && selectedHub !== 'custom') {
      payload.locality = selectedHub;
      payload.city = selectedHub;
    }

    if (selectedGrade) {
      payload.grade = selectedGrade;
    }

    const res = await fetch(`${API_BASE}/api/prices/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to estimate scrap price.', 'error');
      return;
    }

    currentPriceEstimate = data;
    renderPriceIntelligence(data);

    if (pricePanel) {
      pricePanel.classList.remove('hidden');
      pricePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (data.status === 'ESTIMATE_AVAILABLE') {
      const modeLabel = data.data_quality && data.data_quality.is_live ? 'Live quote' : 'Benchmark';
      showToast(`PET Price Intelligence updated (${modeLabel})`, 'success');
    } else {
      showToast('No local benchmark available for this region.', 'warning');
    }

  } catch (err) {
    console.error('Price estimation error:', err);
    showToast('Could not reach price intelligence service.', 'error');
  } finally {
    isEstimatingPrice = false;
    if (btnEstimatePrice) btnEstimatePrice.disabled = false;
    if (btnRefreshPrice) btnRefreshPrice.disabled = false;
    if (priceSpinner) priceSpinner.classList.add('hidden');
    if (btnEstimatePriceText) btnEstimatePriceText.textContent = 'Estimate PET Scrap Value';
    if (priceRefreshText) priceRefreshText.textContent = 'Refresh Live Rate';
  }
}

function renderPriceIntelligence(data) {
  if (!pricePanel) return;

  if (data.status === 'PRICE_DATA_UNAVAILABLE') {
    if (priceCard) priceCard.classList.add('hidden');
    if (priceUnavailableCard) {
      priceUnavailableCard.classList.remove('hidden');
      if (priceUnavailableMsg && data.message) {
        priceUnavailableMsg.textContent = data.message;
      }
    }
    if (priceTransparencyBadge) {
      priceTransparencyBadge.textContent = 'NO PRICE DATA';
      priceTransparencyBadge.className = 'badge badge-test';
    }
    if (priceFallbackBanner) priceFallbackBanner.classList.add('hidden');
    return;
  }

  // Available estimate
  if (priceCard) priceCard.classList.remove('hidden');
  if (priceUnavailableCard) priceUnavailableCard.classList.add('hidden');

  // Transparency badge
  if (priceTransparencyBadge && data.data_quality) {
    const mode = data.data_quality.mode || 'DEMO';
    const freshness = data.data_quality.freshness || 'RECENT';
    let badgeLabel = 'IMPORTED DATA';
    let badgeClass = 'badge badge-test';

    if (data.data_quality.is_live) {
      badgeLabel = 'LIVE RECYCLER QUOTE';
      badgeClass = 'badge badge-honest';
    } else if (mode === 'DEMO') {
      badgeLabel = 'DEMO BENCHMARK';
      badgeClass = 'badge badge-test';
    } else if (freshness === 'STALE') {
      badgeLabel = 'STALE DATA';
      badgeClass = 'badge badge-test';
    } else {
      badgeLabel = 'IMPORTED BENCHMARK';
      badgeClass = 'badge badge-test';
    }
    priceTransparencyBadge.textContent = badgeLabel;
    priceTransparencyBadge.className = badgeClass;
  }

  // Fallback notice banner
  if (priceFallbackBanner) {
    const isFallbackActive = data.isFallback || data.is_fallback;
    if (isFallbackActive) {
      priceFallbackBanner.classList.remove('hidden');
      if (priceFallbackText) {
        const scope = (data.geographic_coverage && data.geographic_coverage.label) || 'Regional/National';
        priceFallbackText.textContent = `City-specific quotes unavailable for this location. Showing ${scope} indicative benchmark.`;
      }
    } else {
      priceFallbackBanner.classList.add('hidden');
    }
  }

  // Prices
  if (pricePerKgVal && data.price_per_kg) {
    pricePerKgVal.textContent = `₹${data.price_per_kg.min.toFixed(2)} – ₹${data.price_per_kg.max.toFixed(2)}`;
  }
  if (priceTotalVal && data.estimated_value) {
    priceTotalVal.textContent = `₹${data.estimated_value.min.toFixed(2)} – ₹${data.estimated_value.max.toFixed(2)}`;
  }
  if (priceQtySub) {
    priceQtySub.textContent = `For ${data.quantity_kg} kg batch`;
  }
  if (priceTierSub && data.source) {
    priceTierSub.textContent = data.source.type ? data.source.type.replace(/_/g, ' ') : 'Scrap benchmark';
  }

  // Calculation explanation
  if (priceCalcExplanation && data.price_per_kg && data.estimated_value) {
    priceCalcExplanation.textContent = `${data.quantity_kg} kg × ₹${data.price_per_kg.min.toFixed(2)}–₹${data.price_per_kg.max.toFixed(2)}/kg = estimated ₹${data.estimated_value.min.toFixed(2)}–₹${data.estimated_value.max.toFixed(2)}`;
  }

  // Details
  if (priceGradeData) {
    priceGradeData.textContent = `${data.grade || 'Post-consumer clear PET bottles'} (${data.material_form || 'loose'})`;
  }
  if (priceCoverageData && data.geographic_coverage) {
    priceCoverageData.textContent = `${data.geographic_coverage.label} (${data.geographic_coverage.city || data.geographic_coverage.state || 'India'})`;
  }
  if (priceFreshnessData && data.data_quality) {
    const age = typeof data.data_quality.age_days === 'number' ? ` (${data.data_quality.age_days}d ago)` : '';
    priceFreshnessData.textContent = `${data.data_quality.freshness}${age}`;
  }
  if (priceSourceData && data.data_quality) {
    priceSourceData.textContent = data.data_quality.source_name || 'Benchmark Database';
  }
  if (priceSourceTypeData && data.data_quality) {
    const sType = data.source ? data.source.type : data.data_quality.source_type;
    const sScope = data.source ? data.source.geographicScope : 'LOCAL';
    priceSourceTypeData.textContent = `${sType ? sType.replace(/_/g, ' ') : 'BENCHMARK'} (${sScope})`;
  }
  if (priceAdjustmentData) {
    if (data.qualityAdjustment && data.qualityAdjustment.applied) {
      priceAdjustmentData.textContent = `${data.qualityAdjustment.reason} (${data.qualityAdjustment.factor}x)`;
    } else {
      priceAdjustmentData.textContent = 'Baseline (1.0x factor)';
    }
  }
  if (priceTimestampData && data.data_quality) {
    const obs = data.data_quality.observed_at ? new Date(data.data_quality.observed_at).toLocaleDateString() : 'N/A';
    const ret = data.data_quality.retrieved_at ? new Date(data.data_quality.retrieved_at).toLocaleTimeString() : 'N/A';
    priceTimestampData.textContent = `Observed: ${obs} | Retrieved: ${ret}`;
  }

  // Warnings
  if (priceWarningsList && Array.isArray(data.warnings)) {
    priceWarningsList.innerHTML = data.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  }
}

if (btnEstimatePrice) {
  btnEstimatePrice.addEventListener('click', () => fetchPriceEstimate());
}

if (btnRefreshPrice) {
  btnRefreshPrice.addEventListener('click', () => fetchPriceEstimate({ live: true }));
}

if (priceHubSelect) {
  priceHubSelect.addEventListener('change', () => {
    if (priceHubSelect.value === 'custom') {
      if (customPincodeGroup) customPincodeGroup.classList.remove('hidden');
    } else {
      if (customPincodeGroup) customPincodeGroup.classList.add('hidden');
      fetchPriceEstimate();
    }
  });
}

if (priceCustomInput) {
  priceCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchPriceEstimate();
    }
  });
}

if (priceGradeSelect) {
  priceGradeSelect.addEventListener('change', () => {
    fetchPriceEstimate();
  });
}

// =============================================
// PHASE 11: ECOPROOF LOOP TRACEABILITY (Evidence & Audit)
// =============================================

let currentBatch = null;

// DOM references for EcoProof
const btnGotoEcoproof        = document.getElementById('btn-goto-ecoproof');
const ecoproofPanel          = document.getElementById('ecoproof-panel');
const ecoproofInitCard       = document.getElementById('ecoproof-init-card');
const btnInitBatch           = document.getElementById('btn-init-batch');
const ecoproofActiveCard     = document.getElementById('ecoproof-active-card');
const batchCodeVal           = document.getElementById('batch-code-val');
const batchMaterialVal       = document.getElementById('batch-material-val');
const batchStatusVal         = document.getElementById('batch-status-val');
const batchQtyVal            = document.getElementById('batch-qty-val');
const batchChainVal          = document.getElementById('batch-chain-val');
const ecoproofScoreNum       = document.getElementById('ecoproof-score-num');
const ecoproofScoreBar       = document.getElementById('ecoproof-score-bar');
const milestonesList         = document.getElementById('milestones-list');
const evidenceUploadForm     = document.getElementById('evidence-upload-form');
const evidenceCategorySelect = document.getElementById('evidence-category-select');
const evidenceFileInput      = document.getElementById('evidence-file-input');
const evidenceNotesInput     = document.getElementById('evidence-notes-input');
const btnSubmitEvidence      = document.getElementById('btn-submit-evidence');
const evidenceSpinner        = document.getElementById('evidence-spinner');
const uploadFeedback         = document.getElementById('upload-feedback');
const inputCollWeight        = document.getElementById('input-coll-weight');
const btnSaveCollWeight      = document.getElementById('btn-save-coll-weight');
const inputRecvWeight        = document.getElementById('input-recv-weight');
const btnSaveRecvWeight      = document.getElementById('btn-save-recv-weight');
const discrepancyBadge       = document.getElementById('discrepancy-badge');
const discrepancyDetails     = document.getElementById('discrepancy-details');
const batchQrImg             = document.getElementById('batch-qr-img');
const qrPlaceholder          = document.getElementById('qr-placeholder');
const batchPublicLink        = document.getElementById('batch-public-link');
const btnCopyTraceUrl        = document.getElementById('btn-copy-trace-url');
const copySuccessMsg         = document.getElementById('copy-success-msg');
const chainIntegrityStatus   = document.getElementById('chain-integrity-status');
const ecoproofEventList      = document.getElementById('ecoproof-event-list');

async function openEcoProofPanel() {
  if (!currentListing) {
    showToast('Please create or confirm a PET listing first.', 'warning');
    return;
  }

  if (ecoproofPanel) {
    ecoproofPanel.classList.remove('hidden');
    ecoproofPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // Attempt to load existing batch or present init button
  try {
    const res = await fetch(`${API_BASE}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ listing_id: currentListing.id })
    });
    const data = await res.json();
    if (res.ok && data.batch) {
      currentBatch = data.batch;
      showActiveBatch();
      await refreshBatchData();
    } else {
      showInitBatchCard();
    }
  } catch (err) {
    console.warn('Batch check error:', err);
    showInitBatchCard();
  }
}

function showInitBatchCard() {
  if (ecoproofInitCard) ecoproofInitCard.classList.remove('hidden');
  if (ecoproofActiveCard) ecoproofActiveCard.classList.add('hidden');
}

function showActiveBatch() {
  if (ecoproofInitCard) ecoproofInitCard.classList.add('hidden');
  if (ecoproofActiveCard) ecoproofActiveCard.classList.remove('hidden');
}

async function initRecoveryBatch() {
  if (!currentListing) return;
  try {
    const res = await fetch(`${API_BASE}/api/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ listing_id: currentListing.id })
    });
    const data = await res.json();
    if (res.ok && data.batch) {
      currentBatch = data.batch;
      showActiveBatch();
      showToast('EcoProof traceability batch initialized!', 'success');
      await refreshBatchData();
    } else {
      showToast(data.error || 'Failed to initialize batch.', 'error');
    }
  } catch (err) {
    console.error('Batch initialization error:', err);
    showToast('Network error initializing batch.', 'error');
  }
}

async function refreshBatchData() {
  if (!currentBatch) return;

  try {
    const res = await fetch(`${API_BASE}/api/batches/${currentBatch.id}`, {
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('Failed to load batch data:', data);
      return;
    }

    currentBatch = data.batch;

    // Render metadata
    if (batchCodeVal) batchCodeVal.textContent = currentBatch.batch_code;
    if (batchMaterialVal) batchMaterialVal.textContent = currentBatch.material;
    if (batchStatusVal) batchStatusVal.textContent = currentBatch.status;
    if (batchQtyVal) batchQtyVal.textContent = `${currentBatch.declared_quantity_kg} kg`;
    if (batchChainVal) {
      batchChainVal.textContent = data.audit_chain_valid ? '🔒 Intact' : '⚠️ Tampered';
      batchChainVal.className = data.audit_chain_valid ? 'badge badge-secure' : 'badge badge-danger';
    }

    // Render Score
    if (data.evidence_score) {
      const score = data.evidence_score.totalScore || 0;
      if (ecoproofScoreNum) ecoproofScoreNum.textContent = `${score}%`;
      if (ecoproofScoreBar) ecoproofScoreBar.style.width = `${score}%`;

      // Render milestones list
      if (milestonesList && Array.isArray(data.evidence_score.breakdown)) {
        milestonesList.innerHTML = data.evidence_score.breakdown.map(m => {
          const catEvidence = (data.evidence || []).filter(e => e.category === m.category);
          const hasFile = catEvidence.length > 0;
          const hashPreview = hasFile ? `SHA-256: ${escapeHtml(catEvidence[0].sha256_hash.substring(0, 12))}...` : '';

          return `
            <div class="milestone-item">
              <div class="milestone-item-row">
                <span class="milestone-name">${escapeHtml(m.label)}</span>
                <span class="milestone-badge status-${escapeHtml(m.status)}">${escapeHtml(m.status)} (${m.awardedPoints}/${m.maxPoints} pts)</span>
              </div>
              <div class="milestone-meta">
                ${m.explanation ? `<span>${escapeHtml(m.explanation)}</span>` : ''}
                ${hashPreview ? ` • <code>${hashPreview}</code>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Render Weights & Discrepancy
    if (inputCollWeight) inputCollWeight.value = currentBatch.collection_weight_kg || '';
    if (inputRecvWeight) inputRecvWeight.value = currentBatch.receiving_weight_kg || '';

    if (data.weight_discrepancy) {
      const disc = data.weight_discrepancy;
      if (discrepancyBadge) {
        if (disc.status === 'FLAGGED') {
          discrepancyBadge.className = 'badge status-FLAGGED';
          discrepancyBadge.textContent = `FLAGGED (Variance ${disc.discrepancyPercent}%)`;
        } else if (disc.status === 'ACCEPTABLE') {
          discrepancyBadge.className = 'badge status-REVIEWED';
          discrepancyBadge.textContent = `ACCEPTABLE (Variance ${disc.discrepancyPercent}%)`;
        } else {
          discrepancyBadge.className = 'badge status-NOT_YET_DUE';
          discrepancyBadge.textContent = disc.status;
        }
      }
      if (discrepancyDetails) {
        discrepancyDetails.textContent = disc.message;
      }
    }

    // Fetch and render QR code & public URL
    try {
      const qrRes = await fetch(`${API_BASE}/api/batches/${currentBatch.id}/qr`, {
        credentials: 'same-origin'
      });
      const qrData = await qrRes.json();
      if (qrRes.ok && qrData.qr_data_url) {
        if (batchQrImg) {
          batchQrImg.src = qrData.qr_data_url;
          batchQrImg.classList.remove('hidden');
        }
        if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
        if (batchPublicLink) {
          batchPublicLink.href = qrData.trace_url;
          batchPublicLink.textContent = qrData.trace_url;
        }
      }
    } catch (_qrErr) {
      console.warn('QR fetch error:', _qrErr);
    }

    // Fetch and render timeline
    try {
      const timeRes = await fetch(`${API_BASE}/api/batches/${currentBatch.id}/timeline`, {
        credentials: 'same-origin'
      });
      const timeData = await timeRes.json();
      if (timeRes.ok && Array.isArray(timeData.events)) {
        if (chainIntegrityStatus) {
          chainIntegrityStatus.textContent = timeData.audit_chain_valid
            ? 'Verification: Cryptographic SHA-256 hash chain is valid and verified intact.'
            : '⚠️ Warning: Audit chain integrity validation failed!';
          chainIntegrityStatus.style.color = timeData.audit_chain_valid ? '#34d399' : '#f87171';
        }
        if (ecoproofEventList) {
          ecoproofEventList.innerHTML = timeData.events.slice().reverse().map(ev => `
            <li class="ecoproof-event-item">
              <div class="event-header-row">
                <span class="event-type-badge">${escapeHtml(ev.event_type)}</span>
                <span class="event-timestamp">${escapeHtml(new Date(ev.created_at).toLocaleString())}</span>
              </div>
              <div class="event-expl">${escapeHtml(ev.explanation || '')} (${escapeHtml(ev.actor_id)})</div>
              <div class="event-hash">Hash: ${escapeHtml(ev.event_hash.substring(0, 16))}... | Prev: ${escapeHtml(ev.previous_hash.substring(0, 16))}...</div>
            </li>
          `).join('');
        }
      }
    } catch (_timeErr) {
      console.warn('Timeline fetch error:', _timeErr);
    }

  } catch (err) {
    console.error('Error refreshing batch data:', err);
  }
}

async function uploadMilestoneEvidence(e) {
  e.preventDefault();
  if (!currentBatch) {
    showToast('No active batch found.', 'error');
    return;
  }

  const file = evidenceFileInput?.files[0];
  if (!file) {
    showToast('Please select an evidence image file (JPEG, PNG, WebP).', 'warning');
    return;
  }

  const category = evidenceCategorySelect?.value;
  const notes = evidenceNotesInput?.value || '';

  const formData = new FormData();
  formData.append('evidence_file', file);
  formData.append('category', category);
  formData.append('notes', notes);

  if (evidenceSpinner) evidenceSpinner.classList.remove('hidden');
  if (btnSubmitEvidence) btnSubmitEvidence.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/batches/${currentBatch.id}/evidence`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Milestone evidence uploaded & hash-chained!', 'success');
      if (evidenceFileInput) evidenceFileInput.value = '';
      if (evidenceNotesInput) evidenceNotesInput.value = '';
      await refreshBatchData();
    } else {
      showToast(data.error || 'Failed to upload evidence.', 'error');
    }
  } catch (err) {
    console.error('Evidence upload error:', err);
    showToast('Network error uploading evidence.', 'error');
  } finally {
    if (evidenceSpinner) evidenceSpinner.classList.add('hidden');
    if (btnSubmitEvidence) btnSubmitEvidence.disabled = false;
  }
}

async function saveCollectionWeight() {
  if (!currentBatch) return;
  const val = parseFloat(inputCollWeight?.value);
  if (!Number.isFinite(val) || val <= 0) {
    showToast('Please enter a valid weight in kg (> 0).', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/batches/${currentBatch.id}/collection-weight`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ weight_kg: val })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Collection weight recorded!', 'success');
      await refreshBatchData();
    } else {
      showToast(data.error || 'Failed to record weight.', 'error');
    }
  } catch (err) {
    console.error('Weight update error:', err);
    showToast('Network error updating weight.', 'error');
  }
}

async function saveReceivingWeight() {
  if (!currentBatch) return;
  const val = parseFloat(inputRecvWeight?.value);
  if (!Number.isFinite(val) || val <= 0) {
    showToast('Please enter a valid weight in kg (> 0).', 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/batches/${currentBatch.id}/receiving-weight`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ weight_kg: val })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Receiving weight recorded!', 'success');
      await refreshBatchData();
    } else {
      showToast(data.error || 'Failed to record weight.', 'error');
    }
  } catch (err) {
    console.error('Weight update error:', err);
    showToast('Network error updating weight.', 'error');
  }
}

function copyTraceLink() {
  if (!batchPublicLink || !batchPublicLink.href || batchPublicLink.href === '#') return;
  navigator.clipboard.writeText(batchPublicLink.href).then(() => {
    if (copySuccessMsg) {
      copySuccessMsg.classList.remove('hidden');
      setTimeout(() => copySuccessMsg.classList.add('hidden'), 2000);
    }
  }).catch(() => {
    showToast('Failed to copy link.', 'error');
  });
}

// Event bindings
if (btnGotoEcoproof) {
  btnGotoEcoproof.addEventListener('click', openEcoProofPanel);
}
if (btnInitBatch) {
  btnInitBatch.addEventListener('click', initRecoveryBatch);
}
if (evidenceUploadForm) {
  evidenceUploadForm.addEventListener('submit', uploadMilestoneEvidence);
}
if (btnSaveCollWeight) {
  btnSaveCollWeight.addEventListener('click', saveCollectionWeight);
}
if (btnSaveRecvWeight) {
  btnSaveRecvWeight.addEventListener('click', saveReceivingWeight);
}
if (btnCopyTraceUrl) {
  btnCopyTraceUrl.addEventListener('click', copyTraceLink);
}

// =============================================
// NAVIGATION & MOBILE DRAWER INTERACTIONS
// =============================================
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileDrawer  = document.getElementById('mobile-drawer');

if (mobileMenuBtn && mobileDrawer) {
  mobileMenuBtn.addEventListener('click', () => {
    const isOpen = mobileDrawer.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
  });

  mobileDrawer.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

const navPriceLink = document.getElementById('nav-price-link');
if (navPriceLink) {
  navPriceLink.addEventListener('click', (e) => {
    if (pricePanel && !pricePanel.classList.contains('hidden')) {
      pricePanel.scrollIntoView({ behavior: 'smooth' });
    } else {
      const target = document.getElementById('submit-waste');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

const navMatchLink = document.getElementById('nav-match-link');
if (navMatchLink) {
  navMatchLink.addEventListener('click', (e) => {
    if (matchPanel && !matchPanel.classList.contains('hidden')) {
      matchPanel.scrollIntoView({ behavior: 'smooth' });
    } else {
      const target = document.getElementById('submit-waste');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

const navEcoproofLink = document.getElementById('nav-ecoproof-link');
if (navEcoproofLink) {
  navEcoproofLink.addEventListener('click', (e) => {
    if (currentListing) {
      openEcoProofPanel();
    } else {
      const target = document.getElementById('submit-waste');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
      showToast('Submit or select a PET listing to track in EcoProof.', 'info');
    }
  });
}

if (navPayLink) {
  navPayLink.addEventListener('click', (e) => {
    e.preventDefault();
    openPaymentPanel();
  });
}

if (mobileNavPay) {
  mobileNavPay.addEventListener('click', (e) => {
    e.preventDefault();
    if (mobileDrawer) mobileDrawer.classList.remove('open');
    if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
    openPaymentPanel();
  });
}

if (btnGotoPayment) {
  btnGotoPayment.addEventListener('click', openPaymentPanel);
}

if (btnPrereqStart) {
  btnPrereqStart.addEventListener('click', (e) => {
    const target = document.getElementById('submit-waste');
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
}

// =============================================
// HERO CTA SMOOTH SCROLL (ACCESSIBLE / REDUCED-MOTION AWARE)
// =============================================
const heroCta = document.getElementById('hero-cta');
const heroSecondaryCta = document.getElementById('hero-secondary-cta');

if (heroCta) {
  heroCta.addEventListener('click', (e) => {
    const target = document.getElementById('submit-waste');
    if (target) {
      e.preventDefault();
      const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      if (history.pushState) history.pushState(null, '', '#submit-waste');
    }
  });
}

if (heroSecondaryCta) {
  heroSecondaryCta.addEventListener('click', (e) => {
    const target = document.getElementById('how-it-works');
    if (target) {
      e.preventDefault();
      const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      if (history.pushState) history.pushState(null, '', '#how-it-works');
    }
  });
}


// =============================================
// FEATURE 4: IN-CARD TRANSPORT FEASIBILITY CHECKER
// =============================================
async function checkBuyerTransportFeasibility(buyer) {
  const boxId = `transport-box-${CSS.escape(buyer.buyer_id)}`;
  const transportBox = document.getElementById(`transport-box-${buyer.buyer_id}`);
  if (!transportBox) return;

  if (!transportBox.classList.contains('hidden') && transportBox.dataset.loaded === 'true') {
    transportBox.classList.add('hidden');
    return;
  }

  transportBox.classList.remove('hidden');
  transportBox.innerHTML = `
    <div style="padding: 0.5rem; text-align: center; font-size: 0.78rem; color: #64748b;">
      <span class="spinner" style="display:inline-block; width:14px; height:14px; margin-right:4px;"></span>
      Evaluating freight logistics model…
    </div>
  `;

  try {
    const payload = {
      buyer_id: buyer.buyer_id,
      listing_id: currentListing ? currentListing.id : null,
      locality: currentListing ? currentListing.locality : (currentAnalysis ? currentAnalysis.user_locality : 'Central City')
    };

    if (currentListing && currentListing.location && currentListing.location.latitude && currentListing.location.longitude) {
      payload.pickup_lat = currentListing.location.latitude;
      payload.pickup_lng = currentListing.location.longitude;
    }

    const res = await fetch(`${API_BASE}/api/transport/feasibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      transportBox.innerHTML = `<div class="text-danger" style="font-size:0.75rem; padding:0.5rem;">${escapeHtml(data.error || 'Feasibility check failed.')}</div>`;
      return;
    }

    const statusKey = (data.status || 'FEASIBLE').toLowerCase().replace(/_/g, '-');
    const badgeClass = statusKey.includes('not') ? 'not-feasible' : (statusKey.includes('warning') ? 'warning' : 'feasible');
    const distTypeLabel = data.distance_type === 'STRAIGHT_LINE_ESTIMATE' ? 'Haversine Approx.' : 'Road Distance';

    transportBox.dataset.loaded = 'true';
    transportBox.innerHTML = `
      <div class="transport-header">
        <span class="transport-title">🚚 Logistics Feasibility Evaluation</span>
        <span class="transport-badge transport-badge-${badgeClass}">${escapeHtml(data.status)}</span>
      </div>
      <div class="transport-grid">
        <div class="transport-cell">
          <strong>Distance:</strong> ${data.distance_km} km <small class="text-muted">(${distTypeLabel})</small>
        </div>
        <div class="transport-cell">
          <strong>Est. Freight:</strong> ₹${Number(data.estimated_transport_cost).toFixed(2)}
        </div>
        <div class="transport-cell">
          <strong>Gross Value:</strong> ₹${Number(data.gross_material_value).toFixed(2)}
        </div>
        <div class="transport-cell">
          <strong>Est. Net Value:</strong> ₹${Number(data.estimated_net_value).toFixed(2)}
        </div>
      </div>
      <p class="transport-disclaimer-note">
        ⚠️ ${escapeHtml(data.disclaimer)}
      </p>
    `;
  } catch (err) {
    console.error('Transport feasibility error:', err);
    transportBox.innerHTML = '<div style="font-size:0.75rem; color:#ef4444;">Unable to reach transport service.</div>';
  }
}

// =============================================
// FEATURE 3: NEGOTIATION & COUNTEROFFER SYSTEM
// =============================================
let activeNegotiation = null;
let activeOffer = null;
let activeNegotiationBuyer = null;

const negModal = document.getElementById('negotiation-modal');
const btnCloseNegModal = document.getElementById('btn-close-negotiation-modal');
const negBuyerName = document.getElementById('neg-buyer-name');
const negListingId = document.getElementById('neg-listing-id');
const negQuantity = document.getElementById('neg-quantity');
const negStatusBadge = document.getElementById('neg-status-badge');
const negCurrentPrice = document.getElementById('neg-current-price');
const negTotalValue = document.getElementById('neg-total-value');
const negProposer = document.getElementById('neg-proposer');
const negOfferTime = document.getElementById('neg-offer-time');
const negOffersTimeline = document.getElementById('neg-offers-timeline');
const negCounterSection = document.getElementById('neg-counter-section');
const negCounterForm = document.getElementById('neg-counter-form');
const negCounterPrice = document.getElementById('neg-counter-price');
const negCounterMessage = document.getElementById('neg-counter-message');
const btnAcceptOffer = document.getElementById('btn-accept-offer');
const btnRejectOffer = document.getElementById('btn-reject-offer');
const btnWithdrawOffer = document.getElementById('btn-withdraw-offer');
const btnViewReceiptFromNeg = document.getElementById('btn-view-receipt-from-neg');

async function startBuyerNegotiation(buyer) {
  if (!currentListing) {
    showToast('Please create or select a PET listing first.', 'warning');
    return;
  }

  activeNegotiationBuyer = buyer;
  negModal.classList.remove('hidden');

  // Show loading in modal
  negBuyerName.textContent = buyer.buyer_name || 'Buyer';
  negListingId.textContent = currentListing.id;
  negQuantity.textContent = `${currentListing.quantity_kg} kg`;
  negStatusBadge.textContent = 'CONNECTING...';
  negOffersTimeline.innerHTML = '<div style="padding:1rem; text-align:center; color:#64748b;">Loading negotiation terms…</div>';

  try {
    const res = await fetch(`${API_BASE}/api/negotiations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      body: JSON.stringify({
        listing_id: currentListing.id,
        buyer_id: buyer.buyer_id,
        initial_price_per_kg: 16.50,
        message: 'Initial recovery terms proposal based on local PET scrap benchmark.'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to start negotiation.', 'error');
      negModal.classList.add('hidden');
      return;
    }

    renderNegotiationView(data.negotiation, data.current_offer, data.offers);
  } catch (err) {
    console.error('Start negotiation error:', err);
    showToast('Could not establish negotiation connection.', 'error');
    negModal.classList.add('hidden');
  }
}

function renderNegotiationView(neg, currentOff, offersList) {
  activeNegotiation = neg;
  activeOffer = currentOff;

  negBuyerName.textContent = (activeNegotiationBuyer ? activeNegotiationBuyer.buyer_name : neg.buyer_id);
  negListingId.textContent = neg.listing_id;
  negQuantity.textContent = `${currentListing ? currentListing.quantity_kg : '—'} kg`;

  // Status Badge
  negStatusBadge.textContent = neg.status;
  negStatusBadge.className = 'badge ' + (
    neg.status === 'ACCEPTED' ? 'badge-success' :
    neg.status === 'REJECTED' || neg.status === 'WITHDRAWN' ? 'badge-test' : 'badge-secure'
  );

  // Price & Total Values
  const price = currentOff ? Number(currentOff.proposed_price_per_kg) : 0;
  const qty = currentListing ? Number(currentListing.quantity_kg) : 1;
  const totalVal = currentOff && currentOff.total_amount ? Number(currentOff.total_amount) : (price * qty);

  negCurrentPrice.textContent = price.toFixed(2);
  negTotalValue.textContent = totalVal.toFixed(2);
  negProposer.textContent = currentOff ? (currentOff.proposer_role === 'SELLER' ? 'You (Seller)' : 'Recycling Buyer') : '—';
  negOfferTime.textContent = currentOff && currentOff.created_at ? new Date(currentOff.created_at).toLocaleTimeString() : '';

  // Render Timeline
  if (Array.isArray(offersList) && offersList.length > 0) {
    negOffersTimeline.innerHTML = offersList.map((off, idx) => {
      const isActive = off.id === (currentOff ? currentOff.id : null);
      const roleLabel = off.proposer_role === 'SELLER' ? '👤 Seller' : '🏭 Recycler';
      const timeStr = off.created_at ? new Date(off.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="neg-timeline-item ${isActive ? 'active-revision' : ''}">
          <div class="neg-tl-left">
            <span class="neg-tl-role">${roleLabel} (${escapeHtml(off.status)})</span>
            ${off.message ? `<span class="neg-tl-notes">"${escapeHtml(off.message)}"</span>` : ''}
          </div>
          <div class="neg-tl-right">
            <span class="neg-tl-price">₹${Number(off.proposed_price_per_kg).toFixed(2)}/kg</span>
            <span class="neg-tl-time">${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');
  } else {
    negOffersTimeline.innerHTML = '<div class="tag-empty">No offer history recorded.</div>';
  }

  // Action Button & Form Visibility State
  if (neg.status === 'ACCEPTED') {
    negCounterSection.classList.add('hidden');
    btnAcceptOffer.classList.add('hidden');
    btnRejectOffer.classList.add('hidden');
    btnWithdrawOffer.classList.add('hidden');
    btnViewReceiptFromNeg.classList.remove('hidden');
  } else if (neg.status === 'REJECTED' || neg.status === 'WITHDRAWN' || neg.status === 'EXPIRED') {
    negCounterSection.classList.add('hidden');
    btnAcceptOffer.classList.add('hidden');
    btnRejectOffer.classList.add('hidden');
    btnWithdrawOffer.classList.add('hidden');
    btnViewReceiptFromNeg.classList.add('hidden');
  } else {
    negCounterSection.classList.remove('hidden');
    btnAcceptOffer.classList.remove('hidden');
    btnRejectOffer.classList.remove('hidden');
    btnWithdrawOffer.classList.remove('hidden');
    btnViewReceiptFromNeg.classList.add('hidden');

    // Self-acceptance guard: user cannot accept offer they authored
    if (currentOff && currentOff.created_by && currentUser && currentOff.created_by === currentUser.id) {
      btnAcceptOffer.disabled = true;
      btnAcceptOffer.title = 'You cannot accept your own proposed offer. Awaiting buyer response.';
    } else {
      btnAcceptOffer.disabled = false;
      btnAcceptOffer.title = 'Accept this offer and generate official Digital Waste Transaction Receipt.';
    }
  }
}

if (btnCloseNegModal) {
  btnCloseNegModal.addEventListener('click', () => {
    negModal.classList.add('hidden');
  });
}

// Counteroffer Submit
if (negCounterForm) {
  negCounterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeNegotiation) return;

    const price = parseFloat(negCounterPrice.value);
    const message = negCounterMessage.value.trim();

    if (isNaN(price) || price <= 0) {
      showToast('Please enter a valid rate per kg.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/negotiations/${activeNegotiation.id}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        body: JSON.stringify({
          proposed_price_per_kg: price,
          message: message || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to submit counteroffer.', 'error');
        return;
      }

      negCounterPrice.value = '';
      negCounterMessage.value = '';
      showToast('Counteroffer transmitted successfully!', 'success');
      renderNegotiationView(data.negotiation, data.current_offer, data.offers);
    } catch (err) {
      console.error('Counteroffer error:', err);
      showToast('Could not submit counteroffer.', 'error');
    }
  });
}

// Accept Offer
if (btnAcceptOffer) {
  btnAcceptOffer.addEventListener('click', async () => {
    if (!activeOffer) return;

    try {
      const res = await fetch(`${API_BASE}/api/offers/${activeOffer.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        body: JSON.stringify({})
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not accept offer.', 'error');
        return;
      }

      showToast('Offer accepted! Digital Transaction Receipt minted.', 'success');
      renderNegotiationView(data.negotiation, data.current_offer, data.offers || []);

      if (data.receipt) {
        openReceiptModal(data.receipt);
      }
    } catch (err) {
      console.error('Accept error:', err);
      showToast('Failed to accept offer.', 'error');
    }
  });
}

// Reject Offer
if (btnRejectOffer) {
  btnRejectOffer.addEventListener('click', async () => {
    if (!activeOffer) return;

    try {
      const res = await fetch(`${API_BASE}/api/offers/${activeOffer.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Terms not commercially viable.' })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not reject offer.', 'error');
        return;
      }

      showToast('Offer rejected.', 'info');
      renderNegotiationView(data.negotiation, data.current_offer, data.offers || []);
    } catch (err) {
      console.error('Reject error:', err);
      showToast('Failed to reject offer.', 'error');
    }
  });
}

// Withdraw Offer
if (btnWithdrawOffer) {
  btnWithdrawOffer.addEventListener('click', async () => {
    if (!activeOffer) return;

    try {
      const res = await fetch(`${API_BASE}/api/offers/${activeOffer.id}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: 'Withdrawn by proposer.' })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not withdraw offer.', 'error');
        return;
      }

      showToast('Negotiation withdrawn.', 'info');
      renderNegotiationView(data.negotiation, data.current_offer, data.offers || []);
    } catch (err) {
      console.error('Withdraw error:', err);
      showToast('Failed to withdraw offer.', 'error');
    }
  });
}

// View Receipt from Negotiation
if (btnViewReceiptFromNeg) {
  btnViewReceiptFromNeg.addEventListener('click', async () => {
    if (!activeNegotiation) return;

    try {
      const res = await fetch(`${API_BASE}/api/negotiations/${activeNegotiation.id}/receipt`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Receipt not found.', 'error');
        return;
      }

      openReceiptModal(data.receipt);
    } catch (err) {
      console.error('Fetch receipt error:', err);
      showToast('Could not load transaction receipt.', 'error');
    }
  });
}

// =============================================
// FEATURE 5: DIGITAL WASTE TRANSACTION RECEIPT
// =============================================
let currentReceipt = null;

const rcpModal = document.getElementById('receipt-modal');
const btnCloseRcpModal = document.getElementById('btn-close-receipt-modal');
const btnDismissRcp = document.getElementById('btn-dismiss-receipt');
const btnPrintReceipt = document.getElementById('btn-print-receipt');
const btnVerifyReceiptLink = document.getElementById('btn-verify-receipt-link');

const rcpNumber = document.getElementById('rcp-number');
const rcpTxnId = document.getElementById('rcp-txn-id');
const rcpDate = document.getElementById('rcp-date');
const rcpSellerName = document.getElementById('rcp-seller-name');
const rcpSellerEmail = document.getElementById('rcp-seller-email');
const rcpSellerZone = document.getElementById('rcp-seller-zone');
const rcpBuyerName = document.getElementById('rcp-buyer-name');
const rcpBuyerFacility = document.getElementById('rcp-buyer-facility');
const rcpCondition = document.getElementById('rcp-condition');
const rcpQuantity = document.getElementById('rcp-quantity');
const rcpUnitPrice = document.getElementById('rcp-unit-price');
const rcpTotalValue = document.getElementById('rcp-total-value');
const rcpTransportAddress = document.getElementById('rcp-transport-address');
const rcpTransportDistance = document.getElementById('rcp-transport-distance');
const rcpDistanceType = document.getElementById('rcp-distance-type');
const rcpTransportCost = document.getElementById('rcp-transport-cost');
const rcpBatchCode = document.getElementById('rcp-batch-code');
const rcpDigest = document.getElementById('rcp-digest');

function openReceiptModal(receipt) {
  currentReceipt = receipt;
  if (!rcpModal) return;

  rcpNumber.textContent = receipt.receipt_number || 'RCP-2026-XXXX-XXXX';
  rcpTxnId.textContent = receipt.transaction_id || 'TXN-PET-2026-XXXX';
  rcpDate.textContent = receipt.created_at ? new Date(receipt.created_at).toLocaleString() : new Date().toLocaleString();

  // Seller info
  rcpSellerName.textContent = currentUser ? currentUser.name : 'Demo Waste Generator';
  rcpSellerEmail.textContent = currentUser ? currentUser.email : 'guest.collector@demo.ecocycle';
  rcpSellerZone.textContent = currentListing ? currentListing.locality : 'Central City';

  // Buyer info
  rcpBuyerName.textContent = receipt.buyer_name || (activeNegotiationBuyer ? activeNegotiationBuyer.buyer_name : receipt.buyer_id || 'Certified Recycler');
  rcpBuyerFacility.textContent = (receipt.transport && receipt.transport.buyer_facility) ? receipt.transport.buyer_facility : 'Regional Processing Hub';

  // Material & Values
  rcpCondition.textContent = receipt.condition || (currentListing ? currentListing.condition : 'Clean');
  rcpQuantity.textContent = receipt.quantity_kg ? Number(receipt.quantity_kg).toFixed(1) : (currentListing ? currentListing.quantity_kg : '0');
  rcpUnitPrice.textContent = receipt.agreed_price_per_kg ? Number(receipt.agreed_price_per_kg).toFixed(2) : '0.00';
  rcpTotalValue.textContent = receipt.total_amount ? Number(receipt.total_amount).toFixed(2) : '0.00';

  // Transport details
  if (receipt.transport) {
    rcpTransportAddress.textContent = receipt.transport.pickup_address || (currentListing && currentListing.locality ? currentListing.locality : 'Designated City Zone');
    rcpTransportDistance.textContent = receipt.transport.distance_km ? Number(receipt.transport.distance_km).toFixed(1) : '—';
    rcpDistanceType.textContent = receipt.transport.distance_type === 'STRAIGHT_LINE_ESTIMATE' ? 'Straight-line estimate' : 'Road Distance';
    rcpTransportCost.textContent = receipt.transport.estimated_cost ? Number(receipt.transport.estimated_cost).toFixed(2) : '0.00';
  } else {
    rcpTransportAddress.textContent = currentListing && currentListing.locality ? currentListing.locality : 'Designated Zone';
    rcpTransportDistance.textContent = '12.4';
    rcpDistanceType.textContent = 'Straight-line estimate';
    rcpTransportCost.textContent = '350.00';
  }

  rcpBatchCode.textContent = receipt.batch_code || 'Pending Batch Linking';
  rcpDigest.textContent = receipt.receipt_digest || 'SHA-256 Digest Pending Minting';

  if (btnVerifyReceiptLink) {
    btnVerifyReceiptLink.href = `${API_BASE}/api/receipts/${receipt.receipt_number}/verify`;
  }

  rcpModal.classList.remove('hidden');
}

if (btnCloseRcpModal) {
  btnCloseRcpModal.addEventListener('click', () => {
    rcpModal.classList.add('hidden');
  });
}

if (btnDismissRcp) {
  btnDismissRcp.addEventListener('click', () => {
    rcpModal.classList.add('hidden');
  });
}

if (btnPrintReceipt) {
  btnPrintReceipt.addEventListener('click', () => {
    window.print();
  });
}

// =============================================
// ROLE DASHBOARDS, IN-PLATFORM CHAT & NOTIFICATIONS
// =============================================

// Elements
const navRoleBadge = document.getElementById('nav-role-badge');
const btnNavDashboard = document.getElementById('btn-nav-dashboard');
const btnNavChat = document.getElementById('btn-nav-chat');
const navChatCount = document.getElementById('nav-chat-count');
const btnNotifToggle = document.getElementById('btn-notif-toggle');
const navNotifCount = document.getElementById('nav-notif-count');
const notificationsPopover = document.getElementById('notifications-popover');
const notifList = document.getElementById('notif-list');
const btnMarkAllRead = document.getElementById('btn-mark-all-read');

// Seller Dashboard Elements
const sellerDashboardPanel = document.getElementById('seller-dashboard-panel');
const sellerStatTotalListings = document.getElementById('seller-stat-total-listings');
const sellerStatActiveListings = document.getElementById('seller-stat-active-listings');
const sellerStatIncomingOffers = document.getElementById('seller-stat-incoming-offers');
const sellerStatTotalValue = document.getElementById('seller-stat-total-value');
const sellerListingsContainer = document.getElementById('seller-listings-container');
const sellerOffersContainer = document.getElementById('seller-offers-container');
const sellerListingsCount = document.getElementById('seller-listings-count');
const sellerOffersCount = document.getElementById('seller-offers-count');
const sellerBtnOpenChat = document.getElementById('seller-btn-open-chat');

// Buyer Dashboard Elements
const buyerDashboardPanel = document.getElementById('buyer-dashboard-panel');
const buyerStatAvailableBatches = document.getElementById('buyer-stat-available-batches');
const buyerStatActiveNegotiations = document.getElementById('buyer-stat-active-negotiations');
const buyerStatPurchasedBatches = document.getElementById('buyer-stat-purchased-batches');
const buyerStatTotalSpend = document.getElementById('buyer-stat-total-spend');
const buyerFeedstockContainer = document.getElementById('buyer-feedstock-container');
const buyerMarketSearch = document.getElementById('buyer-market-search');
const buyerNegotiationsContainer = document.getElementById('buyer-negotiations-container');
const buyerNegotiationsCount = document.getElementById('buyer-negotiations-count');
const buyerBtnOpenChat = document.getElementById('buyer-btn-open-chat');

// Chat Modal Elements
const chatModal = document.getElementById('chat-modal');
const btnCloseChatModal = document.getElementById('btn-close-chat-modal');
const chatThreadsList = document.getElementById('chat-threads-list');
const chatActiveBar = document.getElementById('chat-active-bar');
const chatActiveName = document.getElementById('chat-active-name');
const chatActiveRole = document.getElementById('chat-active-role');
const chatActiveListingCode = document.getElementById('chat-active-listing-code');
const chatActiveListingWeight = document.getElementById('chat-active-listing-weight');
const chatBtnOpenNeg = document.getElementById('chat-btn-open-neg');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const chatSendForm = document.getElementById('chat-send-form');
const chatMsgInput = document.getElementById('chat-msg-input');
const btnSendMessage = document.getElementById('btn-send-message');
const chatSearchInput = document.getElementById('chat-search-input');

// Chat State
let activeConversationId = null;
let activeConversationData = null;
let chatPollTimer = null;
let cachedFeedstockListings = [];
let allConversations = [];

// =============================================
// UNREAD BADGES & NOTIFICATION CONTROLLER
// =============================================

async function pollUnreadCounts() {
  if (!currentUser) return;
  try {
    const [notifRes, convRes] = await Promise.all([
      fetch(`${API_BASE}/api/notifications`, { credentials: 'same-origin' }),
      fetch(`${API_BASE}/api/conversations`, { credentials: 'same-origin' })
    ]);

    if (notifRes.ok) {
      const notifData = await notifRes.json();
      if (notifData.success && notifData.notifications) {
        const unreadNotifs = notifData.notifications.filter(n => !n.is_read).length;
        if (navNotifCount) {
          navNotifCount.textContent = unreadNotifs;
          navNotifCount.classList.toggle('hidden', unreadNotifs === 0);
        }
      }
    }

    if (convRes.ok) {
      const convData = await convRes.json();
      if (convData.success && convData.conversations) {
        allConversations = convData.conversations;
        const unreadMsgs = convData.conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0);
        if (navChatCount) {
          navChatCount.textContent = unreadMsgs;
          navChatCount.classList.toggle('hidden', unreadMsgs === 0);
        }
      }
    }
  } catch (err) {
    // Non-blocking poll
  }
}

async function loadNotifications() {
  if (!currentUser || !notifList) return;
  try {
    const res = await fetch(`${API_BASE}/api/notifications`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || !data.notifications || data.notifications.length === 0) {
      notifList.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }

    notifList.innerHTML = data.notifications.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${escapeHtml(n.id)}">
        <span class="notif-item-title">${escapeHtml(n.title)}</span>
        <span>${escapeHtml(n.message)}</span>
        <span class="notif-item-time">${new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `).join('');

    // Wire clicks to mark read
    notifList.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        await fetch(`${API_BASE}/api/notifications/${id}/read`, {
          method: 'POST',
          credentials: 'same-origin'
        });
        item.classList.remove('unread');
        pollUnreadCounts();
      });
    });
  } catch (err) {
    console.warn('Failed to load notifications:', err);
  }
}

if (btnNotifToggle) {
  btnNotifToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (notificationsPopover) {
      const isHidden = notificationsPopover.classList.contains('hidden');
      notificationsPopover.classList.toggle('hidden');
      if (isHidden) loadNotifications();
    }
  });
}

if (btnMarkAllRead) {
  btnMarkAllRead.addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      loadNotifications();
      pollUnreadCounts();
      showToast('All notifications marked as read.', 'info');
    } catch (err) {
      console.warn('Failed to mark read-all:', err);
    }
  });
}

document.addEventListener('click', (e) => {
  if (notificationsPopover && !notificationsPopover.classList.contains('hidden')) {
    if (!notificationsPopover.contains(e.target) && e.target !== btnNotifToggle) {
      notificationsPopover.classList.add('hidden');
    }
  }
});

// =============================================
// DASHBOARD NAVIGATION & CONTROLLERS
// =============================================

function showSellerDashboard() {
  if (sellerDashboardPanel) {
    sellerDashboardPanel.classList.remove('hidden');
    sellerDashboardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (buyerDashboardPanel) buyerDashboardPanel.classList.add('hidden');
  loadSellerDashboard();
}

function showBuyerDashboard() {
  if (buyerDashboardPanel) {
    buyerDashboardPanel.classList.remove('hidden');
    buyerDashboardPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (sellerDashboardPanel) sellerDashboardPanel.classList.add('hidden');
  loadBuyerDashboard();
}

if (btnNavDashboard) {
  btnNavDashboard.addEventListener('click', () => {
    if (!currentUser) {
      window.location.href = '/login.html';
      return;
    }
    if (currentUser.role === 'BUYER') {
      showBuyerDashboard();
    } else {
      showSellerDashboard();
    }
  });
}

// Load Seller Operations Dashboard
async function loadSellerDashboard() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/seller`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats || {};
    if (sellerStatTotalListings) sellerStatTotalListings.textContent = stats.total_listings || 0;
    if (sellerStatActiveListings) sellerStatActiveListings.textContent = stats.active_listings || 0;
    if (sellerStatIncomingOffers) sellerStatIncomingOffers.textContent = stats.pending_offers || 0;
    if (sellerStatTotalValue) {
      sellerStatTotalValue.textContent = `₹${Number(stats.total_estimated_value || 0).toFixed(2)}`;
    }

    // Render Listings
    const listings = data.listings || [];
    if (sellerListingsCount) sellerListingsCount.textContent = `${listings.length} item${listings.length === 1 ? '' : 's'}`;
    if (sellerListingsContainer) {
      if (listings.length === 0) {
        sellerListingsContainer.innerHTML = `
          <div class="dashboard-empty-state">
            <span class="empty-icon">📦</span>
            <p>No listings created yet.</p>
            <a href="#submit-waste" class="btn btn-outline btn-sm">Create First Listing</a>
          </div>
        `;
      } else {
        sellerListingsContainer.innerHTML = listings.map(l => `
          <div class="dashboard-item-card">
            <div class="item-meta-main">
              <span class="item-title">${escapeHtml(l.listing_id || 'PET Batch')} — ${Number(l.quantity_kg).toFixed(1)} kg</span>
              <div class="item-sub-tags">
                <span>📍 ${escapeHtml(l.locality || 'Zone')}</span>
                <span>•</span>
                <span>${escapeHtml(l.condition || 'Clean')}</span>
                <span>•</span>
                <span class="badge badge-sm badge-secure">${escapeHtml(l.status || 'LISTED')}</span>
              </div>
            </div>
            <div class="item-actions">
              <button type="button" class="btn btn-outline btn-sm btn-seller-view-ecoproof" data-id="${escapeHtml(l.listing_id)}">
                🛡️ EcoProof
              </button>
            </div>
          </div>
        `).join('');

        sellerListingsContainer.querySelectorAll('.btn-seller-view-ecoproof').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const l = listings.find(item => item.listing_id === id);
            if (l) {
              currentListing = l;
              openEcoProofPanel(l);
            }
          });
        });
      }
    }

    // Render Pending Offers / Negotiations
    const negs = data.incoming_negotiations || [];
    if (sellerOffersCount) sellerOffersCount.textContent = `${negs.length} negotiation${negs.length === 1 ? '' : 's'}`;
    if (sellerOffersContainer) {
      if (negs.length === 0) {
        sellerOffersContainer.innerHTML = `
          <div class="dashboard-empty-state">
            <span class="empty-icon">🤝</span>
            <p>No buyer offers received yet. Matched recyclers will submit formal proposals here.</p>
          </div>
        `;
      } else {
        sellerOffersContainer.innerHTML = negs.map(n => `
          <div class="dashboard-item-card">
            <div class="item-meta-main">
              <span class="item-title">${escapeHtml(n.buyer_name || n.buyer_id)}</span>
              <div class="item-sub-tags">
                <span>Offer: <strong>₹${Number(n.current_price_per_kg).toFixed(2)}/kg</strong></span>
                <span>•</span>
                <span>Total: <strong>₹${Number(n.current_total_amount).toFixed(2)}</strong></span>
                <span>•</span>
                <span class="badge badge-sm badge-test">${escapeHtml(n.status)}</span>
              </div>
            </div>
            <div class="item-actions">
              <button type="button" class="btn btn-primary btn-sm btn-seller-review-neg" data-id="${escapeHtml(n.id)}">
                Review Terms
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-seller-chat-neg" data-id="${escapeHtml(n.id)}" data-listing="${escapeHtml(n.listing_id)}" data-buyer="${escapeHtml(n.buyer_id)}">
                💬 Chat
              </button>
            </div>
          </div>
        `).join('');

        sellerOffersContainer.querySelectorAll('.btn-seller-review-neg').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const neg = negs.find(item => item.id === id);
            if (neg) openNegotiationModalFor(neg);
          });
        });

        sellerOffersContainer.querySelectorAll('.btn-seller-chat-neg').forEach(btn => {
          btn.addEventListener('click', () => {
            startChatForNegotiation(btn.dataset.listing, btn.dataset.buyer);
          });
        });
      }
    }

  } catch (err) {
    console.warn('Failed to load seller dashboard:', err);
  }
}

// Load Buyer Procurement Dashboard
async function loadBuyerDashboard() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/buyer`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats || {};
    if (buyerStatAvailableBatches) buyerStatAvailableBatches.textContent = stats.available_listings || 0;
    if (buyerStatActiveNegotiations) buyerStatActiveNegotiations.textContent = stats.active_negotiations || 0;
    if (buyerStatPurchasedBatches) buyerStatPurchasedBatches.textContent = stats.purchased_batches || 0;
    if (buyerStatTotalSpend) {
      buyerStatTotalSpend.textContent = `₹${Number(stats.total_spend || 0).toFixed(2)}`;
    }

    cachedFeedstockListings = data.available_listings || [];
    renderFeedstockCards(cachedFeedstockListings);

    // Active negotiations
    const negs = data.active_negotiations || [];
    if (buyerNegotiationsCount) buyerNegotiationsCount.textContent = `${negs.length} item${negs.length === 1 ? '' : 's'}`;
    if (buyerNegotiationsContainer) {
      if (negs.length === 0) {
        buyerNegotiationsContainer.innerHTML = `
          <div class="dashboard-empty-state">
            <span class="empty-icon">💬</span>
            <p>You have not initiated any negotiations yet. Browse feedstock above to submit an offer.</p>
          </div>
        `;
      } else {
        buyerNegotiationsContainer.innerHTML = negs.map(n => `
          <div class="dashboard-item-card">
            <div class="item-meta-main">
              <span class="item-title">Batch: ${escapeHtml(n.listing_id)}</span>
              <div class="item-sub-tags">
                <span>Proposed: <strong>₹${Number(n.current_price_per_kg).toFixed(2)}/kg</strong></span>
                <span>•</span>
                <span>Total: <strong>₹${Number(n.current_total_amount).toFixed(2)}</strong></span>
                <span>•</span>
                <span class="badge badge-sm badge-test">${escapeHtml(n.status)}</span>
              </div>
            </div>
            <div class="item-actions">
              <button type="button" class="btn btn-primary btn-sm btn-buyer-view-neg" data-id="${escapeHtml(n.id)}">
                View Terms
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-buyer-chat-neg" data-listing="${escapeHtml(n.listing_id)}">
                💬 Chat
              </button>
            </div>
          </div>
        `).join('');

        buyerNegotiationsContainer.querySelectorAll('.btn-buyer-view-neg').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const neg = negs.find(item => item.id === id);
            if (neg) openNegotiationModalFor(neg);
          });
        });

        buyerNegotiationsContainer.querySelectorAll('.btn-buyer-chat-neg').forEach(btn => {
          btn.addEventListener('click', () => {
            startChatWithSeller(btn.dataset.listing);
          });
        });
      }
    }

  } catch (err) {
    console.warn('Failed to load buyer dashboard:', err);
  }
}

function renderFeedstockCards(list) {
  if (!buyerFeedstockContainer) return;
  if (!list || list.length === 0) {
    buyerFeedstockContainer.innerHTML = `
      <div class="dashboard-empty-state">
        <span class="empty-icon">📦</span>
        <p>No PET feedstock batches currently match your filter criteria.</p>
      </div>
    `;
    return;
  }

  buyerFeedstockContainer.innerHTML = list.map(item => `
    <div class="feedstock-card">
      <div class="feedstock-badge-row">
        <span class="badge badge-sm badge-secure">${escapeHtml(item.material || 'PET Plastic')}</span>
        <span class="feedstock-qty">${Number(item.quantity_kg).toFixed(1)} kg</span>
      </div>
      <div class="feedstock-details">
        <div><strong>Zone:</strong> ${escapeHtml(item.locality || 'General Sector')}</div>
        <div><strong>Condition:</strong> ${escapeHtml(item.condition || 'Clean')}</div>
        <div><strong>Batch Ref:</strong> <code>${escapeHtml(item.listing_id)}</code></div>
      </div>
      <div class="feedstock-actions">
        <button type="button" class="btn btn-primary btn-sm btn-full btn-buyer-make-offer" data-id="${escapeHtml(item.listing_id)}" data-qty="${item.quantity_kg}">
          🤝 Make Offer
        </button>
        <button type="button" class="btn btn-outline btn-sm btn-buyer-msg-seller" data-id="${escapeHtml(item.listing_id)}">
          💬 Message
        </button>
      </div>
    </div>
  `).join('');

  buyerFeedstockContainer.querySelectorAll('.btn-buyer-make-offer').forEach(btn => {
    btn.addEventListener('click', () => {
      const listingId = btn.dataset.id;
      const listing = cachedFeedstockListings.find(l => l.listing_id === listingId);
      if (listing) {
        currentListing = listing;
        // As a buyer, initiate negotiation
        initiateBuyerNegotiationForListing(listing);
      }
    });
  });

  buyerFeedstockContainer.querySelectorAll('.btn-buyer-msg-seller').forEach(btn => {
    btn.addEventListener('click', () => {
      startChatWithSeller(btn.dataset.id);
    });
  });
}

if (buyerMarketSearch) {
  buyerMarketSearch.addEventListener('input', () => {
    const query = buyerMarketSearch.value.trim().toLowerCase();
    if (!query) {
      renderFeedstockCards(cachedFeedstockListings);
      return;
    }
    const filtered = cachedFeedstockListings.filter(l => 
      (l.locality && l.locality.toLowerCase().includes(query)) ||
      (l.condition && l.condition.toLowerCase().includes(query)) ||
      (l.listing_id && l.listing_id.toLowerCase().includes(query))
    );
    renderFeedstockCards(filtered);
  });
}

// =============================================
// IN-PLATFORM BUYER-SELLER CHAT SYSTEM
// =============================================

function openChatModal(conversationIdToSelect) {
  if (!chatModal) return;
  chatModal.classList.remove('hidden');
  loadConversationsList(conversationIdToSelect);

  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (activeConversationId) {
      pollActiveConversationMessages();
    }
    pollUnreadCounts();
  }, 4000);
}

function closeChatModal() {
  if (!chatModal) return;
  chatModal.classList.add('hidden');
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

if (btnCloseChatModal) {
  btnCloseChatModal.addEventListener('click', closeChatModal);
}

if (btnNavChat) {
  btnNavChat.addEventListener('click', () => {
    if (!currentUser) {
      window.location.href = '/login.html';
      return;
    }
    openChatModal();
  });
}

if (sellerBtnOpenChat) {
  sellerBtnOpenChat.addEventListener('click', () => openChatModal());
}

if (buyerBtnOpenChat) {
  buyerBtnOpenChat.addEventListener('click', () => openChatModal());
}

async function loadConversationsList(autoSelectId) {
  if (!chatThreadsList) return;
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    allConversations = data.conversations || [];
    renderConversationsList(allConversations, autoSelectId);
  } catch (err) {
    console.warn('Failed to load conversations:', err);
  }
}

function renderConversationsList(list, autoSelectId) {
  if (!chatThreadsList) return;
  if (!list || list.length === 0) {
    chatThreadsList.innerHTML = '<div class="chat-empty-threads">No trade conversations yet. Messages and offers will appear here.</div>';
    if (chatMessagesContainer) {
      chatMessagesContainer.innerHTML = `
        <div class="chat-messages-empty">
          <div class="empty-icon">💬</div>
          <p>You have no active conversations. Browse batches or match with buyers to start chatting.</p>
        </div>
      `;
    }
    if (chatMsgInput) chatMsgInput.disabled = true;
    if (btnSendMessage) btnSendMessage.disabled = true;
    return;
  }

  chatThreadsList.innerHTML = list.map(c => {
    const isActive = c.id === (autoSelectId || activeConversationId);
    const otherUser = c.other_party || {};
    return `
      <div class="chat-thread-item ${isActive ? 'active' : ''}" data-id="${escapeHtml(c.id)}">
        <div class="chat-thread-header">
          <span class="chat-thread-user">${escapeHtml(otherUser.name || otherUser.email || 'Trade Partner')}</span>
          <span class="chat-thread-time">${c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        </div>
        <div class="chat-thread-snippet">
          ${c.unread_count > 0 ? `<strong class="badge-count" style="position:static; margin-right:4px;">${c.unread_count}</strong>` : ''}
          ${escapeHtml(c.last_message_snippet || 'Conversation started')}
        </div>
      </div>
    `;
  }).join('');

  chatThreadsList.querySelectorAll('.chat-thread-item').forEach(item => {
    item.addEventListener('click', () => {
      selectConversation(item.dataset.id);
    });
  });

  const targetId = autoSelectId || activeConversationId || list[0].id;
  if (targetId) {
    selectConversation(targetId);
  }
}

async function selectConversation(convId) {
  activeConversationId = convId;
  const conv = allConversations.find(c => c.id === convId);
  activeConversationData = conv;

  // Highlight active thread
  if (chatThreadsList) {
    chatThreadsList.querySelectorAll('.chat-thread-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === convId);
    });
  }

  // Update Active Bar
  if (conv) {
    const other = conv.other_party || {};
    if (chatActiveName) chatActiveName.textContent = other.name || other.email || 'Trade Partner';
    if (chatActiveRole) {
      const role = other.role || 'SELLER';
      chatActiveRole.textContent = role;
      chatActiveRole.className = role === 'BUYER' ? 'badge badge-sm badge-role-buyer' : 'badge badge-sm badge-role-seller';
    }
    if (chatActiveListingCode) chatActiveListingCode.textContent = conv.listing_id || 'PET Batch';
    if (chatActiveListingWeight) chatActiveListingWeight.textContent = conv.quantity_kg ? `${Number(conv.quantity_kg).toFixed(1)} kg` : 'Scrap Feedstock';

    if (chatBtnOpenNeg) {
      chatBtnOpenNeg.onclick = () => {
        // Open negotiation for this listing and buyer
        openNegotiationForConversation(conv);
      };
    }
  }

  if (chatMsgInput) chatMsgInput.disabled = false;
  if (btnSendMessage) btnSendMessage.disabled = false;

  await fetchAndRenderMessages(convId);
}

async function fetchAndRenderMessages(convId) {
  if (!chatMessagesContainer) return;
  try {
    const res = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    renderMessagesStream(data.messages || []);
    pollUnreadCounts();
  } catch (err) {
    console.warn('Failed to fetch messages:', err);
  }
}

async function pollActiveConversationMessages() {
  if (!activeConversationId || !chatMessagesContainer) return;
  try {
    const res = await fetch(`${API_BASE}/api/conversations/${activeConversationId}/messages`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    renderMessagesStream(data.messages || []);
  } catch (err) {
    // Non-blocking poll
  }
}

function renderMessagesStream(messages) {
  if (!chatMessagesContainer) return;
  if (messages.length === 0) {
    chatMessagesContainer.innerHTML = `
      <div class="chat-messages-empty">
        <div class="empty-icon">🤝</div>
        <p>This is the start of your direct trade chat. Inquire about batch details, logistics schedule, or make counteroffers.</p>
      </div>
    `;
    return;
  }

  chatMessagesContainer.innerHTML = messages.map(m => {
    let meta = null;
    try {
      meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
    } catch (e) {
      meta = null;
    }

    // Is Synchronized Negotiation Offer Event?
    if (meta && (meta.type === 'OFFER_CREATED' || meta.type === 'COUNTEROFFER_SUBMITTED' || meta.type === 'OFFER_ACCEPTED' || meta.type === 'OFFER_REJECTED' || meta.type === 'OFFER_WITHDRAWN')) {
      const isAccepted = meta.type === 'OFFER_ACCEPTED';
      return `
        <div class="chat-system-card">
          <div class="chat-system-card-header">
            <span>🤝 TRADE NEGOTIATION EVENT</span>
            <span>${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="chat-system-card-text">
            ${escapeHtml(m.body)}
          </div>
          <div class="chat-system-card-actions">
            ${isAccepted && meta.receipt_number ? `
              <button type="button" class="btn btn-primary btn-sm btn-chat-view-receipt" data-receipt="${escapeHtml(meta.receipt_number)}">
                📄 View Receipt
              </button>
            ` : `
              <button type="button" class="btn btn-outline btn-sm btn-chat-open-neg" data-neg="${escapeHtml(meta.negotiation_id || '')}">
                Review in Negotiation Modal
              </button>
            `}
          </div>
        </div>
      `;
    }

    // Regular User Chat Message
    const isOut = currentUser && m.sender_id === currentUser.id;
    return `
      <div class="chat-bubble ${isOut ? 'chat-bubble-out' : 'chat-bubble-in'}">
        <div>${escapeHtml(m.body)}</div>
        <span class="chat-bubble-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `;
  }).join('');

  // Wire action buttons inside system cards
  chatMessagesContainer.querySelectorAll('.btn-chat-open-neg').forEach(btn => {
    btn.addEventListener('click', async () => {
      const negId = btn.dataset.neg;
      if (negId) {
        try {
          const res = await fetch(`${API_BASE}/api/negotiations/${negId}`, { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            if (data.negotiation) openNegotiationModalFor(data.negotiation);
          }
        } catch (e) {}
      }
    });
  });

  chatMessagesContainer.querySelectorAll('.btn-chat-view-receipt').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rcpNum = btn.dataset.receipt;
      if (rcpNum) {
        try {
          const res = await fetch(`${API_BASE}/api/receipts/${rcpNum}`, { credentials: 'same-origin' });
          if (res.ok) {
            const data = await res.json();
            if (data.receipt) openReceiptModal(data.receipt);
          }
        } catch (e) {}
      }
    });
  });

  // Scroll to bottom
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

if (chatSendForm) {
  chatSendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeConversationId || !chatMsgInput) return;
    const body = chatMsgInput.value.trim();
    if (!body) return;

    chatMsgInput.value = '';
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ body })
      });
      if (res.ok) {
        await fetchAndRenderMessages(activeConversationId);
      } else {
        showToast('Failed to send message.', 'error');
      }
    } catch (err) {
      console.error('Send message error:', err);
      showToast('Network error sending message.', 'error');
    }
  });
}

// Conversation Initiation Helpers
async function startBuyerChat(buyer) {
  if (!currentListing) {
    showToast('Please first create or select a PET listing.', 'warning');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        listing_id: currentListing.listing_id,
        buyer_id: buyer.buyer_id
      })
    });
    const data = await res.json();
    if (data.success && data.conversation) {
      openChatModal(data.conversation.id);
    } else {
      showToast(data.error?.message || 'Could not start conversation.', 'error');
    }
  } catch (err) {
    console.error('Start chat error:', err);
    showToast('Failed to start chat.', 'error');
  }
}

async function startChatWithSeller(listingId) {
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ listing_id: listingId })
    });
    const data = await res.json();
    if (data.success && data.conversation) {
      openChatModal(data.conversation.id);
    } else {
      showToast(data.error?.message || 'Could not open seller conversation.', 'error');
    }
  } catch (err) {
    console.error('Chat with seller error:', err);
    showToast('Failed to open chat.', 'error');
  }
}

async function startChatForNegotiation(listingId, buyerId) {
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ listing_id: listingId, buyer_id: buyerId })
    });
    const data = await res.json();
    if (data.success && data.conversation) {
      openChatModal(data.conversation.id);
    }
  } catch (err) {}
}

async function openNegotiationModalFor(neg) {
  activeNegotiation = neg;
  renderNegotiationView(neg);
  if (negModal) negModal.classList.remove('hidden');
}

async function openNegotiationForConversation(conv) {
  try {
    // Check if negotiation exists
    const res = await fetch(`${API_BASE}/api/negotiations?listing_id=${conv.listing_id}`, { credentials: 'same-origin' });
    if (res.ok) {
      const data = await res.json();
      if (data.negotiations && data.negotiations.length > 0) {
        openNegotiationModalFor(data.negotiations[0]);
        return;
      }
    }
    showToast('No active negotiation for this conversation yet.', 'info');
  } catch (e) {
    showToast('Unable to open negotiation terms.', 'error');
  }
}

async function initiateBuyerNegotiationForListing(listing) {
  try {
    const res = await fetch(`${API_BASE}/api/negotiations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        listing_id: listing.listing_id,
        initial_price_per_kg: 16.50,
        message: 'Formal procurement proposal submitted via marketplace explorer.'
      })
    });
    const data = await res.json();
    if (data.success && data.negotiation) {
      activeNegotiation = data.negotiation;
      renderNegotiationView(data.negotiation);
      if (negModal) negModal.classList.remove('hidden');
      loadBuyerDashboard();
    } else {
      showToast(data.error?.message || 'Could not initiate negotiation.', 'error');
    }
  } catch (err) {
    showToast('Failed to start negotiation.', 'error');
  }
}
