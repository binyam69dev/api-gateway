const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'API Gateway',
            version: '2.0.0',
            description: `
Enterprise API Gateway with self-service developer portal

## Authentication
This API uses **HTTP-only Cookies** for authentication.
- Login endpoint sets \`adminToken\` or \`devToken\` cookies
- All protected endpoints expect these cookies to be automatically sent
- No need to manually add Authorization headers

## Features
- 🔐 JWT Authentication (HttpOnly Cookies)
- 👥 Multi-Admin Support
- 👨‍💻 Developer Portal
- 🚀 Dynamic Route Management
- 📊 Analytics Dashboard
- ⚡ Rate Limiting
- 💾 Redis Caching
            `,
            contact: {
                name: 'Support',
                email: 'support@api-gateway.com'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development Server (HTTP)'
            },
            {
                url: 'https://api.yourdomain.com',
                description: 'Production Server (HTTPS)'
            }
        ],
        tags: [
            { name: 'Authentication', description: 'Login, Register, Logout' },
            { name: 'Admin', description: 'Admin-only endpoints' },
            { name: 'Developer', description: 'Developer portal endpoints' },
            { name: 'Public', description: 'Public endpoints' },
            { name: 'Routes', description: 'API route management' },
            { name: 'Profile', description: 'User profile management' }
        ],
        components: {
            securitySchemes: {
                // Cookie-based authentication (used by Swagger UI)
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'adminToken',
                    description: 'Admin authentication cookie (set automatically after login)'
                },
                devCookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'devToken',
                    description: 'Developer authentication cookie (set automatically after login)'
                },
                // Keep bearer for backward compatibility
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Legacy bearer token (prefer cookies)'
                }
            },
            schemas: {
                // User schema
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
                        email: { type: 'string', format: 'email', example: 'user@example.com' },
                        name: { type: 'string', example: 'John Doe' },
                        role: { type: 'string', enum: ['admin', 'user'], example: 'user' },
                        created_at: { type: 'string', format: 'date-time' }
                    }
                },
                // Login request
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { type: 'string', format: 'email', example: 'admin@gateway.com' },
                        password: { type: 'string', format: 'password', example: 'admin123' }
                    }
                },
                // Login response
                LoginResponse: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', example: 'Login successful' },
                        user: { $ref: '#/components/schemas/User' }
                    }
                },
                // Error response
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string', example: 'Invalid credentials' }
                    }
                },
                // Route schema
                Route: {
                    type: 'object',
                    properties: {
                        path_pattern: { type: 'string', example: '/api/users' },
                        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], example: 'GET' },
                        target_url: { type: 'string', example: 'https://api.example.com/users' },
                        required_role: { type: 'string', enum: ['guest', 'user', 'admin'], example: 'user' },
                        rate_limit_per_minute: { type: 'integer', example: 100 },
                        is_active: { type: 'boolean', example: true }
                    }
                },
                // Route request schema
                RouteRequest: {
                    type: 'object',
                    required: ['path_pattern', 'target_url'],
                    properties: {
                        path_pattern: { type: 'string', example: '/api/new-endpoint' },
                        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
                        target_url: { type: 'string', example: 'https://api.example.com/data' },
                        reason: { type: 'string', example: 'Need this endpoint for mobile app' },
                        urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' }
                    }
                }
            }
        },
        security: [{ cookieAuth: [] }]  // Default to cookie auth
    },
    apis: [
        './src/modules/*/*.js',
        './src/modules/auth/*.js',
        './src/modules/admin/*.js',
        './src/modules/portal/*.js'
    ]
};

const specs = swaggerJsdoc(options);

// Custom Swagger UI options to enable cookie authentication
const swaggerUiOptions = {
    explorer: true,
    swaggerOptions: {
        persistAuthorization: true,
        requestInterceptor: (request) => {
            // Cookies are automatically sent by browser
            // No need to modify request
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
        .swagger-ui .topbar { background-color: #4f46e5; }
        .swagger-ui .topbar .download-url-wrapper .select-label { color: white; }
        .swagger-ui .info .title { color: #4f46e5; }
        .swagger-ui .btn.authorize { border-color: #4f46e5; color: #4f46e5; }
        .swagger-ui .btn.authorize svg { fill: #4f46e5; }
    `,
    customSiteTitle: 'API Gateway Documentation',
    customfavIcon: 'https://api-gateway.com/favicon.ico'
};

// Helper to add cookie info to Swagger UI
const swaggerDocs = (app, port) => {
    // Serve Swagger UI
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerUiOptions));
    
    // Serve raw swagger JSON
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
    });
    
    console.log(`📚 API Documentation: http://localhost:${port}/api-docs`);
    console.log(`🍪 Cookie authentication enabled - Login first to use protected endpoints\n`);
};

module.exports = { swaggerUi, specs, swaggerDocs };