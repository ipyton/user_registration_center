const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = new Redis(config.redisUrl);
    
    this.client.on('connect', () => {
      logger.info('Connected to Redis');
    });
    
    this.client.on('error', (err) => {
      logger.error('Redis error', { error: err.message });
    });
    
    // Keys with TTL
    this.VNODE_OWNERS_KEY = 'vnode:owners';  // Hash: vnodeId -> instanceId
    this.VNODE_LOAD_KEY = 'vnode:load';      // Hash: vnodeId -> onlineCount
    this.USER_INSTANCE_KEY_PREFIX = 'user:'; // String: userId -> instanceId
    
    // Default TTL in seconds
    this.DEFAULT_TTL = 60;
  }

  /**
   * Updates the vnode ownership mapping
   * @param {Object} vnodeMappings - Map of vnodeId to instanceId
   * @param {number} ttl - Time to live in seconds
   */
  async updateVnodeOwners(vnodeMappings, ttl = this.DEFAULT_TTL) {
    if (Object.keys(vnodeMappings).length === 0) return;
    
    const pipeline = this.client.pipeline();
    
    // Update vnode owners
    pipeline.hmset(this.VNODE_OWNERS_KEY, vnodeMappings);
    pipeline.expire(this.VNODE_OWNERS_KEY, ttl);
    
    await pipeline.exec();
    logger.debug(`Updated ${Object.keys(vnodeMappings).length} vnode ownerships with TTL ${ttl}s`);
  }

  /**
   * Updates the vnode load information
   * @param {Object} vnodeLoads - Map of vnodeId to load count
   * @param {number} ttl - Time to live in seconds
   */
  async updateVnodeLoads(vnodeLoads, ttl = this.DEFAULT_TTL) {
    if (Object.keys(vnodeLoads).length === 0) return;
    
    const pipeline = this.client.pipeline();
    
    // Update vnode load metrics
    pipeline.hmset(this.VNODE_LOAD_KEY, vnodeLoads);
    pipeline.expire(this.VNODE_LOAD_KEY, ttl);
    
    await pipeline.exec();
    logger.debug(`Updated ${Object.keys(vnodeLoads).length} vnode loads with TTL ${ttl}s`);
  }

  /**
   * Gets all vnode ownership mappings
   * @return {Object} - Map of vnodeId to instanceId
   */
  async getAllVnodeOwners() {
    const result = await this.client.hgetall(this.VNODE_OWNERS_KEY);
    return result || {};
  }

  /**
   * Gets all vnode load metrics
   * @return {Object} - Map of vnodeId to load count
   */
  async getAllVnodeLoads() {
    const result = await this.client.hgetall(this.VNODE_LOAD_KEY);
    
    // Convert string values to numbers
    return Object.entries(result || {}).reduce((acc, [key, value]) => {
      acc[key] = parseInt(value, 10);
      return acc;
    }, {});
  }

  /**
   * Caches a user's instance mapping
   * @param {string} userId - The user identifier
   * @param {string} instanceId - The instance identifier
   * @param {number} ttl - Time to live in seconds
   */
  async cacheUserInstance(userId, instanceId, ttl = this.DEFAULT_TTL) {
    await this.client.setex(`${this.USER_INSTANCE_KEY_PREFIX}${userId}`, ttl, instanceId);
  }

  /**
   * Gets a user's cached instance mapping
   * @param {string} userId - The user identifier
   * @return {string|null} - The instance identifier or null if not found
   */
  async getCachedUserInstance(userId) {
    return await this.client.get(`${this.USER_INSTANCE_KEY_PREFIX}${userId}`);
  }

  /**
   * Closes the Redis connection
   */
  async close() {
    await this.client.quit();
    logger.info('Redis connection closed');
  }
}

// Singleton instance
const redisClient = new RedisClient();
module.exports = redisClient; 