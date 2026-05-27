---
# 🚪 Enterprise API Gateway

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/binyam69dev/api-gateway?style=for-the-badge&logo=github&color=gold)](https://github.com/binyam69dev/api-gateway/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/binyam69dev/api-gateway?style=for-the-badge&logo=github&color=blue)](https://github.com/binyam69dev/api-gateway/forks)
[![GitHub watchers](https://img.shields.io/github/watchers/binyam69dev/api-gateway?style=for-the-badge&logo=github&color=green)](https://github.com/binyam69dev/api-gateway/watchers)

[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15.x-4169E1?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=for-the-badge&logo=redis)](https://redis.io/)
[![JWT](https://img.shields.io/badge/JWT-Authentication-000000?style=for-the-badge&logo=jsonwebtokens)](https://jwt.io/)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**A production-ready RESTful API Gateway built from scratch with JWT auth, rate limiting, caching, and circuit breaker pattern**

[Quick Start](#quick-start-60-seconds) • [Architecture](#architecture) • [Features](#features) • [API Docs](#api-documentation)

</div>

---

## ⚡ Quick Start (60 Seconds)

```bash
# 1. Clone the repository
git clone https://github.com/binyam69dev/api-gateway.git
cd api-gateway

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env

# 4. Start services with Docker (PostgreSQL + Redis)
docker-compose up -d

# 5. Start the gateway
npm run dev

# 6. Test it's working
curl http://localhost:3000/health

---
**{
  "status": "UP",
  "timestamp": "2026-05-27T00:00:00.000Z",
  "services": {
    "postgres": "connected",
    "redis": "connected"
  }
}
**


## 🏗️ Architecture

\`\`\`mermaid
graph TD
    Client[🌐 Client Applications]

    Gateway[🛡️ API Gateway]
    Express[⚡ Express Server]
    Auth[🔐 JWT Auth]
    Rate[📊 Rate Limiter]
    Cache[💾 Redis Cache]
    CB[🔌 Circuit Breaker]
    Router[🗺️ Dynamic Router]

    PG[(🐘 PostgreSQL)]
    RD[(⚡ Redis)]

    S1[Service 1]
    S2[Service 2]
    S3[Service N]

    Client --> Express
    Express --> Auth
    Auth --> Rate
    Rate --> Cache
    Cache --> CB
    CB --> Router

    Router --> S1
    Router --> S2
    Router --> S3

    Rate -.-> RD
    Cache -.-> RD
    Router -.-> PG
    Auth -.-> PG\`\`\`

**Want to verify?** Run `npm run dev` and test every endpoint yourself.
