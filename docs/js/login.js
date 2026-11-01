'use strict';

/**
 * Login & Registration page handler.
 * Supports Supabase Auth (email/password) and Demo Accounts.
 */

(function () {
  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');
  var errorBox = document.getElementById('login-error');
  var successBox = document.getElementById('login-success');
  var tabLogin = document.getElementById('tab-login');
  var tabRegister = document.getElementById('tab-register');
  var authHeading = document.getElementById('auth-heading');
  var authSubheading = document.getElementById('auth-subheading');
  var demoBox = document.getElementById('demo-credentials-box');

  // If already logged in, redirect to dashboard
  if (EcoApp.getUser()) {
    window.location.href = '/dashboard.html';
    return;
  }

  // Tab switching
  tabLogin.addEventListener('click', function () {
    switchMode('login');
  });

  tabRegister.addEventListener('click', function () {
    switchMode('register');
  });

  function switchMode(mode) {
    hideMessages();
    if (mode === 'login') {
      tabLogin.style.borderBottomColor = 'var(--green-700)';
      tabLogin.style.color = 'var(--text)';
      tabLogin.style.fontWeight = '700';

      tabRegister.style.borderBottomColor = 'transparent';
      tabRegister.style.color = 'var(--text-secondary)';
      tabRegister.style.fontWeight = 'normal';

      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
      demoBox.style.display = 'block';

      authHeading.textContent = 'Welcome back';
      authSubheading.textContent = 'Sign in to your account';
    } else {
      tabRegister.style.borderBottomColor = 'var(--green-700)';
      tabRegister.style.color = 'var(--text)';
      tabRegister.style.fontWeight = '700';

      tabLogin.style.borderBottomColor = 'transparent';
      tabLogin.style.color = 'var(--text-secondary)';
      tabLogin.style.fontWeight = 'normal';

      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      demoBox.style.display = 'none';

      authHeading.textContent = 'Create an Account';
      authSubheading.textContent = 'Join the EcoCycle AI circular exchange';
    }
  }

  // 1-Click Demo Fill
  var demoBtns = document.querySelectorAll('.demo-fill-btn');
  demoBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      hideMessages();
      switchMode('login');
      document.getElementById('email').value = btn.getAttribute('data-email');
      document.getElementById('password').value = btn.getAttribute('data-pass');
    });
  });

  // Sign In Submission
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!email || !password) {
      showError('Please enter both email and password.');
      return;
    }

    var submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (result) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';

        if (!result.ok) {
          showError(result.body.error || 'Login failed. Please check your credentials.');
          return;
        }

        EcoApp.saveSession(
          result.body.token,
          result.body.user,
          result.body.refreshToken,
          result.body.expiresAt
        );

        window.location.href = '/dashboard.html';
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
        showError('Could not reach the server. Please check your connection.');
      });
  });

  // Register Submission
  registerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    var fullName = document.getElementById('reg-fullname').value.trim();
    var email = document.getElementById('reg-email').value.trim();
    var password = document.getElementById('reg-password').value;
    var role = document.getElementById('reg-role').value;

    if (!fullName || fullName.length < 2) {
      showError('Please provide a full name or organization name (at least 2 characters).');
      return;
    }

    if (!email || !email.includes('@') || !email.includes('.')) {
      showError('Please provide a valid email address.');
      return;
    }

    if (!password || password.length < 6) {
      showError('Password must be at least 6 characters long.');
      return;
    }

    var submitBtn = registerForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: fullName,
        email: email,
        password: password,
        role: role
      })
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (result) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';

        if (!result.ok) {
          showError(result.body.error || 'Registration failed.');
          return;
        }

        // If a session token was returned directly
        if (result.body.token) {
          EcoApp.saveSession(
            result.body.token,
            result.body.user,
            result.body.refreshToken,
            result.body.expiresAt
          );
          window.location.href = '/dashboard.html';
          return;
        }

        // If email confirmation is required or login needed
        switchMode('login');
        document.getElementById('email').value = email;
        document.getElementById('password').value = '';
        showSuccess(result.body.message || 'Account created successfully! Please sign in.');
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
        showError('Could not reach the server. Please check your connection.');
      });
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('visible');
    successBox.classList.remove('visible');
  }

  function showSuccess(msg) {
    successBox.textContent = msg;
    successBox.classList.add('visible');
    errorBox.classList.remove('visible');
  }

  function hideMessages() {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
    successBox.textContent = '';
    successBox.classList.remove('visible');
  }
})();
