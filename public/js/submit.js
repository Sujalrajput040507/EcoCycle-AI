'use strict';

/**
 * Submit page: handles PET waste form, image preview, validation,
 * submission to the Express server, and match display.
 */

(function () {
  // Require login
  var user = EcoApp.requireAuth(['user', 'admin']);
  if (!user) return;

  var form = document.getElementById('listing-form');
  var imageInput = document.getElementById('image');
  var uploadArea = document.getElementById('upload-area');
  var preview = document.getElementById('image-preview');
  var errorBox = document.getElementById('form-error');
  var resultSection = document.getElementById('result');
  var resultMessage = document.getElementById('result-message');
  var resultDetails = document.getElementById('result-details');
  var matchesBox = document.getElementById('matches');
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
      return;
    }
    if (allowedTypes.indexOf(file.type) === -1) {
      imageInput.value = '';
      preview.classList.remove('visible');
      showError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.classList.add('visible');
    uploadArea.innerHTML = '<div class="upload-icon">✓</div><p>Photo selected: ' +
      file.name + '</p><p class="upload-hint">Click to change</p>';
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
        submitBtn.textContent = 'Submit Listing';

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
        submitBtn.textContent = 'Submit Listing';
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
    if (area.length < 2) return 'Please enter a general area (city or neighbourhood).';
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

    // Info bar
    var info = document.createElement('p');
    info.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;';
    info.textContent = payload.eligibleCount + ' eligible match' +
      (payload.eligibleCount !== 1 ? 'es' : '') +
      ' · Formula: ' + payload.calculationVersion;
    matchesBox.appendChild(info);

    if (!payload.eligibleMatches.length) {
      var empty = document.createElement('p');
      empty.textContent = 'No sample recycler meets the hard checks. This is not a real-world shortage claim.';
      empty.style.color = 'var(--text-secondary)';
      matchesBox.appendChild(empty);
    } else {
      payload.eligibleMatches.forEach(function (m) {
        matchesBox.appendChild(renderMatchCard(m, true));
      });
    }

    if (payload.ineligibleBuyers && payload.ineligibleBuyers.length) {
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
    var header = '<div class="match-card-header">' +
      '<h4>' + match.displayName + '</h4>' +
      '<span class="' + scoreClass + '">' + match.totalScore + '/100</span>' +
      '</div>';

    var label = '<p class="match-label">' + match.dataLabel + '</p>';

    var meta = '<p class="match-meta">' +
      'Areas: ' + match.supportedAreas.join(', ') +
      ' · Qty: ' + (match.quantityRangeKg.min || '?') + '–' + (match.quantityRangeKg.max || '?') + ' kg' +
      ' · Demand: ' + match.demandLevel + '</p>';

    var factors = [
      ['Material', match.breakdown.materialCompatibility],
      ['Quantity', match.breakdown.quantityCompatibility],
      ['Location', match.breakdown.locationFit],
      ['Demand', match.breakdown.buyerDemand],
      ['Quality', match.breakdown.qualityCompatibility]
    ];
    var factorsHtml = '<ul class="match-factors">';
    factors.forEach(function (f) {
      factorsHtml += '<li><span class="factor-name">' + f[0] + ' (' + (f[1].weightedScore) + ')</span>' +
        '<span class="factor-score">' + f[1].score + '/100</span></li>';
    });
    factorsHtml += '</ul>';

    var limitsHtml = '';
    if (match.limitations && match.limitations.length) {
      limitsHtml = '<div class="match-limitations">' + match.limitations.join(' ') + '</div>';
    }

    card.innerHTML = header + label + meta + factorsHtml + limitsHtml;
    return card;
  }

  function showSavedListing(message, listing) {
    resultMessage.textContent = ' ' + message;
    resultDetails.innerHTML = '';

    var fields = [
      ['Listing ID', listing.listingId],
      ['Status', listing.listingStatus],
      ['Material', listing.materialCategory],
      ['Quantity', listing.quantity + ' ' + listing.unit],
      ['Area', listing.locationArea],
      ['Condition', listing.condition],
      ['Demo Data', listing.isDemoData ? 'Yes — hackathon listing' : 'No']
    ];

    fields.forEach(function (f) {
      resultDetails.innerHTML +=
        '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
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
