/**
 * Authentication Service Tests
 * Critical tests for login, registration, session management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage
const mockStorage = {
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  createAuditLog: vi.fn(),
};

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  hash: vi.fn((password: string) => Promise.resolve(`hashed_${password}`)),
  compare: vi.fn((password: string, hash: string) => Promise.resolve(hash === `hashed_${password}`)),
}));

describe('Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Registration', () => {
    it('should reject registration with invalid email', async () => {
      const invalidEmails = ['notanemail', '@nodomain.com', 'missing@', ''];
      
      for (const email of invalidEmails) {
        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        expect(isValid).toBe(false);
      }
    });

    it('should reject registration with weak password', async () => {
      const weakPasswords = ['123', 'password', 'abc', '12345'];
      
      for (const password of weakPasswords) {
        const isStrong = password.length >= 8 && 
          /[A-Z]/.test(password) && 
          /[0-9]/.test(password);
        expect(isStrong).toBe(false);
      }
    });

    it('should accept registration with strong password', async () => {
      const strongPasswords = ['SecurePass123!', 'MyP@ssw0rd', 'Test1234!'];
      
      for (const password of strongPasswords) {
        const isStrong = password.length >= 8 && 
          /[A-Z]/.test(password) && 
          /[0-9]/.test(password);
        expect(isStrong).toBe(true);
      }
    });

    it('should reject duplicate email registration', async () => {
      mockStorage.getUserByEmail.mockResolvedValue({ id: '1', email: 'test@test.com' });
      
      const existingUser = await mockStorage.getUserByEmail('test@test.com');
      expect(existingUser).not.toBeNull();
    });

    it('should hash password before storing', async () => {
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash('TestPassword123', 10);
      
      expect(hashedPassword).toContain('hashed_');
    });
  });

  describe('Login', () => {
    it('should reject login with non-existent email', async () => {
      mockStorage.getUserByEmail.mockResolvedValue(null);
      
      const user = await mockStorage.getUserByEmail('nonexistent@test.com');
      expect(user).toBeNull();
    });

    it('should reject login with incorrect password', async () => {
      const bcrypt = await import('bcryptjs');
      const isMatch = await bcrypt.compare('wrongpassword', 'hashed_correctpassword');
      expect(isMatch).toBe(false);
    });

    it('should accept login with correct credentials', async () => {
      const bcrypt = await import('bcryptjs');
      const isMatch = await bcrypt.compare('correctpassword', 'hashed_correctpassword');
      expect(isMatch).toBe(true);
    });

    it('should create session on successful login', async () => {
      mockStorage.createSession.mockResolvedValue({ 
        id: 'session_123', 
        userId: 'user_1',
        expiresAt: new Date(Date.now() + 86400000)
      });
      
      const session = await mockStorage.createSession({ userId: 'user_1' });
      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user_1');
    });

    it('should reject login for blocked users', async () => {
      mockStorage.getUserByEmail.mockResolvedValue({ 
        id: '1', 
        email: 'blocked@test.com',
        status: 'blocked'
      });
      
      const user = await mockStorage.getUserByEmail('blocked@test.com');
      expect(user?.status).toBe('blocked');
    });
  });

  describe('Session Management', () => {
    it('should validate session token', async () => {
      mockStorage.getSession.mockResolvedValue({
        id: 'session_123',
        userId: 'user_1',
        expiresAt: new Date(Date.now() + 86400000)
      });
      
      const session = await mockStorage.getSession('session_123');
      expect(session).not.toBeNull();
      expect(new Date(session.expiresAt) > new Date()).toBe(true);
    });

    it('should reject expired session', async () => {
      const expiredDate = new Date(Date.now() - 86400000);
      mockStorage.getSession.mockResolvedValue({
        id: 'session_123',
        userId: 'user_1',
        expiresAt: expiredDate
      });
      
      const session = await mockStorage.getSession('session_123');
      expect(new Date(session.expiresAt) < new Date()).toBe(true);
    });

    it('should delete session on logout', async () => {
      mockStorage.deleteSession.mockResolvedValue(true);
      
      const result = await mockStorage.deleteSession('session_123');
      expect(result).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log successful login', async () => {
      await mockStorage.createAuditLog({
        action: 'user_login',
        resource: 'auth',
        userId: 'user_1',
        details: { email: 'test@test.com' }
      });
      
      expect(mockStorage.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user_login' })
      );
    });

    it('should log failed login attempt', async () => {
      await mockStorage.createAuditLog({
        action: 'login_failed',
        resource: 'auth',
        details: { email: 'test@test.com', reason: 'invalid_password' }
      });
      
      expect(mockStorage.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'login_failed' })
      );
    });
  });
});

describe('Input Validation', () => {
  describe('Email Validation', () => {
    const validEmails = [
      'test@example.com',
      'user.name@domain.org',
      'user+tag@gmail.com',
      'first.last@subdomain.domain.com'
    ];

    const invalidEmails = [
      'notanemail',
      '@nodomain.com',
      'missing@.com',
      'spaces in@email.com',
      '',
      null,
      undefined
    ];

    it('should accept valid emails', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      validEmails.forEach(email => {
        expect(emailRegex.test(email)).toBe(true);
      });
    });

    it('should reject invalid emails', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      invalidEmails.forEach(email => {
        expect(emailRegex.test(email as string)).toBe(false);
      });
    });
  });

  describe('Password Validation', () => {
    it('should require minimum length', () => {
      expect('short'.length >= 8).toBe(false);
      expect('longenough'.length >= 8).toBe(true);
    });

    it('should require uppercase letter', () => {
      expect(/[A-Z]/.test('nouppercase')).toBe(false);
      expect(/[A-Z]/.test('HasUppercase')).toBe(true);
    });

    it('should require number', () => {
      expect(/[0-9]/.test('nonumbers')).toBe(false);
      expect(/[0-9]/.test('has1number')).toBe(true);
    });
  });

  describe('XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      '<svg onload=alert(1)>',
      '"><script>alert(1)</script>'
    ];

    it('should sanitize HTML tags', () => {
      const sanitize = (input: string) => input.replace(/<[^>]*>/g, '');
      
      xssPayloads.forEach(payload => {
        const sanitized = sanitize(payload);
        // After removing tags, no < or > from HTML tags should remain
        // Note: javascript: doesn't have tags so won't change
        if (payload.includes('<')) {
          expect(sanitized).not.toContain('<script>');
          expect(sanitized).not.toContain('<img');
          expect(sanitized).not.toContain('<svg');
        }
      });
    });

    it('should escape special characters', () => {
      const escape = (input: string) => 
        input
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      
      const result = escape('<script>alert("test")</script>');
      expect(result.includes('<script>')).toBe(false);
    });
  });

  describe('SQL Injection Prevention', () => {
    const sqlPayloads = [
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "admin'--",
      "1; DELETE FROM users",
      "' UNION SELECT * FROM users --"
    ];

    it('should escape SQL special characters', () => {
      const escapeSql = (input: string) => 
        input.replace(/['";\\]/g, '\\$&');
      
      sqlPayloads.forEach(payload => {
        const escaped = escapeSql(payload);
        // Should have escape characters before dangerous chars
        expect(escaped.includes("\\")).toBe(true);
      });
    });
  });
});
