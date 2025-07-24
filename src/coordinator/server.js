const express = require('express');
const { Kafka } = require('kafkajs');
const ConsistentHash = require('../common/consistent-hash');
const redisClient = require('../common/redis-client');
const Auth = require('../common/auth');
const config = require('../common/config');
const logger = require('../common/logger');

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize Kafka producer
const kafka = new Kafka({
  clientId: `coordinator-${config.nodeId}`,
  brokers: config.kafkaBrokers
});

const producer = kafka.producer();

// Initialize consistent hash ring
const consistentHash = new ConsistentHash(config.vnodeCount);

// Middleware to log requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Register a WebSocket node
app.post('/nodes/register', async (req, res) => {
  try {
    const { instanceId, weight = 1 } = req.body;
    
    if (!instanceId) {
      return res.status(400).json({ error: 'instanceId is required' });
    }
    
    // Assign virtual nodes based on weight
    const vnodeCount = Math.max(1, Math.floor(config.vnodeCount * weight / 100));
    
    // Get current vnode mappings
    const currentVnodeMap = await redisClient.getAllVnodeOwners();
    const availableVnodes = [];
    
    // Find available vnodes
    for (let i = 0; i < config.vnodeCount; i++) {
      if (!currentVnodeMap[i]) {
        availableVnodes.push(i);
        if (availableVnodes.length >= vnodeCount) break;
      }
    }
    
    if (availableVnodes.length === 0) {
      return res.status(409).json({ error: 'No available vnodes' });
    }
    
    // Map vnodes to this instance
    const vnodeMappings = {};
    for (const vnodeId of availableVnodes) {
      vnodeMappings[vnodeId] = instanceId;
    }
    
    // Update Redis and local cache
    await redisClient.updateVnodeOwners(vnodeMappings);
    consistentHash.updateVnodeMappings(vnodeMappings);
    
    logger.info(`Registered node ${instanceId} with ${availableVnodes.length} vnodes`);
    
    res.status(201).json({
      instanceId,
      assignedVnodes: availableVnodes
    });
  } catch (error) {
    logger.error('Error registering node', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unregister a WebSocket node
app.post('/nodes/unregister', async (req, res) => {
  try {
    const { instanceId } = req.body;
    
    if (!instanceId) {
      return res.status(400).json({ error: 'instanceId is required' });
    }
    
    // Get current vnode mappings
    const currentVnodeMap = await redisClient.getAllVnodeOwners();
    const vnodesToRemove = Object.entries(currentVnodeMap)
      .filter(([_, instance]) => instance === instanceId)
      .map(([vnodeId]) => vnodeId);
    
    if (vnodesToRemove.length === 0) {
      return res.status(404).json({ error: 'No vnodes found for this instance' });
    }
    
    // Remove the instance from vnodes in Redis
    const pipeline = redisClient.client.pipeline();
    for (const vnodeId of vnodesToRemove) {
      pipeline.hdel(redisClient.VNODE_OWNERS_KEY, vnodeId);
    }
    await pipeline.exec();
    
    // Update local cache
    const vnodeMap = consistentHash.getVnodeMap();
    for (const vnodeId of vnodesToRemove) {
      delete vnodeMap[vnodeId];
    }
    consistentHash.updateVnodeMappings(vnodeMap);
    
    logger.info(`Unregistered node ${instanceId}, removed ${vnodesToRemove.length} vnodes`);
    
    res.json({
      instanceId,
      removedVnodes: vnodesToRemove
    });
  } catch (error) {
    logger.error('Error unregistering node', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route a user to an instance
app.get('/route', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // First, check if there's a cached mapping
    const cachedInstance = await redisClient.getCachedUserInstance(userId);
    if (cachedInstance) {
      return res.json({
        userId,
        instance: cachedInstance,
        source: 'cache'
      });
    }
    
    // If no cache, calculate the vnode
    const vnodeId = consistentHash.getUserVnode(userId);
    
    // Check local cache first
    let instance = consistentHash.getInstanceForVnode(vnodeId);
    
    // If not in local cache, check Redis
    if (!instance) {
      const vnodeMap = await redisClient.getAllVnodeOwners();
      instance = vnodeMap[vnodeId];
      
      // Update local cache if found in Redis
      if (instance) {
        consistentHash.setVnodeMapping(vnodeId, instance);
      }
    }
    
    if (!instance) {
      return res.status(404).json({ error: 'No instance available for this user' });
    }
    
    // Cache the user->instance mapping
    await redisClient.cacheUserInstance(userId, instance);
    
    res.json({
      userId,
      vnode: vnodeId,
      instance,
      source: 'hash'
    });
  } catch (error) {
    logger.error('Error routing user', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Load all vnode mappings from Redis on startup
async function loadVnodeMappings() {
  try {
    const vnodeMap = await redisClient.getAllVnodeOwners();
    consistentHash.updateVnodeMappings(vnodeMap);
    logger.info(`Loaded ${Object.keys(vnodeMap).length} vnode mappings from Redis`);
  } catch (error) {
    logger.error('Error loading vnode mappings', { error: error.message });
  }
}

// Start the server
async function start() {
  try {
    // Connect to Kafka
    await producer.connect();
    logger.info('Connected to Kafka');
    
    // Load vnode mappings
    await loadVnodeMappings();
    
    // Start Express server
    app.listen(config.coordinatorPort, () => {
      logger.info(`Coordinator service listening on port ${config.coordinatorPort}`);
    });
    
    // Set up graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down coordinator service...');
      await producer.disconnect();
      await redisClient.close();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error('Error starting coordinator service', { error: error.message });
    process.exit(1);
  }
}

// Start the service
start(); 