'use strict';

/**
 * Dashboard page logic.
 * Features:
 * - Dual-role Seller / Buyer mode switch (without database role mutation).
 * - Meaningful role labels: Industrial Waste Generator, Recycler, Administrator.
 * - Real marketplace data matching (no fake buyers for real listings).
 * - Buyer purchasing preferences management.
 * - Marketplace browsing and "Express Interest" action for buyers.
 */

(function () {
  // Enforce authentication
  var user = EcoApp.requireAuth();
  if (!user) return;

  var currentMode = localStorage.getItem('ecocycle_mode') ||
    (user.role === 'recycler' ? 'buyer' : 'seller');

  // DOM Elements
  var welcomeTitle = document.getElementById('welcome-title');
  var welcomeSub = document.getElementById('welcome-sub');
  var currentRoleBadge = document.getElementById('current-role-badge');
  var btnModeSeller = document.getElementById('btn-mode-seller');
  var btnModeBuyer = document.getElementById('btn-mode-buyer');
  var sellerView = document.getElementById('seller-view');
  var buyerView = document.getElementById('buyer-view');

  // Configure user information & professional role titles
  var roleTitle = EcoApp.formatRole(user.role);
  var displayName = user.name || user.email || 'EcoCycle Member';

  currentRoleBadge.textContent = roleTitle;
  welcomeTitle.textContent = 'Welcome, ' + displayName;

  // Initialize view mode
  setMode(currentMode);

  // Mode Switch Events
  btnModeSeller.addEventListener('click', function () {
    setMode('seller');
  });

  btnModeBuyer.addEventListener('click', function () {
    setMode('buyer');
  });

  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem('ecocycle_mode', mode);

    if (mode === 'seller') {
      btnModeSeller.style.background = 'var(--white)';
      btnModeSeller.style.color = 'var(--text)';
      btnModeSeller.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      btnModeSeller.style.fontWeight = '700';

      btnModeBuyer.style.background = 'transparent';
      btnModeBuyer.style.color = 'var(--text-secondary)';
      btnModeBuyer.style.boxShadow = 'none';
      btnModeBuyer.style.fontWeight = '600';

      sellerView.style.display = 'block';
      buyerView.style.display = 'none';

      welcomeSub.innerHTML = '<strong>Active Mode:</strong> Seller &middot; <strong>Role:</strong> ' +
        EcoApp.escapeHtml(roleTitle) + ' &middot; <strong>Email:</strong> ' + EcoApp.escapeHtml(user.email);

      loadSellerData();
    } else {
      btnModeBuyer.style.background = 'var(--white)';
      btnModeBuyer.style.color = 'var(--text)';
      btnModeBuyer.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      btnModeBuyer.style.fontWeight = '700';

      btnModeSeller.style.background = 'transparent';
      btnModeSeller.style.color = 'var(--text-secondary)';
      btnModeSeller.style.boxShadow = 'none';
      btnModeSeller.style.fontWeight = '600';

      sellerView.style.display = 'none';
      buyerView.style.display = 'block';

      welcomeSub.innerHTML = '<strong>Active Mode:</strong> Material Sourcing / Buyer &middot; <strong>Role:</strong> ' +
        EcoApp.escapeHtml(roleTitle) + ' &middot; <strong>Email:</strong> ' + EcoApp.escapeHtml(user.email);

      loadBuyerData();
    }
  }

  // ── SELLER VIEW LOGIC ──────────────────────────────────────────────

  function loadSellerData() {
    fetch('/api/listings', { headers: EcoApp.authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var allListings = data.listings || [];
        // Filter to own listings if user id is known, or show all for admin/demo
        var myListings = allListings;
        if (user.id && user.role !== 'admin') {
          var filtered = allListings.filter(function (l) {
            return l.generatorId === user.id || l.generatorEmail === user.email;
          });
          if (filtered.length > 0) {
            myListings = filtered;
          }
        }

        renderStats(myListings);
        renderSellerListings(myListings);
        renderMatches(myListings);
      })
      .catch(function () {
        document.getElementById('stat-total').textContent = '–';
      });
  }

  function renderStats(listings) {
    var total = listings.length;
    var matched = listings.filter(function (l) { return l.listingStatus === 'MATCHED'; }).length;
    var collected = listings.filter(function (l) { return l.listingStatus === 'COLLECTED'; }).length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-matched').textContent = matched;
    document.getElementById('stat-collected').textContent = collected;
  }

  function renderSellerListings(listings) {
    var tbody = document.getElementById('listings-body');
    if (!listings.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">' +
        '<div class="empty-icon">📦</div><p>No listings submitted yet. Use "+ Submit New Waste" above.</p>' +
        '</td></tr>';
      return;
    }

    var html = '';
    listings.forEach(function (l) {
      var statusClass = 'badge-listed';
      if (l.listingStatus === 'MATCHED') statusClass = 'badge-matched';
      if (l.listingStatus === 'COLLECTED') statusClass = 'badge-collected';

      var date = l.createdAt ? new Date(l.createdAt).toLocaleDateString() : '—';
      var interestCount = l.interestCount || (l.interests ? l.interests.length : 0);
      var interestLabel = interestCount > 0
        ? '<span class="badge" style="background:var(--mint);color:var(--green-900);font-weight:600">' + interestCount + ' Interested</span>'
        : '<span style="color:var(--text-secondary);font-size:0.8rem">0 offers</span>';

      html += '<tr>' +
        '<td><strong>' + EcoApp.escapeHtml(l.listingId) + '</strong></td>' +
        '<td>' + EcoApp.escapeHtml(l.materialCategory) + '</td>' +
        '<td>' + l.quantity + ' ' + EcoApp.escapeHtml(l.unit) + '</td>' +
        '<td>' + EcoApp.escapeHtml(l.locationArea) + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + EcoApp.escapeHtml(l.listingStatus) + '</span></td>' +
        '<td>' + interestLabel + '</td>' +
        '<td>' + date + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderMatches(listings) {
    var container = document.getElementById('matches-container');
    if (!listings.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>Submit a listing to view matching verified buyers.</p></div>';
      return;
    }

    var latest = listings[listings.length - 1];
    fetch('/api/listings/' + encodeURIComponent(latest.listingId) + '/matches', {
      headers: EcoApp.authHeaders()
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var matches = data.eligibleMatches || [];
        var isDemo = data.isDemoData === true;

        if (matches.length === 0) {
          container.innerHTML = '<div class="empty-state" style="padding:28px 16px">' +
            '<div class="empty-icon" style="font-size:2.2rem">🔍</div>' +
            '<h4 style="margin-bottom:6px">No verified buyers match this listing yet</h4>' +
            '<p style="color:var(--text-secondary);font-size:0.88rem;max-width:500px;margin:0 auto 12px">' +
            'Your listing is active in the marketplace. When an authorized recycler matching your material (' +
            EcoApp.escapeHtml(latest.materialCategory) + ') and quantity (' + latest.quantity + ' kg) registers preferences, their offer will appear here.' +
            '</p>' +
            '</div>';
          return;
        }

        var headerHtml = '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">' +
          'Showing matches for <strong>' + EcoApp.escapeHtml(latest.listingId) + '</strong> (' +
          latest.quantity + ' kg, ' + EcoApp.escapeHtml(latest.locationArea) + ')' +
          (isDemo ? ' &middot; <span class="badge badge-demo">Demo Simulation Data</span>' : ' &middot; <span class="badge" style="background:var(--mint);color:var(--green-900)">Verified Marketplace Buyers</span>') +
          '</p>';

        var cardsHtml = '';
        matches.forEach(function (m) {
          cardsHtml += renderMatchCard(m, true);
        });

        container.innerHTML = headerHtml + cardsHtml;
      })
      .catch(function () {
        container.innerHTML = '<p style="color:var(--text-secondary)">Could not load matches.</p>';
      });
  }

  function renderMatchCard(match, eligible) {
    var scoreClass = eligible ? '' : ' ineligible';
    var dataBadge = match.isDemoData
      ? '<span class="badge badge-demo">Demo Sample</span>'
      : '<span class="badge" style="background:var(--mint);color:var(--green-900)">Verified Buyer</span>';

    return '<div class="match-card">' +
      '<div class="match-card-header">' +
        '<div>' +
          '<h4>' + EcoApp.escapeHtml(match.displayName) + ' ' + dataBadge + '</h4>' +
          '<p class="match-label">' + EcoApp.escapeHtml(match.dataLabel) + '</p>' +
        '</div>' +
        '<span class="match-score' + scoreClass + '">' + match.totalScore + '/100</span>' +
      '</div>' +
      '<p class="match-meta">' +
        'Areas: ' + EcoApp.escapeHtml((match.supportedAreas || []).join(', ')) +
        ' &middot; Capacity: ' + (match.quantityRangeKg ? match.quantityRangeKg.min : '?') + '–' +
        (match.quantityRangeKg ? match.quantityRangeKg.max : '?') + ' kg' +
        ' &middot; Demand: ' + EcoApp.escapeHtml(match.demandLevel || 'medium') +
      '</p>' +
      '</div>';
  }

  // ── BUYER VIEW LOGIC ───────────────────────────────────────────────

  function loadBuyerData() {
    loadBuyerPreferences();
    loadMarketplaceFeed();
  }

  function loadBuyerPreferences() {
    var form = document.getElementById('buyer-pref-form');
    var badge = document.getElementById('buyer-verification-badge');

    fetch('/api/buyer/preferences', { headers: EcoApp.authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var isVerified = data.isVerified === true;
        if (isVerified) {
          badge.textContent = 'Verified Recycler (Active in Matching)';
          badge.style.background = 'var(--mint)';
          badge.style.color = 'var(--green-900)';
        } else {
          badge.textContent = 'Verification Pending (Administrator Review)';
          badge.style.background = '#ED8936';
          badge.style.color = '#FFF';
        }

        if (data.preferences) {
          var p = data.preferences;
          if (document.getElementById('buyer-display-name')) document.getElementById('buyer-display-name').value = p.displayName || '';
          if (document.getElementById('buyer-demand-level')) document.getElementById('buyer-demand-level').value = p.demandLevel || 'medium';
          if (document.getElementById('buyer-min-qty')) document.getElementById('buyer-min-qty').value = p.minQuantityKg || '';
          if (document.getElementById('buyer-max-qty')) document.getElementById('buyer-max-qty').value = p.maxQuantityKg || '';
          if (document.getElementById('buyer-areas')) document.getElementById('buyer-areas').value = (p.supportedAreas || []).join(', ');
        }
      })
      .catch(function () {});

    // Handle form submit
    form.onsubmit = function (e) {
      e.preventDefault();
      var alertBox = document.getElementById('buyer-pref-alert');

      var payload = {
        displayName: document.getElementById('buyer-display-name').value.trim(),
        demandLevel: document.getElementById('buyer-demand-level').value,
        minQuantityKg: Number(document.getElementById('buyer-min-qty').value) || 0,
        maxQuantityKg: Number(document.getElementById('buyer-max-qty').value) || 1000,
        supportedAreas: document.getElementById('buyer-areas').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        acceptedMaterials: ['PET']
      };

      fetch('/api/buyer/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...EcoApp.authHeaders()
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          alertBox.textContent = result.message || 'Purchasing preferences saved successfully.';
          alertBox.className = 'alert alert-success';
          alertBox.style.display = 'block';
          setTimeout(function () { alertBox.style.display = 'none'; }, 4000);
        })
        .catch(function () {
          alertBox.textContent = 'Error saving preferences.';
          alertBox.className = 'alert alert-error';
          alertBox.style.display = 'block';
        });
    };
  }

  function loadMarketplaceFeed() {
    var tbody = document.getElementById('buyer-listings-body');
    fetch('/api/listings', { headers: EcoApp.authHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var listings = data.listings || [];
        var activeListings = listings.filter(function (l) { return l.listingStatus === 'LISTED'; });

        if (!activeListings.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">' +
            '<div class="empty-icon">📦</div><p>No active listings waiting for collection right now.</p>' +
            '</td></tr>';
          return;
        }

        var html = '';
        activeListings.forEach(function (l) {
          var alreadyExpressed = l.interests && l.interests.some(function (i) {
            return i.recyclerId === user.id || i.recyclerEmail === user.email;
          });

          var actionBtn = alreadyExpressed
            ? '<span class="badge" style="background:var(--mint);color:var(--green-900)">Interest Sent ✓</span>'
            : '<button class="btn btn-sm btn-primary express-interest-btn" data-id="' + EcoApp.escapeHtml(l.listingId) + '">Express Interest</button>';

          html += '<tr>' +
            '<td><strong>' + EcoApp.escapeHtml(l.listingId) + '</strong></td>' +
            '<td>' + EcoApp.escapeHtml(l.materialCategory) + '</td>' +
            '<td>' + l.quantity + ' ' + EcoApp.escapeHtml(l.unit) + '</td>' +
            '<td>' + EcoApp.escapeHtml(l.locationArea) + '</td>' +
            '<td><span class="badge badge-listed">' + EcoApp.escapeHtml(l.condition) + '</span></td>' +
            '<td><span class="badge badge-listed">Available</span></td>' +
            '<td>' + actionBtn + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = html;

        // Attach event listeners to Express Interest buttons
        tbody.querySelectorAll('.express-interest-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var listingId = btn.getAttribute('data-id');
            btn.disabled = true;
            btn.textContent = 'Sending...';

            fetch('/api/listings/' + encodeURIComponent(listingId) + '/express-interest', {
              method: 'POST',
              headers: EcoApp.authHeaders()
            })
              .then(function (res) { return res.json(); })
              .then(function () {
                btn.outerHTML = '<span class="badge" style="background:var(--mint);color:var(--green-900)">Interest Sent ✓</span>';
              })
              .catch(function () {
                btn.disabled = false;
                btn.textContent = 'Express Interest';
                alert('Could not record interest.');
              });
          });
        });
      })
      .catch(function () {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Could not load marketplace feed.</p></td></tr>';
      });
  }
})();
