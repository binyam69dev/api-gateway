const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'API Gateway - Enterprise Edition',
            version: '2.0.0',
            description: `
# 🚀 Enterprise API Gateway

## Overview
A production-ready, scalable API Gateway with self-service developer portal, 
analytics, rate limiting, and enterprise-grade security.

## 🌟 Key Features
- **🔐 Enterprise Security**: JWT + HttpOnly Cookie authentication
- **👥 Multi-Tenant**: Admin and Developer portals
- **🚀 Dynamic Routing**: Add/remove routes in real-time
- **📊 Analytics**: Usage metrics and monitoring
- **⚡ Performance**: Redis caching, rate limiting, compression
- **🔍 Observability**: Prometheus metrics, request tracking
- **📚 Self-Service**: Developer portal for API access

## 🏢 Enterprise Capabilities
- **Scalable**: Handle millions of requests
- **Secure**: OAuth2, JWT, HttpOnly cookies
- **Compliant**: GDPR ready, audit logs
- **Reliable**: Health checks, graceful shutdown
- **Monitorable**: Prometheus metrics, structured logging

## 🔗 Quick Links
- [Admin Portal](https://api-gateway-ux8e.onrender.com/admin.html)
- [Developer Portal](https://api-gateway-ux8e.onrender.com/developer-auth.html)
- [Health Check](https://api-gateway-ux8e.onrender.com/health)
- [Metrics](https://api-gateway-ux8e.onrender.com/metrics)
            `,
            contact: {
                name: 'API Gateway Support',
                email: 'support@api-gateway.com',
                url: 'https://api-gateway-ux8e.onrender.com'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            },
            termsOfService: 'https://api-gateway-ux8e.onrender.com/terms'
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: '🌐 Development Server (HTTP)'
            },
            {
                url: 'https://api-gateway-ux8e.onrender.com',
                description: '🚀 Production Server (HTTPS)'
            }
        ],
        tags: [
            {
                name: 'Authentication',
                description: '🔐 User authentication and authorization'
            },
            {
                name: 'Admin',
                description: '👑 Administrative operations (Admin only)'
            },
            {
                name: 'Developer',
                description: '👨‍💻 Developer portal and self-service'
            },
            {
                name: 'Routes',
                description: '🗺️ API route management'
            },
            {
                name: 'Profile',
                description: '👤 User profile management'
            },
            {
                name: 'Health',
                description: '💊 Health checks and monitoring'
            },
            {
                name: 'Public',
                description: '🌍 Public endpoints'
            }
        ],
        components: {
            securitySchemes: {
                adminCookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'adminToken',
                    description: '🔑 Admin authentication cookie (set after login)'
                },
                devCookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'devToken',
                    description: '👨‍💻 Developer authentication cookie (set after login)'
                },
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: '🔐 Legacy bearer token (prefer cookies)'
                }
            },
            schemas: {
                // ===== USER SCHEMAS =====
                User: {
                    type: 'object',
                    properties: {
                        id: { 
                            type: 'string', 
                            format: 'uuid', 
                            example: '5df3cce7-56e4-4a0d-8e7c-ec97b8f52dd0' 
                        },
                        email: { 
                            type: 'string', 
                            format: 'email', 
                            example: 'admin@gateway.com' 
                        },
                        name: { 
                            type: 'string', 
                            example: 'Admin User' 
                        },
                        role: { 
                            type: 'string', 
                            enum: ['admin', 'developer', 'user'],
                            example: 'admin' 
                        },
                        username: { 
                            type: 'string', 
                            example: 'admin' 
                        },
                        created_at: { 
                            type: 'string', 
                            format: 'date-time' 
                        }
                    }
                },
                
                // ===== AUTH SCHEMAS =====
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { 
                            type: 'string', 
                            format: 'email', 
                            example: 'admin@gateway.com',
                            description: 'User email address'
                        },
                        password: { 
                            type: 'string', 
                            format: 'password', 
                            example: 'Admin123!',
                            description: 'User password (min 8 characters)'
                        }
                    }
                },
                LoginResponse: {
                    type: 'object',
                    properties: {
                        message: { 
                            type: 'string', 
                            example: 'Login successful' 
                        },
                        user: {
                            $ref: '#/components/schemas/User'
                        }
                    }
                },
                
                // ===== REGISTER SCHEMAS =====
                RegisterRequest: {
                    type: 'object',
                    required: ['email', 'password', 'name'],
                    properties: {
                        email: { 
                            type: 'string', 
                            format: 'email', 
                            example: 'user@example.com' 
                        },
                        password: { 
                            type: 'string', 
                            format: 'password', 
                            example: 'SecurePass123!',
                            description: 'Password must be at least 8 characters'
                        },
                        name: { 
                            type: 'string', 
                            example: 'John Doe' 
                        },
                        username: { 
                            type: 'string', 
                            example: 'johndoe',
                            pattern: '^[a-zA-Z0-9._]{3,30}$'
                        }
                    }
                },
                RegisterResponse: {
                    type: 'object',
                    properties: {
                        message: { 
                            type: 'string', 
                            example: 'Registration successful! Please login.' 
                        },
                        user: {
                            $ref: '#/components/schemas/User'
                        }
                    }
                },
                
                // ===== ROUTE SCHEMAS =====
                Route: {
                    type: 'object',
                    properties: {
                        id: { 
                            type: 'integer', 
                            example: 1 
                        },
                        path_pattern: { 
                            type: 'string', 
                            example: '/api/v1/users' 
                        },
                        method: { 
                            type: 'string', 
                            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                            example: 'GET' 
                        },
                        target_url: { 
                            type: 'string', 
                            example: 'https://api.example.com/users' 
                        },
                        required_role: { 
                            type: 'string', 
                            enum: ['guest', 'user', 'admin'],
                            example: 'user' 
                        },
                        rate_limit_per_minute: { 
                            type: 'integer', 
                            example: 100 
                        },
                        cache_ttl_seconds: { 
                            type: 'integer', 
                            example: 60 
                        },
                        is_active: { 
                            type: 'boolean', 
                            example: true 
                        },
                        created_at: { 
                            type: 'string', 
                            format: 'date-time' 
                        }
                    }
                },
                RouteRequest: {
                    type: 'object',
                    required: ['path_pattern', 'target_url'],
                    properties: {
                        path_pattern: { 
                            type: 'string', 
                            example: '/api/v1/new-endpoint' 
                        },
                        method: { 
                            type: 'string', 
                            enum: ['GET', 'POST', 'PUT', 'DELETE'],
                            default: 'GET' 
                        },
                        target_url: { 
                            type: 'string', 
                            example: 'https://api.example.com/data' 
                        },
                        required_role: { 
                            type: 'string', 
                            enum: ['guest', 'user', 'admin'],
                            default: 'user' 
                        },
                        rate_limit_per_minute: { 
                            type: 'integer', 
                            default: 100 
                        },
                        cache_ttl_seconds: { 
                            type: 'integer', 
                            default: 60 
                        },
                        reason: { 
                            type: 'string', 
                            example: 'Need this endpoint for mobile app' 
                        }
                    }
                },
                
                // ===== ERROR SCHEMAS =====
                Error: {
                    type: 'object',
                    properties: {
                        error: { 
                            type: 'string', 
                            example: 'Invalid credentials' 
                        }
                    }
                },
                ValidationError: {
                    type: 'object',
                    properties: {
                        error: { 
                            type: 'string', 
                            example: 'Email and password required' 
                        }
                    }
                },
                RateLimitError: {
                    type: 'object',
                    properties: {
                        error: { 
                            type: 'string', 
                            example: 'Too many requests. Please slow down.' 
                        }
                    }
                },
                
                // ===== HEALTH SCHEMAS =====
                HealthResponse: {
                    type: 'object',
                    properties: {
                        status: { 
                            type: 'string', 
                            enum: ['ok', 'degraded'],
                            example: 'ok' 
                        },
                        timestamp: { 
                            type: 'string', 
                            format: 'date-time' 
                        },
                        uptime: { 
                            type: 'number', 
                            example: 120.5 
                        },
                        services: {
                            type: 'object',
                            properties: {
                                database: { 
                                    type: 'boolean', 
                                    example: true 
                                },
                                redis: { 
                                    type: 'boolean', 
                                    example: true 
                                }
                            }
                        }
                    }
                },
                
                // ===== ANALYTICS SCHEMAS =====
                Analytics: {
                    type: 'object',
                    properties: {
                        summary: {
                            type: 'object',
                            properties: {
                                total_routes: { 
                                    type: 'integer', 
                                    example: 45 
                                },
                                total_developers: { 
                                    type: 'integer', 
                                    example: 12 
                                },
                                pending_requests: { 
                                    type: 'integer', 
                                    example: 3 
                                },
                                total_api_calls: { 
                                    type: 'integer', 
                                    example: 15432 
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                Unauthorized: {
                    description: 'Authentication required',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/Error'
                            },
                            example: {
                                error: 'Please login to access this endpoint'
                            }
                        }
                    }
                },
                Forbidden: {
                    description: 'Insufficient permissions',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/Error'
                            },
                            example: {
                                error: 'Admin access required'
                            }
                        }
                    }
                },
                TooManyRequests: {
                    description: 'Rate limit exceeded',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/RateLimitError'
                            }
                        }
                    }
                }
            }
        },
        security: [
            { adminCookieAuth: [] }
        ]
    },
    apis: [
        './src/modules/*/*.js',
        './src/modules/auth/*.js',
        './src/modules/admin/*.js',
        './src/modules/portal/*.js',
        './src/app.js'
    ]
};

