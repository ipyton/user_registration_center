const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./logger');

/**
 * Authentication utilities for JWT handling
 */
class Auth {
  /**
   * Generates a JWT token for a user
   * @param {string} userId - The user identifier
   * @param {Object} additionalClaims - Additional claims to include in the token
   * @param {number} expiresIn - Token expiration in seconds
   * @return {string} - The JWT token
   */
  static generateToken(userId, additionalClaims = {}, expiresIn = 86400) {
    const payload = {
      userId,
      ...additionalClaims,
    };
    
    return jwt.sign(payload, config.jwtSecret, { expiresIn });
  }

  /**
   * Verifies and decodes a JWT token
   * @param {string} token - The JWT token to verify
   * @return {Object|null} - Decoded token payload or null if invalid
   */
  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      return decoded;
    } catch (error) {
      logger.debug('Token verification failed', { error: error.message });
      return null;
    }
  }

  /**
   * Express middleware for JWT authentication
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  static authenticate(req, res, next) {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Missing or invalid token format' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = Auth.verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    
    // Attach user info to request
    req.user = decoded;
    next();
  }

  /**
   * Extract userId from a JWT token
   * @param {string} token - The JWT token
   * @return {string|null} - The userId or null if token is invalid
   */
  static extractUserId(token) {
    const decoded = this.verifyToken(token);
    return decoded ? decoded.userId : null;
  }

  /**
   * Extract a token from various request formats
   * @param {Object} req - Express request or WebSocket request
   * @return {string|null} - The extracted token or null if not found
   */
  static extractToken(req) {
    let token = null;
    
    // Extract from Authorization header
    if (req.headers && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }
    
    // Extract from query string (for WebSocket)
    if (!token && req.url) {
      const url = new URL(req.url, 'http://localhost');
      token = url.searchParams.get('token');
    }
    
    // Extract from cookies
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    
    return token;
  }
}

module.exports = Auth; 