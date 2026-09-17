# PHASE24_OPENAPI_STRATEGY.md
## DigiTronics V2 Enterprise OpenAPI Strategy

**Date:** 2026-08-05
**Status:** PLANNING ONLY
**Phase:** 24 - API Foundation & Authentication

---

## 1. OPENAPI OVERVIEW

### 1.1 Strategy

| Aspect | Decision |
|--------|----------|
| Specification | OpenAPI 3.1 |
| Format | YAML |
| Hosting | Self-hosted |
| UI | Swagger UI + Redoc |

### 1.2 Benefits

| Benefit | Description |
|---------|-------------|
| Documentation | Auto-generated API docs |
| Testing | Interactive API explorer |
| Codegen | SDK generation |
| Validation | Schema-based validation |

---

## 2. SPECIFICATION STRUCTURE

### 2.1 File Organization

```
docs/
├── openapi/
│   ├── v1/
│   │   ├── openapi.yaml          # Main spec
│   │   ├── paths/
│   │   │   ├── auth.yaml
│   │   │   ├── users.yaml
│   │   │   ├── tenants.yaml
│   │   │   ├── roles.yaml
│   │   │   └── health.yaml
│   │   ├── schemas/
│   │   │   ├── auth.yaml
│   │   │   ├── users.yaml
│   │   │   ├── tenants.yaml
│   │   │   ├── roles.yaml
│   │   │   └── common.yaml
│   │   └── components/
│   │       ├── security.yaml
│   │       ├── parameters.yaml
│   │       └── responses.yaml
│   └── v2/
│       └── openapi.yaml
```

### 2.2 Main Specification

```yaml
openapi: 3.1.0
info:
  title: DigiTronics API
  version: 1.0.0
  description: Enterprise ERP API
  contact:
    name: API Support
    email: api@digitronics.app

servers:
  - url: https://api.digitronics.app/api/v1
    description: Production
  - url: https://staging-api.digitronics.app/api/v1
    description: Staging
  - url: http://localhost:3000/api/v1
    description: Development

paths:
  /auth/login:
    $ref: './paths/auth.yaml#/login'
  /auth/register:
    $ref: './paths/auth.yaml#/register'
  /users:
    $ref: './paths/users.yaml#/list'
  /users/{id}:
    $ref: './paths/users.yaml#/getById'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  
  schemas:
    User:
      $ref: './schemas/users.yaml#/User'
    Tenant:
      $ref: './schemas/tenants.yaml#/Tenant'

security:
  - bearerAuth: []
```

---

## 3. PATH DEFINITIONS

### 3.1 Auth Paths

```yaml
# paths/auth.yaml
login:
  post:
    tags: [Authentication]
    summary: User login
    operationId: login
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/auth.yaml#/LoginRequest'
    responses:
      '200':
        description: Login successful
        content:
          application/json:
            schema:
              $ref: '../schemas/auth.yaml#/LoginResponse'
      '401':
        description: Invalid credentials
      '429':
        description: Rate limit exceeded

register:
  post:
    tags: [Authentication]
    summary: User registration
    operationId: register
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/auth.yaml#/RegisterRequest'
    responses:
      '201':
        description: Registration successful
      '409':
        description: Email already exists
```

### 3.2 User Paths

```yaml
# paths/users.yaml
list:
  get:
    tags: [Users]
    summary: List users
    operationId: listUsers
    parameters:
      - $ref: '../components/parameters.yaml#/page'
      - $ref: '../components/parameters.yaml#/limit'
      - $ref: '../components/parameters.yaml#/search'
    responses:
      '200':
        description: Users list
        content:
          application/json:
            schema:
              type: object
              properties:
                success:
                  type: boolean
                data:
                  type: array
                  items:
                    $ref: '../schemas/users.yaml#/User'
                meta:
                  $ref: '../schemas/common.yaml#/Pagination'

getById:
  get:
    tags: [Users]
    summary: Get user by ID
    operationId: getUserById
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: User found
      '404':
        description: User not found
```

---

## 4. SCHEMA DEFINITIONS

### 4.1 Auth Schemas

```yaml
# schemas/auth.yaml
LoginRequest:
  type: object
  required: [email, password, tenant_slug]
  properties:
    email:
      type: string
      format: email
    password:
      type: string
      minLength: 12
    tenant_slug:
      type: string

LoginResponse:
  type: object
  properties:
    success:
      type: boolean
    data:
      type: object
      properties:
        access_token:
          type: string
        refresh_token:
          type: string
        token_type:
          type: string
        expires_in:
          type: integer
        user:
          $ref: './users.yaml#/User'

RegisterRequest:
  type: object
  required: [email, password, name, tenant_slug]
  properties:
    email:
      type: string
      format: email
    password:
      type: string
      minLength: 12
    name:
      type: string
      minLength: 2
      maxLength: 100
    tenant_slug:
      type: string
```