const specs = swaggerJsdoc(options);

// Custom Swagger UI options with enterprise styling
const swaggerUiOptions = {
    explorer: true,
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        requestInterceptor: (request) => {
            // Auto-login support - cookies are sent by browser
            return request;
        },
        responseInterceptor: (response) => {
            // Log cookie setting for debugging
            if (response.headers && response.headers['set-cookie']) {
                console.log('✅ Cookie set by server');
            }
            return response;
        }
    },
    customCss: `
        .swagger-ui .topbar { 
            background: linear-gradient(135deg, #1a1a2e 0%, #4f46e5 100%); 
            padding: 15px 0;
        }
        .swagger-ui .topbar .wrapper .title { 
            color: #fff; 
            font-size: 1.5em;
        }
        .swagger-ui .topbar .wrapper .title:before { 
            content: '🚀 '; 
        }
        .swagger-ui .topbar .download-url-wrapper .select-label { 
            color: #fff; 
        }
        .swagger-ui .info .title { 
            color: #4f46e5; 
            font-size: 2.5em;
        }
        .swagger-ui .info .title small { 
            background: #4f46e5; 
            color: white; 
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.4em;
        }
        .swagger-ui .btn.authorize { 
            border-color: #4f46e5; 
            color: #4f46e5; 
            border-radius: 20px;
            padding: 8px 20px;
        }
        .swagger-ui .btn.authorize svg { 
            fill: #4f46e5; 
        }
        .swagger-ui .btn.authorize:hover { 
            background: #4f46e5; 
            color: white; 
        }
        .swagger-ui .btn.authorize:hover svg { 
            fill: white; 
        }
        .swagger-ui .opblock .opblock-summary-method { 
            background: #4f46e5; 
            color: white; 
            padding: 4px 12px;
            border-radius: 4px;
        }
        .swagger-ui .opblock.opblock-get .opblock-summary-method { 
            background: #4f46e5; 
        }
        .swagger-ui .opblock.opblock-post .opblock-summary-method { 
            background: #10b981; 
        }
        .swagger-ui .opblock.opblock-put .opblock-summary-method { 
            background: #f59e0b; 
        }
        .swagger-ui .opblock.opblock-delete .opblock-summary-method { 
            background: #ef4444; 
        }
        .swagger-ui .model-title { 
            color: #4f46e5; 
        }
        .swagger-ui .parameter__name { 
            color: #1a1a2e; 
        }
        .swagger-ui .parameter__in { 
            background: #e5e7eb; 
            border-radius: 4px;
            padding: 2px 8px;
        }
        .swagger-ui .property.primitive { 
            color: #4f46e5; 
        }
        .swagger-ui .json-schema-2020-12-accordion .title { 
            color: #4f46e5; 
        }
        .swagger-ui .render-container { 
            background: #f8fafc; 
            border-radius: 8px;
            padding: 16px;
        }
        .swagger-ui .loading-container .loading { 
            color: #4f46e5; 
        }
        .swagger-ui .response-col_status { 
            font-weight: 600;
        }
        .swagger-ui .response-col_status .response-status-code { 
            background: #f1f5f9;
            padding: 2px 10px;
            border-radius: 12px;
        }
        .swagger-ui .info .description .markdown p { 
            font-size: 1.1em;
            line-height: 1.6;
        }
        .swagger-ui .info .description .markdown h1 { 
            color: #4f46e5;
            font-size: 2em;
        }
        .swagger-ui .info .description .markdown h2 { 
            color: #1a1a2e;
            font-size: 1.5em;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 8px;
        }
        .swagger-ui .info .description .markdown .highlight { 
            background: #fef3c7;
            padding: 2px 8px;
            border-radius: 4px;
        }
        .swagger-ui .info .description .markdown .badge { 
            background: #4f46e5;
            color: white;
            padding: 2px 12px;
            border-radius: 12px;
            font-size: 0.8em;
        }
        .swagger-ui .scheme-container { 
            background: #f8fafc;
            border-radius: 8px;
            padding: 12px 20px;
        }
        .swagger-ui .servers .servers-select { 
            border-color: #e5e7eb;
            border-radius: 8px;
            padding: 8px 12px;
        }
    `,
    customSiteTitle: 'API Gateway - Enterprise Documentation',
    customfavIcon: 'https://api-gateway.com/favicon.ico'
};

const swaggerDocs = (app, port) => {
    // Serve Swagger UI
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerUiOptions));
    
    // Serve raw swagger JSON
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
    });
    
    // Serve OpenAPI YAML (add js-yaml first: npm install js-yaml)
    app.get('/api-docs.yaml', (req, res) => {
        try {
            const yaml = require('js-yaml');
            const yamlContent = yaml.dump(specs);
            res.setHeader('Content-Type', 'application/x-yaml');
            res.send(yamlContent);
        } catch (err) {
            res.status(500).json({ error: 'Failed to generate YAML' });
        }
    });
    
    console.log(`\n📚 ===== API DOCUMENTATION =====`);
    console.log(`📖 Swagger UI: http://localhost:${port}/api-docs`);
    console.log(`📄 OpenAPI JSON: http://localhost:${port}/api-docs.json`);
    console.log(`📄 OpenAPI YAML: http://localhost:${port}/api-docs.yaml`);
    console.log(`🍪 Cookie authentication enabled - Login first to use protected endpoints\n`);
};

module.exports = { swaggerUi, specs, swaggerDocs };