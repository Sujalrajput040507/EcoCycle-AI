'use strict';

/**
 * Shared app logic: auth state, navigation rendering, session management.
 * Works with both Supabase JWT sessions and demo accounts.
 */

var EcoApp = (function () {
  var TOKEN_KEY = 'ecocycle_token';
  var USER_KEY = 'ecocycle_user';
  var REFRESH_KEY = 'ecocycle_refresh_token';
  var EXPIRES_KEY = 'ecocycle_expires_at';

  function getUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function getRefreshToken() {
    return localStorage.getItem(REFRESH_KEY) || '';
  }

  function saveSession(token, user, refreshToken, expiresAt) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    if (expiresAt) localStorage.setItem(EXPIRES_KEY, String(expiresAt));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  }

  function logout() {
    var headers = authHeaders();
    clearSession();
    fetch('/api/auth/logout', { method: 'POST', headers: headers }).catch(function () {});
    window.location.href = '/login.html';
  }

  function authHeaders() {
    var token = getToken();
    if (!token) return {};
    return { 'Authorization': 'Bearer ' + token };
  }

  // Format meaningful, professional role labels
  function formatRole(role) {
    if (!role) return 'Industrial Waste Generator';
    var r = String(role).toLowerCase();
    if (r === 'admin' || r === 'administrator') return 'Administrator';
    if (r === 'recycler') return 'Recycler';
    if (r === 'generator' || r === 'user') return 'Industrial Waste Generator';
    return role;
  }

  // Refresh token helper using official Supabase refresh session endpoint
  function refreshSessionIfNeeded() {
    var token = getToken();
    var refreshToken = getRefreshToken();
    var expiresAt = parseInt(localStorage.getItem(EXPIRES_KEY) || '0', 10);

    // Only refresh Supabase sessions with a refresh token
    if (!token || !refreshToken || token.startsWith('tok-')) {
      return Promise.resolve(getUser());
    }

    var now = Math.floor(Date.now() / 1000);
    // If token expires within 60 seconds or has expired
    if (expiresAt && (expiresAt - now < 60)) {
      return fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.token && data.user) {
            saveSession(data.token, data.user, data.refreshToken, data.expiresAt);
            renderNav();
            return data.user;
          }
          return getUser();
        })
        .catch(function () {
          return getUser();
        });
    }

    return Promise.resolve(getUser());
  }

  function renderNav() {
    var nav = document.getElementById('nav-links');
    if (!nav) return;

    var user = getUser();
    var html = '';

    if (!user) {
      html += '<a href="/">Home</a>';
      html += '<a href="/login.html" class="btn btn-sm btn-primary">Login / Register</a>';
    } else {
      var role = user.role || 'generator';
      var roleTitle = formatRole(role);
      var displayName = user.name || user.email;

      html += '<a href="/dashboard.html">Dashboard</a>';
      if (role === 'user' || role === 'generator' || role === 'admin') {
        html += '<a href="/submit.html">Submit Waste</a>';
      }
      html += '<span style="font-size:0.85rem;color:var(--text-secondary);padding:0 8px">' +
        escapeHtml(displayName) + ' <small style="color:var(--green-700);font-weight:600">(' + escapeHtml(roleTitle) + ')</small></span>';
      html += '<button class="btn btn-sm btn-ghost" onclick="EcoApp.logout()">Logout</button>';
    }

    nav.innerHTML = html;

    // Highlight current page
    var current = window.location.pathname;
    var links = nav.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === current) {
        links[i].classList.add('active');
      }
    }
  }

  function requireAuth(allowedRoles) {
    var user = getUser();
    if (!user) {
      window.location.href = '/login.html';
      return null;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      var userRole = user.role || 'generator';
      // Normalize 'user' and 'generator'
      var normalizedAllowed = allowedRoles.map(function (r) {
        return r === 'user' ? 'generator' : r;
      });
      var normalizedUserRole = userRole === 'user' ? 'generator' : userRole;

      if (normalizedAllowed.indexOf(normalizedUserRole) === -1) {
        window.location.href = '/dashboard.html';
        return null;
      }
    }

    return user;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initialize and verify session on load
  function init() {
    renderNav();
    var token = getToken();
    if (token) {
      refreshSessionIfNeeded().then(function () {
        fetch('/api/auth/me', { headers: authHeaders() })
          .then(function (res) {
            if (res.status === 401) {
              clearSession();
              var path = window.location.pathname;
              if (path === '/dashboard.html' || path === '/submit.html') {
                window.location.href = '/login.html';
              }
            } else if (res.ok) {
              return res.json().then(function (data) {
                if (data.user) {
                  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
                  renderNav();
                }
              });
            }
          })
          .catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    getUser: getUser,
    getToken: getToken,
    getRefreshToken: getRefreshToken,
    saveSession: saveSession,
    clearSession: clearSession,
    logout: logout,
    authHeaders: authHeaders,
    renderNav: renderNav,
    requireAuth: requireAuth,
    formatRole: formatRole,
    escapeHtml: escapeHtml
  };
})();
