# Real‑Time Online Status Service

This repository contains a scalable, high‑throughput service for real‑time online status registration and lookup, built with Consistent Hash routing, Kafka, Redis, and Node.js WebSocket servers. This repo is a part of the vydeo project

## 🚀 Features

- **Consistent‑Hash Routing**: Maps each `userId` to virtual nodes and then to actual service instances for balanced distribution.
- **Kafka Event Bus**: Broadcasts all user online/offline events asynchronously.
- **Redis Routing Table**: Maintains mappings of virtual nodes to instances and load metrics with TTL support.
- **Elastic Scaling**: Add or remove nodes with minimal remapping impact.
- **JWT Authentication**: Stateless JWT tokens carry user identity; services decode `userId` for authorization.

## 📁 Repository Structure

```
├── coordinator/            # Consistent‑Hash Ring manager service
│   ├── src/
│   ├── config/
│   ├── package.json
│   └── README.md
│
├── ws-node/                # WebSocket Node implementation
│   ├── src/
│   ├── config/
│   ├── Dockerfile
│   ├── package.json
│   └── README.md
│
├── kafka/                  # Kafka topic and producer/consumer configurations
│   └── README.md
│
├── redis/                  # Redis scripts and data schema definitions
│   └── README.md
│
├── client-sdk/             # Example client SDK for routing and WS connection
│   └── README.md
│
├── docs/                   # Architecture diagrams, design docs, and POCs
├── scripts/                # Deployment and utility scripts
├── docker-compose.yml      # Local development environment
└── README.md               # This file
```

## 📦 Prerequisites

- **Node.js** v14+ (coordinator & ws‑node)
- **Kafka** cluster (topic: `user_status_events`)
- **Redis** cluster or standalone
- **Docker** & **docker-compose** (for local testing)

## 🔧 Setup & Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/online-status-service.git
   cd online-status-service
   ```

2. **Environment Variables**

   - `KAFKA_BROKERS`: Comma‑separated Kafka broker addresses
   - `REDIS_URL`: Redis connection URI
   - `JWT_SECRET`: Secret for signing/verifying JWTs
   - `ASSIGNED_VNODES`: (ws‑node only) Comma‑separated vnode IDs
   - `NODE_ID`: Unique instance identifier

3. **Local Docker Setup**

   ```bash
   docker-compose up -d
   ```

4. **Install Dependencies & Run Services**

   - Coordinator:
     ```bash
     cd coordinator
     npm install
     npm start
     ```
   - WebSocket Node:
     ```bash
     cd ws-node
     npm install
     npm start
     ```

## 🗺️ Architecture Overview

See `docs/architecture.md` for detailed diagrams. In summary:

1. Clients request `/route?userId=<id>` from the **Coordinator**.
2. Coordinator computes vnode via consistent‑hash and returns the appropriate WS node address.
3. Clients connect to `wss://<ws-node>/socket`, send JWT for authentication.
4. WS node maintains user connections, sends/receives heartbeat and publishes status events to **Kafka**.
5. WS nodes and Coordinator update **Redis** with vnode ownership and load metrics.

## 📈 Monitoring & Scaling

- **Health Checks**: All services expose `/healthz` endpoint.
- **Metrics**: Expose Prometheus metrics for Kafka lag, WS connections, Redis QPS.
- **Scaling**: Adjust `ASSIGNED_VNODES` per instance for horizontal scaling. Coordinator will rebalance minimal vnode assignments.

## 🛠️ Development Workflow

- Run linting and formatting:
  ```bash
  npm run lint && npm run format
  ```
- Run unit tests:
  ```bash
  npm test
  ```
- Commit hooks ensure code quality and run type checks (if using TypeScript).

## 📜 Roadmap

-

## 🤝 Contributing

Contributions are welcome! Please see `CONTRIBUTING.md` for guidelines.

## 📝 License

This project is licensed under the MIT License. See `LICENSE` for details.

