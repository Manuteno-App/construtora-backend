# Module Scaffolding & Evaluation Reference

---

# Part 1: Module Creation

## Requirements Gathering

Before generating code, gather:
1. **Module name** (kebab-case, e.g., "billing", "inventory")
2. **Architecture pattern**: flat or subdomain-based
3. **Initial entities** (comma-separated, e.g., "Customer, Order, Payment")
4. **External integrations** (any third-party services?)
5. **Async processing** (will it use queues?)

## Architecture Decision

```
Does the module have multiple distinct subdomains that could scale independently?
├─ YES → Subdomain-Based Pattern
│         Examples: Content (admin, catalog, processor), Commerce (cart, checkout, fulfillment)
└─ NO → Flat Module Pattern
          Examples: Billing, Identity, Notifications
```

- **Flat Module**: Single cohesive domain, 3-8 entities
- **Subdomain-Based**: 10+ entities or subdomains with independent scaling/failure needs

## Folder Structures

### Pattern 1: Flat Module

```
package/{module-name}/
├── core/
│   ├── enum/
│   ├── interface/
│   └── service/
├── http/
│   ├── client/{service}-api/{service}.client.ts
│   └── rest/
│       ├── controller/
│       └── dto/
│           ├── request/
│           └── response/
├── persistence/
│   ├── entity/
│   ├── repository/
│   ├── migration/
│   ├── {module}-persistence.module.ts
│   ├── typeorm-datasource.ts
│   └── typeorm-datasource.factory.ts
├── health/
├── public-api/facade/
├── {module}.module.ts
├── config.ts
├── index.ts
├── package.json
├── tsconfig.json, tsconfig.lib.json, tsconfig.spec.json
├── jest.config.ts
└── eslint.config.mjs
```

### Pattern 2: Subdomain-Based Module (with Subdomain-Owned Persistence)

> **Important**: In subdomain-based modules, each subdomain owns its entities and repositories.
> The shared layer holds only infrastructure (DB connection, migrations, enums, queue config).
> See `references/subdomain-persistence.md` for full patterns, anti-patterns, and decision trees.

```
package/{module-name}/
├── {subdomain-1}/
│   ├── {subdomain}.module.ts                       # Registers OWN repos + services, exports facade
│   ├── persistence/
│   │   ├── entity/                                 # Entities THIS subdomain owns
│   │   └── repository/                             # Repos THIS subdomain owns
│   ├── core/service/                               # Internal services + query services
│   ├── http/rest/
│   │   ├── controller/
│   │   └── dto/
│   └── public-api/facade/{subdomain}.facade.ts     # Pure delegation to internal services
├── {subdomain-2}/
│   ├── {subdomain}.module.ts                       # Registers OWN repos + services
│   ├── persistence/
│   │   ├── entity/                                 # Entities THIS subdomain owns
│   │   └── repository/                             # Repos THIS subdomain owns
│   ├── core/service/
│   └── ...
├── shared/
│   ├── contract/                                   # Shared payload types (queue, events)
│   ├── enum/                                       # Stable domain vocabulary
│   ├── persistence/
│   │   ├── migration/                              # Migrations (shared — one DB)
│   │   ├── persistence.module.ts                   # TypeORM connection ONLY — zero repos
│   │   ├── typeorm-datasource.ts
│   │   └── typeorm-datasource.factory.ts
│   └── {module}-shared.module.ts
├── public-api/facade/{module}.facade.ts            # Composes subdomain facades — pure delegation
├── {module}.module.ts                              # Provides + exports package-level facade
├── config.ts
└── index.ts
```

**Cross-subdomain data access**: When subdomain B needs data from subdomain A, it imports subdomain A's module and uses its exported **internal facade** — never by importing repositories directly from shared. See `references/subdomain-persistence.md` for the Internal Facade and Event-Carried State Transfer patterns.

## Component Templates

### config.ts (Zod Schema)

