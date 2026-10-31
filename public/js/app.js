'use strict';

/**
 * Shared app logic: auth state, navigation rendering.
 * Reads token from localStorage; does NOT handle login form (login.js does that).
 */

var EcoApp = (function () {
  var TOKEN_KEY = 'ecocycle_token';
  var USER_KEY = 'ecocycle_user';

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

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function logout() {
    clearSession();
    window.location.href = '/login.html';
  }

  function authHeaders() {
    var token = getToken();
    if (!token) return {};
    return { 'Authorization': 'Bearer ' + token };
  }

  function renderNav() {
    var nav = document.getElementById('nav-links');
    if (!nav) return;

    var user = getUser();
    var html = '';

    if (!user) {
      html += '<a href="/">Home</a>';
      html += '<a href="/login.html" class="btn btn-sm btn-primary">Login</a>';
    } else if (user.role === 'user') {
      html += '<a href="/dashboard.html">Dashboard</a>';
      html += '<a href="/submit.html">Submit Waste</a>';
      html += '<span style="font-size:0.85rem;color:var(--text-secondary);padding:0 8px">' + user.name + '</span>';
      html += '<button class="btn btn-sm btn-ghost" onclick="EcoApp.logout()">Logout</button>';
    } else if (user.role === 'recycler') {
      html += '<a href="/dashboard.html">Dashboard</a>';
      html += '<span style="font-size:0.85rem;color:var(--text-secondary);padding:0 8px">' + user.name + '</span>';
      html += '<button class="btn btn-sm btn-ghost" onclick="EcoApp.logout()">Logout</button>';
    } else if (user.role === 'admin') {
      html += '<a href="/dashboard.html">Dashboard</a>';
      html += '<span style="font-size:0.85rem;color:var(--text-secondary);padding:0 8px">' + user.name + ' (Admin)</span>';
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
    if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
      window.location.href = '/dashboard.html';
      return null;
    }
    return user;
  }

  // Run nav on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }

  return {
    getUser: getUser,
    getToken: getToken,
    saveSession: saveSession,
    clearSession: clearSession,
    logout: logout,
    authHeaders: authHeaders,
    renderNav: renderNav,
    requireAuth: requireAuth
  };
})();

