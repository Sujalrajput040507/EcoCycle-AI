'use strict';

/**
 * Login page handler.
 * Posts credentials to /api/auth/login, stores session, redirects to dashboard.
 */

(function () {
  var form = document.getElementById('login-form');
  var errorBox = document.getElementById('login-error');

  // If already logged in, redirect
  if (EcoApp.getUser()) {
    window.location.href = '/dashboard.html';
    return;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();

    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!email || !password) {
      showError('Please enter both email and password.');
      return;
    }

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          showError(result.body.error || 'Login failed.');
          return;
        }
        EcoApp.saveSession(result.body.token, result.body.user);
        window.location.href = '/dashboard.html';
      })
      .catch(function () {
        showError('Could not reach the server.');
      });
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('visible');
  }

  function hideError() {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
  }
})();

