CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    path_pattern VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    target_url VARCHAR(500) NOT NULL,
    required_role VARCHAR(50) DEFAULT 'user',
    rate_limit_per_minute INTEGER DEFAULT 100,
    cache_ttl_seconds INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(path_pattern, method)
);

INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds)
VALUES 
    ('/users', 'GET', 'http://localhost:3001/users', 'user', 100, 60),
    ('/products', 'GET', 'http://localhost:3002/products', 'guest', 200, 300)
ON CONFLICT (path_pattern, method) DO NOTHING;

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_routes_path_method ON routes(path_pattern, method);