### 4.2 User Schemas

```yaml
# schemas/users.yaml
User:
  type: object
  properties:
    id:
      type: string
      format: uuid
    email:
      type: string
      format: email
    name:
      type: string
    role:
      type: string
      enum: [super_admin, tenant_admin, manager, sales, warehouse, accountant, support, viewer]
    status:
      type: string
      enum: [active, inactive, pending]
    tenant_id:
      type: string
      format: uuid
    created_at:
      type: string
      format: date-time
    updated_at:
      type: string
      format: date-time
```

### 4.3 Common Schemas

```yaml
# schemas/common.yaml
Pagination:
  type: object
  properties:
    page:
      type: integer
    limit:
      type: integer
    total:
      type: integer
    totalPages:
      type: integer

Error:
  type: object
  properties:
    success:
      type: boolean
      enum: [false]
    error:
      type: object
      properties:
        code:
          type: string
        message:
          type: string
        details:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string
```

---

## 5. SWAGGER UI

### 5.1 Configuration

```javascript
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./docs/openapi/v1/openapi.yaml');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'DigiTronics API Documentation'
}));
```

### 5.2 Features

| Feature | Implementation |
|---------|----------------|
| Authentication | JWT token input |
| Try it out | Interactive testing |
| Models | Schema visualization |
| Download | Export OpenAPI spec |

---

## 6. REDOC

### 6.1 Configuration

```javascript
const redoc = require('redoc-express');

app.get('/api-docs/redoc', redoc({
  specUrl: '/api/v1/openapi.json',
  title: 'DigiTronics API Documentation'
}));
```

### 6.2 Features

| Feature | Benefit |
|---------|---------|
| Responsive | Mobile-friendly |
| Search | Full-text search |
| Navigation | Sidebar navigation |
| Download | PDF export |

---

## 7. CODE GENERATION

### 7.1 SDK Generation

| Language | Tool | Package |
|----------|------|---------|
| JavaScript | openapi-generator | @digitronics/sdk |
| Python | openapi-generator | digitronics-python |
| Go | openapi-generator | digitronics-go |

### 7.2 Generation Command

```bash
openapi-generator generate \
  -i docs/openapi/v1/openapi.yaml \
  -g javascript \
  -o sdk/javascript \
  --additional-properties=moduleName=DigiTronics
```

---

## 8. VALIDATION

### 8.1 Schema Validation

```javascript
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv();
addFormats(ajv);

const validate = ajv.compile(schema);
const isValid = validate(data);
```

### 8.2 Request Validation Middleware

```javascript
const validateRequest = (schema) => {
  return (req, res, next) => {
    const isValid = schema.validate(req.body);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: schema.errors
        }
      });
    }
    next();
  };
};
```

---

## 9. DOCUMENTATION GENERATION

### 9.1 Auto-Generated Docs

| Doc | Source | Output |
|-----|--------|--------|
| API Reference | OpenAPI spec | HTML/PDF |
| Changelog | Git commits | Markdown |
| Postman Collection | OpenAPI spec | JSON |

### 9.2 Generation Script

```json
{
  "scripts": {
    "docs:generate": "openapi-generator generate -i docs/openapi/v1/openapi.yaml -g html2 -o docs/api-reference",
    "docs:validate": "swagger-cli validate docs/openapi/v1/openapi.yaml",
    "docs:serve": "http-server docs/api-reference -p 8080"
  }
}
```

---

## 10. VERSIONING

### 10.1 Version Strategy

| Version | Status | Deprecation |
|---------|--------|-------------|
| v1 | Active | - |
| v2 | Planned | - |

### 10.2 Deprecation Policy

| Phase | Action |
|-------|--------|
| Deprecation | Add deprecation header |
| Warning | 6 months notice |
| Removal | After warning period |

---

## 11. TESTING

### 11.1 Contract Testing

| Tool | Purpose |
|------|---------|
| Pact | Consumer-driven contracts |
| Dredd | API blueprint testing |
| Schemathesis | Fuzz testing |

### 11.2 Validation Testing

```bash
# Validate spec
swagger-cli validate docs/openapi/v1/openapi.yaml

# Generate and test
openapi-generator generate -i spec.yaml -g javascript -o ./sdk
```

---

## 12. CI/CD INTEGRATION

### 12.1 Pipeline Steps

| Step | Action |
|------|--------|
| 1 | Validate OpenAPI spec |
| 2 | Generate SDK |
| 3 | Run contract tests |
| 4 | Deploy documentation |

### 12.2 GitHub Actions

```yaml
- name: Validate OpenAPI
  run: swagger-cli validate docs/openapi/v1/openapi.yaml

- name: Generate SDK
  run: openapi-generator generate -i spec.yaml -g javascript -o ./sdk

- name: Deploy Docs
  run: npm run docs:deploy
```
