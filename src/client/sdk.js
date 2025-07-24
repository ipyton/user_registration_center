/**
 * Registration Center Client SDK
 * Manages WebSocket connection with auto-routing and reconnection
 */
class RegistrationCenterClient {
  /**
   * Creates a new client instance
   * @param {Object} options - Configuration options
   * @param {string} options.coordinatorUrl - URL of coordinator service
   * @param {string} options.token - JWT token
   * @param {Function} options.onStatusChange - Status change callback
   * @param {Function} options.onMessage - Message callback
   * @param {Function} options.onError - Error callback
   * @param {number} options.reconnectInterval - Reconnection interval in ms
   * @param {number} options.heartbeatInterval - Heartbeat interval in ms
   */
  constructor(options) {
    this.options = {
      coordinatorUrl: 'http://localhost:3000',
      token: null,
      onStatusChange: () => {},
      onMessage: () => {},
      onError: () => {},
      reconnectInterval: 5000,
      heartbeatInterval: 20000,
      ...options
    };

    // Required options validation
    if (!this.options.token) {
      throw new Error('Token is required');
    }

    this.ws = null;
    this.status = 'disconnected'; // 'connecting', 'connected', 'disconnected'
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.userId = this._extractUserId();
    this.currentInstance = null;
  }

  /**
   * Extract userId from JWT token
   * @private
   * @return {string|null} - The extracted userId
   */
  _extractUserId() {
    try {
      // Simple JWT parsing, assuming token format: header.payload.signature
      const payload = this.options.token.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      return decoded.userId;
    } catch (error) {
      this._handleError('Failed to extract userId from token', error);
      return null;
    }
  }

  /**
   * Handles errors
   * @private
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  _handleError(message, error = null) {
    const errorObj = {
      message,
      error: error ? error.toString() : null
    };
    console.error(`RegistrationCenter SDK Error: ${message}`, error);
    this.options.onError(errorObj);
  }

  /**
   * Updates connection status and notifies listener
   * @private
   * @param {string} newStatus - New connection status
   */
  _updateStatus(newStatus) {
    const prevStatus = this.status;
    this.status = newStatus;
    
    if (prevStatus !== newStatus) {
      this.options.onStatusChange({
        status: newStatus,
        previousStatus: prevStatus,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Gets the optimal instance from coordinator service
   * @private
   * @return {Promise<string>} - WebSocket instance URL
   */
  async _getOptimalInstance() {
    try {
      const url = `${this.options.coordinatorUrl}/route?userId=${this.userId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.options.token}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Coordinator returned ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      if (!data.instance) {
        throw new Error('No instance available');
      }
      
      return data.instance;
    } catch (error) {
      this._handleError('Failed to get optimal instance', error);
      throw error;
    }
  }

  /**
   * Starts heartbeat sending
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stops heartbeat sending
   * @private
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Connects to the WebSocket server
   * @return {Promise<void>}
   */
  async connect() {
    try {
      if (this.status === 'connecting' || this.status === 'connected') {
        return;
      }

      this._updateStatus('connecting');
      
      // Get optimal instance from coordinator
      const instance = await this._getOptimalInstance();
      this.currentInstance = instance;
      
      // Form WebSocket URL
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${instance}/socket?token=${encodeURIComponent(this.options.token)}`;
      
      // Create WebSocket connection
      this.ws = new WebSocket(wsUrl);
      
      // Set up event handlers
      this.ws.onopen = () => {
        this._updateStatus('connected');
        this._startHeartbeat();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.options.onMessage(data);
        } catch (error) {
          this._handleError('Error parsing WebSocket message', error);
        }
      };
      
      this.ws.onclose = (event) => {
        this._stopHeartbeat();
        this._updateStatus('disconnected');
        
        // Auto reconnect
        this._scheduleReconnect();
      };
      
      this.ws.onerror = (error) => {
        this._handleError('WebSocket error', error);
      };
      
    } catch (error) {
      this._updateStatus('disconnected');
      this._handleError('Connection failed', error);
      this._scheduleReconnect();
    }
  }

  /**
   * Schedules reconnection
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.options.reconnectInterval);
  }

  /**
   * Disconnects from the WebSocket server
   */
  disconnect() {
    // Stop automatic reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Stop heartbeat
    this._stopHeartbeat();
    
    // Close WebSocket if open
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this._updateStatus('disconnected');
  }

  /**
   * Sends a message through the WebSocket
   * @param {Object} data - Message data
   * @return {boolean} - True if sent, false otherwise
   */
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this._handleError('Cannot send message, connection not open');
      return false;
    }
    
    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
      return true;
    } catch (error) {
      this._handleError('Failed to send message', error);
      return false;
    }
  }

  /**
   * Gets the current connection status
   * @return {string} - Connection status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Gets the current connected instance
   * @return {string|null} - Connected instance
   */
  getInstance() {
    return this.currentInstance;
  }
}

// For CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RegistrationCenterClient;
}

// For browser environments
if (typeof window !== 'undefined') {
  window.RegistrationCenterClient = RegistrationCenterClient;
} 