// Example usage of the Registration Center Client SDK
const RegistrationCenterClient = require('./sdk');

/**
 * This is a demonstration of how to use the RegistrationCenterClient
 * 
 * In a real application, you would:
 * 1. Obtain a JWT token from your authentication system
 * 2. Create a client instance with the token
 * 3. Connect to the WebSocket service
 * 4. Handle events and messages
 */

// Simulated JWT token with userId
const simulatedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1MTIzIiwiaWF0IjoxNjI4MTgzODI5LCJleHAiOjE2MjgyNzAyMjl9.8Uj7OdXL7HGIwvGeI6LoYHj-nH1O3u1JJ5uAtPBIjhQ';

// Create client instance
const client = new RegistrationCenterClient({
  coordinatorUrl: 'http://localhost:3000',
  token: simulatedToken,
  
  onStatusChange: (statusInfo) => {
    console.log(`Connection status changed: ${statusInfo.previousStatus} -> ${statusInfo.status}`);
    
    // You might want to update UI elements based on connection status
    if (statusInfo.status === 'connected') {
      console.log(`Connected to instance: ${client.getInstance()}`);
    }
  },
  
  onMessage: (data) => {
    console.log('Received message:', data);
    
    // Handle different message types
    switch (data.type) {
      case 'welcome':
        console.log(`Welcome! Connected to node ${data.nodeId}`);
        break;
      
      case 'status_update':
        console.log(`User status update: ${data.action}`);
        break;
      
      case 'pong':
        // Heartbeat response, typically ignored in UI
        break;
        
      default:
        console.log(`Unknown message type: ${data.type}`);
    }
  },
  
  onError: (error) => {
    console.error('Client error:', error.message);
    // You might want to show an error notification to the user
  }
});

// Connect to the service
client.connect()
  .then(() => {
    console.log('Connection initiated');
  })
  .catch((error) => {
    console.error('Failed to initiate connection:', error);
  });

// Example of sending a custom message (after ensuring connection is established)
setTimeout(() => {
  if (client.getStatus() === 'connected') {
    client.send({
      type: 'custom_event',
      data: {
        message: 'Hello server!',
        timestamp: Date.now()
      }
    });
  }
}, 5000);

// Example of disconnecting after some time
setTimeout(() => {
  console.log('Disconnecting...');
  client.disconnect();
}, 30000);

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down client...');
  client.disconnect();
  process.exit(0);
});

console.log('Client example started. Press Ctrl+C to exit.'); 