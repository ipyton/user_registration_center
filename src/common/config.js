require('dotenv').config();

module.exports = {
  // Common
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key-change-in-production',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Coordinator Service
  coordinatorPort: parseInt(process.env.COORDINATOR_PORT || '3000', 10),
  vnodeCount: parseInt(process.env.VNODE_COUNT || '1024', 10),

  // WebSocket Node
  nodeId: process.env.NODE_ID || 'node-1',
  assignedVnodes: (process.env.ASSIGNED_VNODES || '').split(',').filter(Boolean).map(Number),
  wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
}; 