```typescript
import { ConfigException, environmentSchema } from '@tlc/shared-module/config';
import { z } from 'zod';

const databaseSchema = z.object({
  host: z.string(),
  database: z.string(),
  password: z.string(),
  port: z.coerce.number(),
  url: z.string().startsWith('postgresql://'),
  username: z.string(),
});

const {moduleName} = z.object({ database: databaseSchema });
export const configSchema = z.object({ env: environmentSchema, {moduleName} });
export type {ModuleName}Config = z.infer<typeof configSchema>;

export const factory = (): z.infer<typeof configSchema> => {
  const result = configSchema.safeParse({
    env: process.env.NODE_ENV,
    {moduleName}: {
      database: {
        host: process.env.{MODULE_NAME}_DATABASE_HOST,
        database: process.env.{MODULE_NAME}_DATABASE_NAME,
        password: process.env.{MODULE_NAME}_DATABASE_PASSWORD,
        port: process.env.{MODULE_NAME}_DATABASE_PORT,
        url: `postgresql://${process.env.{MODULE_NAME}_DATABASE_USERNAME}:...@${process.env.{MODULE_NAME}_DATABASE_HOST}:${process.env.{MODULE_NAME}_DATABASE_PORT}/${process.env.{MODULE_NAME}_DATABASE_NAME}`,
        username: process.env.{MODULE_NAME}_DATABASE_USERNAME,
      },
    },
  });
  if (result.success) return result.data;
  throw new ConfigException(`Invalid configuration: ${result.error.message}`);
};
```

## Facade Rules

The pattern is always **Facade → Service → Repository**. Facades only delegate; services own the logic.

1. **A facade is pure delegation only** — it injects a service and returns the result. No querying, no mapping, no business logic.
2. **A subdomain never exports internal services** — only its facade. Consumers must not access services or repositories directly.
3. **The package-level facade only composes subdomain facades** — no repository or internal service injection.
4. **The root module provides + exports the package-level facade directly** — no separate `PublicApiModule` is needed for subdomain-based packages.

### Subdomain Facade Example

```typescript
// package/{module}/{subdomain}/public-api/facade/{subdomain}.facade.ts
@Injectable()
export class {Subdomain}Facade {
  constructor(private readonly queryService: {Subdomain}QueryService) {}

  getSomeData(id: string): Promise<SomeData | null> {
    return this.queryService.getSomeData(id);   // pure delegation — no logic
  }
}
```

### Package-Level Facade Example

```typescript
// package/{module}/public-api/facade/{module}.facade.ts
@Injectable()
export class {Module}Facade implements {Module}Api {
  constructor(private readonly {subdomain}Facade: {Subdomain}Facade) {}

  getSomeData(id: string): Promise<SomeData | null> {
    return this.{subdomain}Facade.getSomeData(id);  // pure delegation — no logic
  }
}
```

## Component Implementation

When generating components, apply patterns from `docs/coding-patterns.md`:

- Entities → "Entity Naming and State Isolation"
- Repositories → "Repository Pattern & ORM Encapsulation"
- Persistence module + datasource factory → "DB Configuration Patterns"
- Services → "Transaction Management & Named Connections"
- Controllers → "Lean Controller Pattern"
- DTOs: request uses class-validator decorators; response uses `@Expose()` from class-transformer

### Main Module ({module}.module.ts)

```typescript
@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrometheusModule.register(),
    {ModuleName}PersistenceModule,
    AuthModule,
    LoggerModule,
  ],
  providers: [...coreServices],
  controllers: [...controllers],
  exports: [...coreServices],
})
export class {ModuleName}Module {}

