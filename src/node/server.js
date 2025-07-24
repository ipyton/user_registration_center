const http = require('http');
const WebSocket = require('ws');
const { Kafka } = require('kafkajs');
const ConsistentHash = require('../common/consistent-hash');
const redisClient = require('../common/redis-client');
const Auth = require('../common/auth');
const config = require('../common/config');
const logger = require('../common/logger');

// Initialize HTTP server for WebSocket
const server = http.createServer();

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Initialize Kafka
const kafka = new Kafka({
  clientId: `ws-node-${config.nodeId}`,
  brokers: config.kafkaBrokers
});

const producer = kafka.producer();
const consumer = kafka.consumer({ 
  groupId: `ws-node-group-${config.nodeId}` 
});

// Initialize consistent hash ring
const consistentHash = new ConsistentHash(config.vnodeCount);

// Track online users by vnodeId
const onlineUsers = {};
for (const vnodeId of config.assignedVnodes) {
  onlineUsers[vnodeId] = new Set();
}

// Track client connections
const clients = new Map(); // userId -> WebSocket

// Validate if a user belongs to this node's vnodes
function isUserOwnedByThisNode(userId) {
  const userVnodeId = consistentHash.getUserVnode(userId);
  return config.assignedVnodes.includes(userVnodeId);
}

// Handle new WebSocket connection
wss.on('connection', async (ws, req) => {
  let userId = null;
  
  try {
    // Extract and verify JWT token
    const token = Auth.extractToken(req);
    if (!token) {
      logger.debug('Connection rejected: No token provided');
      ws.close(1008, 'No token provided');
      return;
    }
    
    // Extract userId from token
    userId = Auth.extractUserId(token);
    if (!userId) {
      logger.debug('Connection rejected: Invalid token');
      ws.close(1008, 'Invalid token');
      return;
    }
    
    // Check if user belongs to this node
    if (!isUserOwnedByThisNode(userId)) {
      logger.debug(`Connection rejected: User ${userId} does not belong to this node`);
      ws.close(1008, 'User does not belong to this node');
      return;
    }
    
    // Store client connection
    clients.set(userId, ws);
    
    // Add user to online set
    const vnodeId = consistentHash.getUserVnode(userId);
    onlineUsers[vnodeId].add(userId);
    
    logger.info(`User ${userId} connected`, { vnode: vnodeId });
    
    // Send online status event to Kafka
    await producer.send({
      topic: 'user_status_events',
      messages: [
        { 
          key: userId,
          value: JSON.stringify({
            userId,
            action: 'online',
            timestamp: Date.now(),
            nodeId: config.nodeId
          })
        }
      ]
    });
    
    // Ping interval to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
    
    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        logger.debug(`Received message from user ${userId}`, { data });
        
        // Handle message types
        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
          default:
            logger.debug(`Unknown message type: ${data.type}`);
        }
      } catch (error) {
        logger.error(`Error processing message from user ${userId}`, { error: error.message });
      }
    });
    
    // Handle disconnection
    ws.on('close', async () => {
      clearInterval(pingInterval);
      
      // Remove user from online set
      onlineUsers[vnodeId].delete(userId);
      clients.delete(userId);
      
      logger.info(`User ${userId} disconnected`, { vnode: vnodeId });
      
      // Send offline status event to Kafka
      try {
        await producer.send({
          topic: 'user_status_events',
          messages: [
            { 
              key: userId,
              value: JSON.stringify({
                userId,
                action: 'offline',
                timestamp: Date.now(),
                nodeId: config.nodeId
              })
            }
          ]
        });
      } catch (error) {
        logger.error(`Error sending offline event for user ${userId}`, { error: error.message });
      }
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logger.error(`WebSocket error for user ${userId}`, { error: error.message });
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      userId,
      nodeId: config.nodeId,
      timestamp: Date.now()
    }));
    
  } catch (error) {
    logger.error('Error handling WebSocket connection', { error: error.message });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal server error');
    }
  }
});

// Push vnode ownership and load metrics to Redis periodically
async function updateHeartbeat() {
  try {
    // Prepare vnode ownership
    const vnodeOwners = {};
    for (const vnodeId of config.assignedVnodes) {
      vnodeOwners[vnodeId] = config.nodeId;
    }
    
    // Prepare vnode load metrics
    const vnodeLoad = {};
    for (const vnodeId of config.assignedVnodes) {
      vnodeLoad[vnodeId] = onlineUsers[vnodeId].size;
    }
    
    // Update Redis
    await redisClient.updateVnodeOwners(vnodeOwners);
    await redisClient.updateVnodeLoads(vnodeLoad);
    
    logger.debug('Updated heartbeat data in Redis', {
      onlineUsersCount: Object.values(onlineUsers).reduce((sum, set) => sum + set.size, 0)
    });
  } catch (error) {
    logger.error('Error updating heartbeat data', { error: error.message });
  }
}

// Subscribe to Kafka for user status events
async function subscribeToUserStatusEvents() {
  try {
    await consumer.subscribe({ topic: 'user_status_events', fromBeginning: false });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          const { userId, action, timestamp, nodeId } = payload;
          
          // Skip events from this node (we already processed them)
          if (nodeId === config.nodeId) {
            return;
          }
          
          // Only process events for users belonging to this node
          if (!isUserOwnedByThisNode(userId)) {
            return;
          }
          
          logger.debug(`Received ${action} event for user ${userId} from node ${nodeId}`);
          
          const vnodeId = consistentHash.getUserVnode(userId);
          
          // Update local state
          if (action === 'online') {
            onlineUsers[vnodeId].add(userId);
          } else if (action === 'offline') {
            onlineUsers[vnodeId].delete(userId);
          }
          
          // Notify connected client if exists
          const client = clients.get(userId);
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'status_update',
              action,
              timestamp,
              sourceNodeId: nodeId
            }));
          }
          
        } catch (error) {
          logger.error('Error processing Kafka message', { error: error.message });
        }
      }
    });
  } catch (error) {
    logger.error('Error subscribing to Kafka', { error: error.message });
  }
}

// Start the server
async function start() {
  try {
    // Log configuration
    logger.info(`Starting WebSocket node ${config.nodeId}`, {
      assignedVnodes: config.assignedVnodes,
      wsPort: config.wsPort
    });
    
    // Connect to Kafka
    await producer.connect();
    await consumer.connect();
    
    logger.info('Connected to Kafka');
    
    // Manually assign Kafka partitions based on assigned vnodes
    // Assumes vnode IDs can be mapped to Kafka partitions
    // This is a simplified approach - in production you might need more complex mapping
    await subscribeToUserStatusEvents();
    
    // Start HTTP server
    server.listen(config.wsPort, () => {
      logger.info(`WebSocket server is listening on port ${config.wsPort}`);
    });
    
    // Start heartbeat interval
    const heartbeatInterval = setInterval(updateHeartbeat, config.heartbeatInterval);
    
    // Initial heartbeat
    await updateHeartbeat();
    
    // Set up graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down WebSocket node...');
      
      // Clear intervals
      clearInterval(heartbeatInterval);
      
      // Close all WebSocket connections
      wss.clients.forEach(client => {
        client.close(1001, 'Server shutting down');
      });
      
      // Close server
      server.close();
      
      // Disconnect from Kafka
      await consumer.disconnect();
      await producer.disconnect();
      
      // Close Redis
      await redisClient.close();
      
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    logger.error('Error starting WebSocket node', { error: error.message });
    process.exit(1);
  }
}

// Start the node
start(); 