'use strict';

/**
 * Submit page: handles PET waste form, image preview, validation,
 * submission to the Express server, AI estimation banner, and real match display.
 */

(function () {
  // Require login (allows industrial generators and administrators)
  var user = EcoApp.requireAuth(['user', 'generator', 'admin']);
  if (!user) return;

  var form = document.getElementById('listing-form');
  var imageInput = document.getElementById('image');
  var uploadArea = document.getElementById('upload-area');
  var preview = document.getElementById('image-preview');
  var aiBanner = document.getElementById('ai-assist-banner');
  var errorBox = document.getElementById('form-error');
  var resultSection = document.getElementById('result');
  var resultMessage = document.getElementById('result-message');
  var resultDetails = document.getElementById('result-details');
  var matchesBox = document.getElementById('matches');
  var matchesBadge = document.getElementById('matches-badge');
  var allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

  // Upload area click → trigger file input
  uploadArea.addEventListener('click', function () {
    imageInput.click();
  });

  // Drag and drop
  uploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', function () {
    uploadArea.classList.remove('drag-over');
  });
  uploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      imageInput.files = e.dataTransfer.files;
      handleFileChange();
    }
  });

  imageInput.addEventListener('change', handleFileChange);

  function handleFileChange() {
    var file = imageInput.files[0];
    hideError();
    if (!file) {
      preview.classList.remove('visible');
      preview.removeAttribute('src');
      if (aiBanner) aiBanner.style.display = 'none';
      return;
    }
    if (allowedTypes.indexOf(file.type) === -1) {
      imageInput.value = '';
      preview.classList.remove('visible');
      if (aiBanner) aiBanner.style.display = 'none';
      showError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.classList.add('visible');
    if (aiBanner) aiBanner.style.display = 'block';

    uploadArea.innerHTML = '<div class="upload-icon">✓</div><p>Photo selected: ' +
      EcoApp.escapeHtml(file.name) + '</p><p class="upload-hint">Click to change</p>';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    resultSection.classList.remove('visible');

    var clientError = getClientError();
    if (clientError) {
      showError(clientError);
      return;
    }

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    var data = new FormData(form);

    fetch('/api/listings', {
      method: 'POST',
      headers: EcoApp.authHeaders(),
      body: data
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit to Marketplace';

        if (!result.ok) {
          showError(result.body.error || 'The listing could not be saved.');
          return;
        }

        showSavedListing(result.body.message, result.body.listing);

        if (result.body.matches) {
          showMatches(result.body.matches);
        } else {
          loadMatches(result.body.listing.listingId);
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit to Marketplace';
        showError('Could not reach the server. Is EcoCycle AI running?');
      });
  });

  function getClientError() {
    var file = imageInput.files[0];
    if (!file) return 'Please add a photo of the PET plastic bottles.';
    if (allowedTypes.indexOf(file.type) === -1) return 'Please choose a JPEG, PNG, or WebP image.';
    if (file.size > 5 * 1024 * 1024) return 'Please choose an image of 5 MB or smaller.';
    var qty = Number(document.getElementById('quantity').value);
    if (!Number.isFinite(qty) || qty <= 0) return 'Quantity must be a number greater than 0.';
    var area = document.getElementById('locationArea').value.trim();
    if (area.length < 2) return 'Please enter a general collection area (city or neighbourhood).';
    if (!document.getElementById('condition').value) return 'Please choose a visible condition.';
    return '';
  }

  function loadMatches(listingId) {
    matchesBox.innerHTML = '<p style="color:var(--text-secondary)">Loading matches…</p>';
    fetch('/api/listings/' + encodeURIComponent(listingId) + '/matches', {
      headers: EcoApp.authHeaders()
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) {
          matchesBox.innerHTML = '<p style="color:var(--text-secondary)">Matches could not be loaded.</p>';
          return;
        }
        showMatches(r.body);
      })
      .catch(function () {
        matchesBox.innerHTML = '<p style="color:var(--text-secondary)">Matches could not be loaded.</p>';
      });
  }

  function showMatches(payload) {
    matchesBox.innerHTML = '';
    var isDemo = payload.isDemoData === true;

    if (matchesBadge) {
      if (isDemo) {
        matchesBadge.textContent = 'Demo Simulation Profiles';
        matchesBadge.className = 'badge badge-demo';
      } else {
        matchesBadge.textContent = 'Verified Real Marketplace';
        matchesBadge.className = 'badge';
        matchesBadge.style.background = 'var(--mint)';
        matchesBadge.style.color = 'var(--green-900)';
      }
    }

    // Info bar
    var info = document.createElement('p');
    info.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;';
    info.textContent = payload.eligibleCount + ' verified match' +
      (payload.eligibleCount !== 1 ? 'es' : '') +
      ' · Matching Formula: ' + payload.calculationVersion;
    matchesBox.appendChild(info);

    if (!payload.eligibleMatches.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.cssText = 'padding:24px 16px;background:var(--bg);border-radius:var(--radius-sm);';
      if (!isDemo) {
        empty.innerHTML = '<div class="empty-icon" style="font-size:2rem">🔍</div>' +
          '<h4 style="margin-bottom:6px">No verified buyers match this listing yet</h4>' +
          '<p style="color:var(--text-secondary);font-size:0.85rem;max-width:480px;margin:0 auto">' +
          'Your listing is saved and active in the marketplace. When verified recyclers matching your material and quantity parameters register, their match will appear here.' +
          '</p>';
      } else {
        empty.innerHTML = '<p style="color:var(--text-secondary)">No demo sample recycler meets the hard checks.</p>';
      }
      matchesBox.appendChild(empty);
    } else {
      payload.eligibleMatches.forEach(function (m) {
        matchesBox.appendChild(renderMatchCard(m, true));
      });
    }

    if (payload.ineligibleBuyers && payload.ineligibleBuyers.length && isDemo) {
      var h = document.createElement('h4');
      h.textContent = 'Not a full match';
      h.style.cssText = 'margin-top:20px;margin-bottom:10px;font-size:0.95rem;color:var(--text-secondary)';
      matchesBox.appendChild(h);
      payload.ineligibleBuyers.forEach(function (m) {
        matchesBox.appendChild(renderMatchCard(m, false));
      });
    }
  }

  function renderMatchCard(match, eligible) {
    var card = document.createElement('div');
    card.className = 'match-card';

    var scoreClass = eligible ? 'match-score' : 'match-score ineligible';
    var badge = match.isDemoData
      ? '<span class="badge badge-demo">Demo Sample</span>'
      : '<span class="badge" style="background:var(--mint);color:var(--green-900)">Verified Buyer</span>';

    var header = '<div class="match-card-header">' +
      '<div>' +
        '<h4>' + EcoApp.escapeHtml(match.displayName) + ' ' + badge + '</h4>' +
        '<p class="match-label">' + EcoApp.escapeHtml(match.dataLabel) + '</p>' +
      '</div>' +
      '<span class="' + scoreClass + '">' + match.totalScore + '/100</span>' +
      '</div>';

    var meta = '<p class="match-meta">' +
      'Areas: ' + EcoApp.escapeHtml((match.supportedAreas || []).join(', ')) +
      ' &middot; Qty: ' + (match.quantityRangeKg ? match.quantityRangeKg.min : '?') + '–' +
      (match.quantityRangeKg ? match.quantityRangeKg.max : '?') + ' kg' +
      ' &middot; Demand: ' + EcoApp.escapeHtml(match.demandLevel || 'medium') + '</p>';

    var factors = [
      ['Material Compatibility', match.breakdown.materialCompatibility],
      ['Quantity Compatibility', match.breakdown.quantityCompatibility],
      ['Location Fit', match.breakdown.locationFit],
      ['Buyer Demand', match.breakdown.buyerDemand],
      ['Quality / Condition', match.breakdown.qualityCompatibility]
    ];
    var factorsHtml = '<ul class="match-factors">';
    factors.forEach(function (f) {
      factorsHtml += '<li><span class="factor-name">' + f[0] + ' (' + (f[1].weightedScore) + ')</span>' +
        '<span class="factor-score">' + f[1].score + '/100</span></li>';
    });
    factorsHtml += '</ul>';

    var limitsHtml = '';
    if (match.limitations && match.limitations.length) {
      limitsHtml = '<div class="match-limitations">' + EcoApp.escapeHtml(match.limitations.join(' ')) + '</div>';
    }

    card.innerHTML = header + meta + factorsHtml + limitsHtml;
    return card;
  }

  function showSavedListing(message, listing) {
    resultMessage.textContent = ' ' + message;
    resultDetails.innerHTML = '';

    var fields = [
      ['Listing ID', listing.listingId],
      ['Marketplace Status', listing.listingStatus],
      ['Material', listing.materialCategory],
      ['Quantity', listing.quantity + ' ' + listing.unit],
      ['Collection Area', listing.locationArea],
      ['Visible Condition', listing.condition],
      ['Exchange Registry', listing.isDemoData ? 'Demo Sandbox' : 'Verified Real Exchange']
    ];

    fields.forEach(function (f) {
      resultDetails.innerHTML +=
        '<div><dt>' + f[0] + '</dt><dd>' + EcoApp.escapeHtml(String(f[1])) + '</dd></div>';
    });

    resultSection.classList.add('visible');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('visible');
  }

  function hideError() {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
  }
})();
