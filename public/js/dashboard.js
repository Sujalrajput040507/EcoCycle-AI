'use strict';

/**
 * Dashboard page logic.
 * Loads user info, listing stats, and recent listings from the API.
 */

(function () {
  var user = EcoApp.requireAuth();
  if (!user) return;

  var welcomeTitle = document.getElementById('welcome-title');
  var welcomeSub = document.getElementById('welcome-sub');
  var dashActions = document.getElementById('dash-actions');

  // Configure dashboard based on role
  if (user.role === 'user') {
    welcomeTitle.textContent = 'Welcome, ' + user.name;
    welcomeSub.textContent = 'Waste Generator Dashboard';
    dashActions.innerHTML = '<a href="/submit.html" class="btn btn-primary">+ Submit Waste</a>';
  } else if (user.role === 'recycler') {
    welcomeTitle.textContent = 'Welcome, ' + user.name;
    welcomeSub.textContent = 'Recycler Dashboard — Browse available waste listings';
    dashActions.innerHTML = '<span class="badge badge-demo">Demo Recycler</span>';
  } else if (user.role === 'admin') {
    welcomeTitle.textContent = 'Admin Dashboard';
    welcomeSub.textContent = 'Platform overview — all data shown is demo data';
    dashActions.innerHTML = '<span class="badge badge-demo">Admin View</span>';
  }

  // Load listings
  fetch('/api/listings', { headers: EcoApp.authHeaders() })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var listings = data.listings || [];
      renderStats(listings);
      renderListings(listings);
      renderMatches(listings);
    })
    .catch(function () {
      document.getElementById('stat-total').textContent = '–';
    });

  function renderStats(listings) {
    var total = listings.length;
    var matched = listings.filter(function (l) { return l.listingStatus === 'MATCHED'; }).length;
    var collected = listings.filter(function (l) { return l.listingStatus === 'COLLECTED'; }).length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-matched').textContent = matched;
    document.getElementById('stat-collected').textContent = collected;
  }

  function renderListings(listings) {
    var tbody = document.getElementById('listings-body');
    if (!listings.length) return; // keep empty state

    var html = '';
    listings.forEach(function (l) {
      var statusClass = 'badge-listed';
      if (l.listingStatus === 'MATCHED') statusClass = 'badge-matched';
      if (l.listingStatus === 'COLLECTED') statusClass = 'badge-collected';

      var date = l.createdAt ? new Date(l.createdAt).toLocaleString() : '—';
      html += '<tr>' +
        '<td><strong>' + l.listingId + '</strong></td>' +
        '<td>' + l.materialCategory + '</td>' +
        '<td>' + l.quantity + ' ' + l.unit + '</td>' +
        '<td>' + l.locationArea + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + l.listingStatus + '</span></td>' +
        '<td>' + date + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderMatches(listings) {
    var container = document.getElementById('matches-container');
    if (!listings.length) return;

    // Fetch matches for the most recent listing
    var latest = listings[listings.length - 1];
    fetch('/api/listings/' + encodeURIComponent(latest.listingId) + '/matches', {
      headers: EcoApp.authHeaders()
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.eligibleMatches || !data.eligibleMatches.length) {
          container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem">No eligible matches for the latest listing.</p>';
          return;
        }
        var html = '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px">' +
          'Showing matches for <strong>' + latest.listingId + '</strong> (' + latest.quantity + ' kg, ' + latest.locationArea + ')</p>';
        data.eligibleMatches.forEach(function (m) {
          html += renderMatchCard(m, true);
        });
        container.innerHTML = html;
      })
      .catch(function () {
        container.innerHTML = '<p style="color:var(--text-secondary)">Could not load matches.</p>';
      });
  }

  function renderMatchCard(match, eligible) {
    var scoreClass = eligible ? '' : ' ineligible';
    return '<div class="match-card">' +
      '<div class="match-card-header">' +
        '<h4>' + match.displayName + '</h4>' +
        '<span class="match-score' + scoreClass + '">' + match.totalScore + '/100</span>' +
      '</div>' +
      '<p class="match-label">' + match.dataLabel + '</p>' +
      '<p class="match-meta">' +
        'Areas: ' + match.supportedAreas.join(', ') +
        ' · Qty: ' + (match.quantityRangeKg.min || '?') + '–' + (match.quantityRangeKg.max || '?') + ' kg' +
        ' · Demand: ' + match.demandLevel +
      '</p>' +
      '</div>';
  }
})();

