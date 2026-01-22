import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'MICHAT PRO API',
            version: '1.0.0',
            description: 'API documentation for MICHAT PRO 3.0',
            contact: {
                name: 'API Support',
                email: 'support@michat.pro',
            },
        },
        servers: [
            {
                url: '/api',
                description: 'Main API Server',
            },
        ],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'connect.sid',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message',
                        },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        username: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        role: { type: 'string', enum: ['user', 'admin'] },
                    },
                },
            },
        },
        security: [
            {
                cookieAuth: [],
            },
        ],
    },
    apis: ['./server/routes/**/*.ts', './server/routes.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsdoc(options);
