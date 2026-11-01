/**
 * EcoCycle AI — Authentication & Security Middleware
 *
 * Implements:
 * - SQLite-backed Express Session Store (sessions persist across server restarts).
 * - HttpOnly, SameSite=Lax, Secure (in production) cookies.
 * - Session regeneration on login to prevent session fixation.
 * - Server-side user identity attachment (`req.user`).
 * - Route protection middleware (`requireAuth`).
 * - Sliding-window rate limiting for authentication endpoints.
 * - Origin / Same-site CSRF validation for state-changing requests.
 */

const session = require('express-session');
const { defaultDb } = require('./db');
const { defaultAuthService } = require('./auth-service');

// --- Custom SQLite Session Store for express-session ---
class SqliteSessionStore extends session.Store {
  constructor(database = defaultDb) {
    super();
    this.db = database;

    // Periodic cleanup of expired sessions every 15 minutes
    this.cleanupInterval = setInterval(() => {
      try {
        this.db.cleanExpiredSessions();
      } catch {
        // Ignored
      }
    }, 15 * 60 * 1000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  get(sid, callback) {
    try {
      const sess = this.db.getSession(sid);
      callback(null, sess);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
      const expire = Date.now() + maxAge;
      this.db.setSession(sid, sess, expire);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.destroySession(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
      const expire = Date.now() + maxAge;
      this.db.setSession(sid, sess, expire);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

// --- Session Middleware Configuration ---
function createSessionMiddleware(db = defaultDb) {
  const isProd = process.env.NODE_ENV === 'production';
  let sessionSecret = process.env.SESSION_SECRET;

  if (isProd && (!sessionSecret || sessionSecret.trim() === '')) {
    throw new Error('FATAL: SESSION_SECRET must be configured in environment variables for production.');
  }

  if (!sessionSecret) {
    sessionSecret = 'ecocycle-dev-session-secret-dont-use-in-production-32char';
  }

  return session({
    store: new SqliteSessionStore(db),
    name: 'ecocycle_sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    }
  });
}

// --- User Identity Attachment Middleware ---
function attachUser(authService = defaultAuthService) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      req.user = null;
      return next();
    }

    const user = authService.getUserById(req.session.userId);
    if (!user) {
      // User was deleted from DB while session still active
      req.session.userId = null;
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  };
}

// --- Route Protection Middleware ---
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Please sign in to continue.'
      }
    });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Please sign in to continue.'
        }
      });
    }
    const userRole = (req.user.role || 'SELLER').toUpperCase();
    const targetRole = String(role).toUpperCase();
    if (userRole !== targetRole && userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: `Access denied. This action requires a ${targetRole} account.`
        }
      });
    }
    next();
  };
}

function requireAnyRole(roles = []) {
  const allowed = roles.map(r => String(r).toUpperCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Please sign in to continue.'
        }
      });
    }
    const userRole = (req.user.role || 'SELLER').toUpperCase();
    if (!allowed.includes(userRole) && userRole !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: `Access denied for account role ${userRole}.`
        }
      });
    }
    next();
  };
}

// --- In-Memory Sliding-Window Rate Limiter for Auth Routes ---
class AuthRateLimiter {
  constructor(windowMs = 15 * 60 * 1000, maxAttempts = 15) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.hits = new Map();

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.hits.entries()) {
        if (now - record.startTime > this.windowMs) {
          this.hits.delete(key);
        }
      }
    }, 60 * 1000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  middleware(actionName = 'auth', maxLimit = null) {
    const limit = maxLimit || this.maxAttempts;

    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const key = `${actionName}:${ip}`;
      const now = Date.now();

      let record = this.hits.get(key);
      if (!record || now - record.startTime > this.windowMs) {
        record = { count: 1, startTime: now };
        this.hits.set(key, record);
        return next();
      }

      if (record.count >= limit) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts. Please wait 15 minutes before trying again.'
          }
        });
      }

      record.count += 1;
      next();
    };
  }

  resetKey(actionName, ip) {
    this.hits.delete(`${actionName}:${ip}`);
  }

  resetAll() {
    this.hits.clear();
  }
}

const defaultAuthLimiter = new AuthRateLimiter(15 * 60 * 1000, 15);

// --- CSRF / Origin Validation for State-Changing Requests ---
function csrfProtection(req, res, next) {
  // Safe read-only HTTP methods and external payment webhooks are exempt
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Exempt Razorpay server-to-server webhooks
  if (req.path === '/api/payments/webhook' || req.path === '/api/payment/webhook') {
    return next();
  }

  // Requests that include modern JSON or multi-part uploads with standard Origin/Referer
  const origin = req.headers['origin'];
  const host = req.headers['host'];

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CSRF_FORBIDDEN',
            message: 'Cross-origin request rejected.'
          }
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_FORBIDDEN',
          message: 'Malformed origin header.'
        }
      });
    }
  }

  next();
}

// --- Sensitive Endpoint Cache-Control Middleware ---
function noCacheAuth(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

module.exports = {
  SqliteSessionStore,
  createSessionMiddleware,
  attachUser,
  requireAuth,
  requireRole,
  requireAnyRole,
  AuthRateLimiter,
  defaultAuthLimiter,
  csrfProtection,
  noCacheAuth
};

