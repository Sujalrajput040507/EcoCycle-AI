/**
 * EcoCycle AI — Authentication Service Module
 *
 * Handles account registration, credential verification, and user management.
 *
 * Password Security:
 * - Uses bcrypt with a salt work factor of 10.
 * - Minimum password length: 15 characters (OWASP passphrase recommendation).
 * - Maximum password length: 128 characters (DoS prevention).
 * - Never trims, logs, or exposes plaintext passwords or password hashes.
 *
 * Email Security:
 * - Normalizes emails to lowercase and trimmed string.
 * - Enforces uniqueness constraint at database level.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { defaultDb } = require('./db');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 100;

// Standard RFC 5322 compatible email format check
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

class AuthService {
  constructor(database = defaultDb) {
    this.db = database;
  }

  /**
   * Normalizes an email address safely.
   */
  normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  /**
   * Validates registration input fields.
   */
  validateRegistrationInput({ name, email, password, role, phone, user_type, city, state, address, category }) {
    // 1. Name validation
    if (typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, error: 'Full name is required.' };
    }
    const cleanName = name.trim();
    if (cleanName.length > MAX_NAME_LENGTH) {
      return { valid: false, error: `Name cannot exceed ${MAX_NAME_LENGTH} characters.` };
    }

    // 2. Email validation
    if (typeof email !== 'string' || email.trim().length === 0) {
      return { valid: false, error: 'Email address is required.' };
    }
    const cleanEmail = this.normalizeEmail(email);
    if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(cleanEmail)) {
      return { valid: false, error: 'Please enter a valid email address.' };
    }

    // 3. Password validation (strict length, no trimming)
    if (typeof password !== 'string') {
      return { valid: false, error: 'Password must be a string.' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        valid: false,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long. A memorable passphrase is recommended.`
      };
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return {
        valid: false,
        error: `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters.`
      };
    }

    // 4. Role validation
    let cleanRole = 'SELLER';
    if (role && typeof role === 'string') {
      const upper = role.trim().toUpperCase();
      if (upper === 'BUYER' || upper === 'SELLER') {
        cleanRole = upper;
      }
    }

    return {
      valid: true,
      cleanName,
      cleanEmail,
      cleanRole,
      cleanPhone: typeof phone === 'string' ? phone.trim().substring(0, 30) : null,
      cleanUserType: typeof user_type === 'string' ? user_type.trim().substring(0, 50) : null,
      cleanCity: typeof city === 'string' ? city.trim().substring(0, 60) : null,
      cleanState: typeof state === 'string' ? state.trim().substring(0, 60) : null,
      cleanAddress: typeof address === 'string' ? address.trim().substring(0, 200) : null,
      cleanCategory: typeof category === 'string' ? category.trim().substring(0, 60) : null
    };
  }

  /**
   * Validates login input fields.
   */
  validateLoginInput({ email, password }) {
    if (typeof email !== 'string' || email.trim().length === 0) {
      return { valid: false, error: 'Email address is required.' };
    }
    const cleanEmail = this.normalizeEmail(email);
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return { valid: false, error: 'Please enter a valid email address.' };
    }

    if (typeof password !== 'string' || password.length === 0) {
      return { valid: false, error: 'Password is required.' };
    }

    return { valid: true, cleanEmail };
  }

  /**
   * Hashes a password using bcrypt.
   */
  async hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /**
   * Compares a plaintext password against a stored bcrypt hash.
   */
  async verifyPassword(password, hash) {
    if (!hash || typeof hash !== 'string') return false;
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  /**
   * Strips sensitive internal fields, returning a clean user profile.
   */
  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email_normalized,
      role: (user.role || 'SELLER').toUpperCase(),
      phone: user.phone || null,
      user_type: user.user_type || null,
      city: user.city || null,
      state: user.state || null,
      address: user.address || null,
      category: user.category || null,
      preferred_materials: user.preferred_materials || null,
      purchasing_capacity: user.purchasing_capacity != null ? Number(user.purchasing_capacity) : null,
      collection_radius: user.collection_radius != null ? Number(user.collection_radius) : null,
      preferences_json: user.preferences_json || null,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  }

  /**
   * Registers a new user account.
   */
  async register(registrationData) {
    const validation = this.validateRegistrationInput(registrationData);
    if (!validation.valid) {
      return { success: false, status: 400, code: 'VALIDATION_ERROR', error: validation.error };
    }

    const {
      cleanName, cleanEmail, cleanRole, cleanPhone, cleanUserType,
      cleanCity, cleanState, cleanAddress, cleanCategory
    } = validation;

    // Check email uniqueness
    const existing = this.db.findUserByEmail(cleanEmail);
    if (existing) {
      return {
        success: false,
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'An account with this email address already exists.'
      };
    }

    // Securely hash password with bcrypt
    const passwordHash = await this.hashPassword(registrationData.password);
    const userId = `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    try {
      const created = this.db.createUser({
        id: userId,
        name: cleanName,
        email_normalized: cleanEmail,
        password_hash: passwordHash,
        created_at: now,
        updated_at: now,
        role: cleanRole,
        phone: cleanPhone,
        user_type: cleanUserType,
        city: cleanCity,
        state: cleanState,
        address: cleanAddress,
        category: cleanCategory,
        preferred_materials: registrationData.preferred_materials || null,
        purchasing_capacity: registrationData.purchasing_capacity != null ? Number(registrationData.purchasing_capacity) : null,
        collection_radius: registrationData.collection_radius != null ? Number(registrationData.collection_radius) : null,
        preferences_json: registrationData.preferences_json || null
      });

      return {
        success: true,
        status: 201,
        user: this.sanitizeUser(created)
      };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return {
          success: false,
          status: 409,
          code: 'EMAIL_ALREADY_EXISTS',
          error: 'An account with this email address already exists.'
        };
      }
      return {
        success: false,
        status: 500,
        code: 'REGISTRATION_FAILED',
        error: 'Registration failed due to a database error.'
      };
    }
  }

  /**
   * Generates a password reset token for a valid account.
   */
  async forgotPassword(email) {
    const cleanEmail = this.normalizeEmail(email);
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return { success: false, status: 400, error: 'Valid email address required.' };
    }

    const user = this.db.findUserByEmail(cleanEmail);
    if (!user) {
      // Return success anyway to prevent user enumeration
      return {
        success: true,
        status: 200,
        message: 'If the email exists, a password reset token has been staged.'
      };
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expire = Date.now() + 60 * 60 * 1000; // 1 hour
    this.db.setPasswordResetToken(cleanEmail, token, expire);

    return {
      success: true,
      status: 200,
      reset_token: token,
      message: 'Password reset token generated successfully. Valid for 1 hour.'
    };
  }

  /**
   * Resets password using a verified token.
   */
  async resetPassword({ token, new_password }) {
    if (!token || typeof token !== 'string') {
      return { success: false, status: 400, error: 'Reset token is required.' };
    }
    if (!new_password || typeof new_password !== 'string') {
      return { success: false, status: 400, error: 'New password is required.' };
    }
    if (new_password.length < MIN_PASSWORD_LENGTH) {
      return {
        success: false,
        status: 400,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
      };
    }

    const user = this.db.findUserByResetToken(token);
    if (!user) {
      return { success: false, status: 400, error: 'Invalid or expired password reset token.' };
    }

    const newHash = await this.hashPassword(new_password);
    this.db.updateUserPassword(user.id, newHash);

    return {
      success: true,
      status: 200,
      message: 'Password has been reset successfully. Please log in with your new credentials.'
    };
  }

  /**
   * Updates user profile fields safely.
   */
  async updateProfile(userId, profileData) {
    if (!userId) return null;
    const updated = this.db.updateUserProfile(userId, profileData);
    return this.sanitizeUser(updated);
  }

  /**
   * Authenticates user credentials.
   * Returns generic INVALID_CREDENTIALS error on any mismatch to prevent account enumeration.
   */
  async login({ email, password }) {
    const validation = this.validateLoginInput({ email, password });
    if (!validation.valid) {
      return { success: false, status: 400, code: 'VALIDATION_ERROR', error: validation.error };
    }

    const { cleanEmail } = validation;
    const user = this.db.findUserByEmail(cleanEmail);

    if (!user) {
      // Simulate comparison to mitigate timing attacks against non-existent accounts
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUU0123456789');
      return {
        success: false,
        status: 401,
        code: 'INVALID_CREDENTIALS',
        error: 'Invalid email address or password.'
      };
    }

    const matches = await this.verifyPassword(password, user.password_hash);
    if (!matches) {
      return {
        success: false,
        status: 401,
        code: 'INVALID_CREDENTIALS',
        error: 'Invalid email address or password.'
      };
    }

    return {
      success: true,
      status: 200,
      user: this.sanitizeUser(user)
    };
  }

  /**
   * Looks up a user by ID and returns sanitized profile.
   */
  getUserById(id) {
    if (!id || typeof id !== 'string') return null;
    const user = this.db.findUserById(id);
    return this.sanitizeUser(user);
  }
}

// Default singleton instance
const defaultAuthService = new AuthService(defaultDb);

module.exports = {
  AuthService,
  defaultAuthService,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH
};

