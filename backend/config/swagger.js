const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'DigiTronics V2 API',
      version: '2.0.0',
      description: `DigiTronics V2 Enterprise ERP API

## Authentication
- **JWT Bearer Token**: Standard JWT authentication
- **OAuth2**: Google and GitHub OAuth2 providers
- **API Key**: For service integrations (planned)

## Rate Limiting
- General API: 1000 requests per 15 minutes
- Login endpoints: 20 requests per 15 minutes
- MFA endpoints: 5 requests per 15 minutes`,
      contact: { name: 'DigiTronics Support', email: 'support@digitronics.com' }
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development server' },
      { url: 'https://api.digitronics.com', description: 'Production server' }
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Authentication', description: 'User authentication endpoints' },
      { name: 'MFA', description: 'Multi-Factor Authentication' },
      { name: 'OAuth2', description: 'OAuth2 provider authentication' },
      { name: 'Users', description: 'User management' },
      { name: 'Sales', description: 'Sales invoice management' },
      { name: 'Purchases', description: 'Purchase order management' },
      { name: 'Inventory', description: 'Inventory management' },
      { name: 'InventoryTransactions', description: 'Inventory transaction management' },
      { name: 'Customers', description: 'Customer management' },
      { name: 'Suppliers', description: 'Supplier management' },
      { name: 'Treasury', description: 'Treasury/cash management' },
      { name: 'Employees', description: 'Employee management' },
      { name: 'Partners', description: 'Partner management' },
      { name: 'Vouchers', description: 'Voucher management' },
      { name: 'Dashboard', description: 'Dashboard statistics' },
      { name: 'Reports', description: 'Report generation' },
      { name: 'Webhooks', description: 'Outbound webhook management' },
      { name: 'Metrics', description: 'Runtime metrics and observability' },
      { name: 'Error Tracker', description: 'Error issue management' }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token'
        },
        OAuth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: '/auth/google',
              tokenUrl: '/auth/google/callback',
              scopes: { openid: 'OpenID Connect', profile: 'User profile', email: 'User email' }
            }
          }
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key authentication (planned)'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician', 'WarehouseSales', 'Viewer'] },
            phone: { type: 'string' },
            mfaEnabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', description: 'Username or email' },
            password: { type: 'string', format: 'password' },
            mfaToken: { type: 'string', description: 'MFA code (required if MFA is enabled)' }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' }
              }
            },
            message: { type: 'string' }
          }
        },
        MfaRequiredResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                mfaRequired: { type: 'boolean', enum: [true] },
                tempToken: { type: 'string' },
                userId: { type: 'string' }
              }
            },
            message: { type: 'string' }
          }
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            sku: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number', format: 'float' },
            cost: { type: 'number', format: 'float' },
            quantity: { type: 'integer' },
            category: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Sale: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            invoiceNumber: { type: 'string' },
            customerName: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/SaleItem' } },
            total: { type: 'number', format: 'float' },
            paymentType: { type: 'string', enum: ['cash', 'card', 'transfer', 'credit'] },
            status: { type: 'string', enum: ['pending', 'completed', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        SaleItem: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            productName: { type: 'string' },
            quantity: { type: 'integer' },
            unitPrice: { type: 'number', format: 'float' },
            total: { type: 'number', format: 'float' }
          }
        },
        Purchase: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orderNumber: { type: 'string' },
            supplierName: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/PurchaseItem' } },
            total: { type: 'number', format: 'float' },
            status: { type: 'string', enum: ['pending', 'received', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        PurchaseItem: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            productName: { type: 'string' },
            quantity: { type: 'integer' },
            unitCost: { type: 'number', format: 'float' },
            total: { type: 'number', format: 'float' }
          }
        },
        Inventory: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string' },
            productName: { type: 'string' },
            quantity: { type: 'integer' },
            minStock: { type: 'integer' },
            maxStock: { type: 'integer' },
            location: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            address: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Supplier: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            address: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Employee: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            position: { type: 'string' },
            department: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: { type: 'string' },
            data: { type: 'null' }
          }
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' }
          }
        },
        HealthResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                status: { type: 'string' },
                uptimeSeconds: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  },
  apis: [
    path.resolve(__dirname, '..', 'routes', 'index.js'),
    path.resolve(__dirname, '..', 'routes', 'auth.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'mfa.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'oauth.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'users.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'sales.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'purchase.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'inventory.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'inventoryTransactions.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'customers.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'suppliers.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'treasury.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'employees.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'partners.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'voucher.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'dashboard.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'reports.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'apiKey.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'audit.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'webhook.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'metrics.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'health.routes.js'),
    path.resolve(__dirname, '..', 'routes', 'errorTracker.routes.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