export { factory as {moduleName}ConfigFactory } from './config';
```

### index.ts (Public Exports Only)

```typescript
export * from './{module-name}.module';
export * from './config';
export { {EnumName} } from './core/enum/{enum-name}.enum';
// DO NOT export: services, repositories, controllers, entities
```

### NX Config Files

**package.json:**
```json
{ "name": "@tlc/{module-name}", "version": "0.0.1", "main": "./index.ts", "types": "./index.ts" }
```

**jest.config.ts:**
```typescript
export default {
  displayName: '{module-name}',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/package/{module-name}',
};
```

## Generation Order

1. Gather requirements using AskQuestion tool
2. Decide architecture pattern (flat vs subdomain-based)
3. Create folder structure
4. Generate `config.ts` with Zod schema
5. Generate entities (module-prefixed names)
6. Generate repositories (extending DefaultTypeOrmRepository)
7. Generate persistence module + datasource files
8. Generate services (with @Transactional)
9. Generate controllers (lean, <20 lines/method)
10. Generate DTOs (request + response)
11. Generate main module
12. Generate `index.ts` (public exports only)
13. Generate NX config files
14. Run verification commands

## Post-Generation Checklist

- [ ] No duplicate entity names across modules
- [ ] All repositories use `@InjectDataSource('{moduleName}')`
- [ ] All write services use `@Transactional({ connectionName: '{moduleName}' })`
- [ ] No controllers inject repositories
- [ ] `index.ts` exports only facades and module class
- [ ] `nx lint:check {moduleName}` passes
- [ ] `nx build {moduleName}` passes
- [ ] `nx db:generate {moduleName}` creates migration
- [ ] Facades contain only delegation — no querying, mapping, or business logic
- [ ] Subdomain modules export only their facade — no internal services or repositories
- [ ] Package-level facade injects subdomain facades only — no repositories or internal services

### Additional checks for subdomain-based modules:

- [ ] Each subdomain registers its own repos as providers (not imported from shared)
- [ ] Shared persistence module has zero repository providers/exports — only TypeORM connection
- [ ] Cross-subdomain reads go through internal facades, not direct repo injection
- [ ] Queue/event contract types live in `shared/contract/`, not inside any subdomain
- [ ] TypeORM datasource factory entity paths include all subdomain entity directories
- [ ] No subdomain service imports from another subdomain's `persistence/` directory

---

# Part 2: Module Evaluation

## When to Evaluate

Use this when a module is growing and may need sub-domain splitting.

## Evaluation Process

### Step 1: Gather Module Information

- List all services in `core/service/` or `core/use-case/`
- List all entities in `persistence/entity/`
- List all controllers in `http/rest/controller/`
- Identify external dependencies (clients)
- Check existing sub-modules (if any)

### Step 2: Identify Sub-Domain Signals

Look for natural groupings based on:

| Signal | Description |
|--------|-------------|
| **Different User Personas** | Admin vs customer; internal vs external |
| **Different Execution Models** | Sync REST vs async queues vs real-time events |
| **Different Technical Characteristics** | Read-heavy vs write-heavy; CPU-bound vs I/O-bound |
| **Different Change Velocities** | Experimental vs stable; different team ownership |
| **Independent Deployment Potential** | Could this be a separate microservice? |

### Step 3: Measure Cohesion and Coupling

**Cohesion Score (1-5, higher is better):**
- 5: Single, clear responsibility — all components serve same purpose
- 4: Related responsibilities — changes affect same components
- 3: Some overlap but can work independently
- 2: Loosely related, serve different purposes
- 1: Unrelated, grouped arbitrarily

**Coupling Score (1-5, lower is better):**
- 1: Groups never interact
- 2: Occasional communication via events/APIs
- 3: Regular communication through well-defined interfaces
- 4: Frequent direct calls, shared state
- 5: Tightly coupled, can't function independently

**Decision Matrix:**
```
High Cohesion (4-5) + Low Coupling (1-2)   → STRONG CANDIDATE for sub-modules
High Cohesion (4-5) + High Coupling (4-5)  → KEEP TOGETHER
Low Cohesion (1-2)  + Any Coupling         → REFACTOR first, don't split
```

### Step 4: 6-Criteria Test

| # | Criterion | Question |
|---|-----------|----------|
| 1 | User Persona | Does this serve fundamentally different users? |
| 2 | Access Control | Does this need different authorization models? |
| 3 | Execution Model | Different protocols (REST vs Queue vs GraphQL)? |
| 4 | Scaling Needs | Different scaling characteristics? |
| 5 | Deployment | Could this be deployed independently? |
| 6 | Failure Isolation | Can this fail without affecting other parts? |

**Decision:**
- ✅ **4+ criteria met** → STRONG recommendation for sub-modules
- ⚠️ **2-3 criteria met** → CONSIDER sub-modules (evaluate trade-offs)
- ❌ **0-1 criteria met** → KEEP FLAT structure

## Fakeflix Examples

### Content Package — HAS Sub-modules ✅

```
content/
├── admin/           # Content management (admin users, sync REST)
├── catalog/         # Content discovery (consumers, sync REST)
├── video-processor/ # Video processing (async queues, CPU-heavy)
└── shared/          # Common entities
```

Why it works: 4/6 criteria met (different users, different execution, different scaling, could deploy separately)

### Analytics Package — HAS Sub-modules with Owned Persistence ✅

```
analytics/
├── ingestion/           # Write path (player clients, append-only events)
│   └── persistence/     # Owns: ViewEvent, Heartbeat
├── aggregation/         # Processing (queue consumers, read-model upserts)
│   └── persistence/     # Owns: WatchHistory, ContentPerformance, Trending, Binge, GenreAffinity
├── reporting/           # Read path (admin dashboard, CSV exports)
│   └── (no persistence — reads through aggregation)
└── shared/              # Infrastructure: DB connection, queue config, enums, contracts
    └── persistence/     # TypeORM connection only — zero repos
