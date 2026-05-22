const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'API Gateway',
            version: '2.0.0',
            description: 'Enterprise API Gateway with self-service developer portal',
            contact: {
                name: 'Support',
                email: 'support@your-gateway.com'
            }
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            }
        },
        security: [{
            bearerAuth: []
        }]
    },
    apis: ['./src/modules/*/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = { swaggerUi, specs };
