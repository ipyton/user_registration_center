const crypto = require('crypto');
const logger = require('./logger');

/**
 * Implements a Consistent Hash Ring for routing users to vnodes
 */
class ConsistentHash {
  constructor(vnodeCount = 1024) {
    this.vnodeCount = vnodeCount;
    this.vnodeMap = {}; // Maps vnode ID to instance ID
    logger.info(`Initialized ConsistentHash with ${vnodeCount} vnodes`);
  }

  /**
   * Maps a userId to a vnode ID
   * @param {string} userId - The user identifier
   * @return {number} - The vnode ID (0 to vnodeCount-1)
   */
  getUserVnode(userId) {
    const hash = crypto.createHash('md5').update(userId).digest('hex');
    // Use first 8 characters of hash (32 bits) as number and mod by vnodeCount
    const vnodeId = parseInt(hash.substring(0, 8), 16) % this.vnodeCount;
    return vnodeId;
  }

  /**
   * Gets the instance ID for a given vnode ID
   * @param {number} vnodeId - The vnode identifier
   * @return {string|null} - The instance ID or null if not mapped
   */
  getInstanceForVnode(vnodeId) {
    return this.vnodeMap[vnodeId] || null;
  }

  /**
   * Gets the instance ID for a given user ID
   * @param {string} userId - The user identifier
   * @return {string|null} - The instance ID or null if not mapped
   */
  getInstanceForUser(userId) {
    const vnodeId = this.getUserVnode(userId);
    return this.getInstanceForVnode(vnodeId);
  }

  /**
   * Updates the vnode to instance mapping
   * @param {number} vnodeId - The vnode identifier
   * @param {string} instanceId - The instance identifier
   */
  setVnodeMapping(vnodeId, instanceId) {
    this.vnodeMap[vnodeId] = instanceId;
  }

  /**
   * Updates multiple vnode mappings
   * @param {Object} vnodeMappings - Map of vnodeId to instanceId
   */
  updateVnodeMappings(vnodeMappings) {
    Object.assign(this.vnodeMap, vnodeMappings);
    logger.info(`Updated vnode mappings, now tracking ${Object.keys(this.vnodeMap).length} vnodes`);
  }

  /**
   * Checks if a user belongs to a list of vnodes
   * @param {string} userId - The user identifier
   * @param {Array<number>} vnodes - List of vnode IDs to check against
   * @return {boolean} - True if user's vnode is in the list
   */
  isUserInVnodes(userId, vnodes) {
    const userVnode = this.getUserVnode(userId);
    return vnodes.includes(userVnode);
  }

  /**
   * Gets the current vnode mapping
   * @return {Object} - The vnode to instance mapping
   */
  getVnodeMap() {
    return { ...this.vnodeMap };
  }
}

module.exports = ConsistentHash; 