```

Why it works: 4/6 criteria met (different execution models, different scaling, CQRS write/read separation, could deploy independently). Each subdomain owns its persistence. Cross-subdomain reads go through internal facades.

### Billing Package — NO Sub-modules ✅

```
billing/
└── core/service/
    ├── subscription.service.ts
    ├── invoice.service.ts
    └── usage-billing.service.ts
```

Why flat is correct: 0/6 criteria (same users, same REST model, tightly coupled — subscriptions create invoices)

## Red Flags: When NOT to Split

- ❌ "The package feels big" — size alone is not a reason
- ❌ "To make code easier to find" — folder organization problem, not domain problem
- ❌ "Features are tightly coupled" — high coupling means they belong together
- ❌ "To match team structure" — don't let org chart drive architecture

## Green Lights: When TO Split

- ✅ These serve different user types (admin vs customer)
- ✅ These have different failure modes (background can fail without affecting API)
- ✅ These scale differently (CPU-intensive vs simple CRUD)
- ✅ These could logically be separate microservices
- ✅ These have different change velocities

## Output Format for Evaluation

```markdown
# Module Evaluation: {module-name}

## Current Structure
- Pattern: [Flat / Sub-domain-based]
- Services: {count}, Entities: {count}, Controllers: {count}

## Identified Groupings
### Group 1: {name}
- Cohesion Score: {1-5}
- User Persona: {who uses this}
- Execution Model: {sync/async}

## Coupling Analysis
- Between Group 1 and Group 2: Coupling Score {1-5}

## 6-Criteria Test
| Criterion | Met? |
|-----------|------|
| User Persona | ✅/❌ |
| Access Control | ✅/❌ |
| Execution Model | ✅/❌ |
| Scaling Needs | ✅/❌ |
| Deployment | ✅/❌ |
| Failure Isolation | ✅/❌ |

Total: {X}/6

## Recommendation: [Split / Keep Flat]
**Rationale**: {explanation}
**Proposed Structure** (if splitting): ...
**Trade-offs**: ...
```
