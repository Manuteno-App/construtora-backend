# Subdomain Persistence Patterns Reference

When a module uses the **subdomain-based** pattern (e.g., analytics with ingestion/aggregation/reporting), persistence ownership becomes a critical architectural decision. This reference covers the patterns for managing entities, repositories, and cross-subdomain data access within a single package.

---

## The Shared Kernel Anti-Pattern

### What Goes Wrong

The default approach — putting all entities and repositories in `shared/persistence/` — creates a **monolithic shared kernel** that undermines the purpose of having subdomains:

```
shared/persistence/
├── entity/          # ALL entities from ALL subdomains
├── repository/      # ALL repositories from ALL subdomains
└── persistence.module.ts  # Registers + exports EVERYTHING

# Result: any subdomain can inject any repository
# No ownership boundaries. No structural enforcement.
```

### Why It's a Problem

| Issue | Impact |
|-------|--------|
| **No ownership** | Nobody "owns" an entity — any subdomain can read/write anything |
| **Hidden coupling** | Dependencies between subdomains are invisible in the module graph |
| **No structural enforcement** | NestJS happily injects a write-model repo into a read-only subdomain |
| **Violates CQRS intent** | Write-side and read-side persistence are indistinguishable |
| **Hinders independent evolution** | Can't change one subdomain's data model without checking all others |

### How to Detect

```bash
# Shared persistence module exports repositories to all subdomains
rg "exports:.*Repository" package/*/shared/persistence/*.module.ts

# Subdomain services importing from shared persistence
rg "from.*shared/persistence/repository" package/*/*/core/service/

# Cross-subdomain imports (subdomain A importing subdomain B's internals)
rg "from.*\.\./\.\./\.\./(?!shared)" package/*/*/core/service/ --pcre2
```

### When Shared Persistence IS Appropriate

A shared persistence module is **fine** for:
- **Flat modules** (billing, identity) — no subdomains, so no boundary to violate
- **Truly shared entities** — rare; an entity that two subdomains equally co-own and co-evolve

A shared persistence module is **wrong** when:
- Each subdomain has clear ownership of specific entities
- The entities map to distinct write/read models (CQRS)
- Subdomains have different lifecycle or change velocity

---

## Pattern: Subdomain-Owned Persistence

Each subdomain owns the entities and repositories it writes to. The shared layer provides only infrastructure (DB connection, migrations).

### Structure

```
package/{module}/
├── {subdomain-1}/
│   ├── persistence/
│   │   ├── entity/                     # Entities THIS subdomain owns
│   │   │   ├── {module}-foo.entity.ts
│   │   │   └── {module}-bar.entity.ts
│   │   └── repository/                 # Repos THIS subdomain owns
│   │       ├── foo.repository.ts
│   │       └── bar.repository.ts
│   ├── core/service/
│   ├── public-api/facade/              # Exposes read access to other subdomains
│   └── {subdomain-1}.module.ts         # Registers its own repos as providers
│
├── {subdomain-2}/
│   ├── persistence/
│   │   ├── entity/
│   │   └── repository/
│   ├── core/service/
│   └── {subdomain-2}.module.ts
│
├── shared/
│   ├── persistence/
│   │   ├── analytics-persistence.module.ts  # TypeORM connection ONLY — zero repos
│   │   ├── typeorm-datasource.ts
│   │   ├── typeorm-datasource.factory.ts
│   │   └── migration/                       # Migrations stay shared (one DB)
│   ├── contract/                            # Shared payload types (queue, events)
│   ├── enum/                                # Stable domain vocabulary
│   └── {module}-shared.module.ts            # BullMQ + connection — no repos
```

### Key Rules

1. **Entities live with their owning subdomain**, not in shared
2. **Repositories are registered as providers in their owning subdomain module**
3. **Shared persistence module provides ONLY the TypeORM connection** (no repos, no exports besides the connection module)
4. **Cross-subdomain data access goes through internal facades**, never direct repository injection
5. **Queue contract types live in `shared/contract/`**, not inside any subdomain's internal code
6. **Migrations stay in shared** — they operate on the single database regardless of which subdomain owns the entity

### Datasource Factory Update

When entities are distributed across subdomains, update the entity glob to scan all locations:

```typescript
export const dataSourceOptionsFactory = (
  configService: ConfigService<ModuleConfig>
): PostgresConnectionOptions => {
  return {
    type: 'postgres',
    name: 'moduleName',
    // ... connection config ...
    entities: [
      join(__dirname, '..', '..', 'ingestion', 'persistence', 'entity', '*.entity.{ts,js}'),
      join(__dirname, '..', '..', 'aggregation', 'persistence', 'entity', '*.entity.{ts,js}'),
    ],
    migrations: [join(__dirname, 'migration', '*-migration.{ts,js}')],
  };
};
```

### Subdomain Module Registration

```typescript
@Module({
  imports: [SharedModule, LoggerModule],
  providers: [
    FooRepository,       // This subdomain's repos
    BarRepository,
    FooService,
    BarService,
    SubdomainReadFacade, // For cross-subdomain reads
  ],
  exports: [SubdomainReadFacade],  // Only the facade, not repos
})
export class Subdomain1Module {}
```

### Shared Persistence Module (Infrastructure Only)

```typescript
@Module({
  imports: [
    TypeOrmPersistenceModule.forRoot({
      name: 'moduleName',
      inject: [ConfigService],
      useFactory: (configService: ConfigService<ModuleConfig>) => {
        return dataSourceOptionsFactory(configService);
      },
      dataSourceFactory: async (options) => {
        if (!options) throw new Error('Invalid options passed');
        return addTransactionalDataSource({
          name: options.name,
          dataSource: new DataSource(options),
        });
      },
    }),
  ],
  // NO providers, NO exports — just the connection
})
export class SharedPersistenceModule {}
```

---

## Pattern: Internal Facade for Cross-Subdomain Reads

When subdomain B needs to read data owned by subdomain A, it goes through an **internal facade** — not by injecting A's repositories directly.

### When to Use

- Subdomain B performs read-only queries on subdomain A's data
- The subdomains have different write/read concerns (CQRS)
- You want the dependency to be explicit and controllable

### Implementation

```typescript
// subdomain-a/public-api/facade/subdomain-a-read.facade.ts
@Injectable()
export class SubdomainAReadFacade {
  constructor(private readonly fooRepository: FooRepository) {}

  async findRelevantData(params: QueryParams): Promise<FooData[]> {
    return this.fooRepository.findByParams(params);
  }
}
```

```typescript
// subdomain-b/core/service/some.service.ts
@Injectable()
export class SomeService {
  constructor(
    private readonly subdomainAFacade: SubdomainAReadFacade,  // facade, not repo
    private readonly ownRepo: BarRepository,
  ) {}

  async process(): Promise<void> {
    const data = await this.subdomainAFacade.findRelevantData(params);
    // ... use data to update own models
  }
}
```

### Module Wiring

```typescript
// subdomain-a.module.ts
@Module({
  imports: [SharedModule],
  providers: [FooRepository, SubdomainAReadFacade],
  exports: [SubdomainAReadFacade],  // export facade only
})
export class SubdomainAModule {}

// subdomain-b.module.ts
@Module({
  imports: [SharedModule, SubdomainAModule],  // explicit dependency
  providers: [BarRepository, SomeService],
})
export class SubdomainBModule {}
```

### Key Constraints

- The facade exposes **only the methods** the consumer needs — not the full repository API
- The facade is **pure delegation** — no business logic
- The dependency is **visible in the module graph**: B imports A
- The consumer **cannot bypass** the facade because the repository is not exported

---

## Pattern: Event-Carried State Transfer

For stronger decoupling (especially in CQRS), enrich queue/event payloads so the consumer never needs to query the producer's data store.

### When to Use

- The consumer processes events one at a time (not batch queries)
- The event naturally carries all data the consumer needs
- You want zero runtime coupling between producer and consumer data stores

### When NOT to Use

- Batch computations that need historical data (trending, affinity scoring)
- The payload would need to carry unreasonable amounts of data
- The consumer legitimately needs to query/aggregate across many records

### Implementation

```typescript
// shared/contract/enriched-event.contract.ts
export interface EnrichedEventPayload {
  userId: string;
  contentId: string;
  contentType: ContentType;  // enum, not string
  eventType: EventType;
  sessionId: string;
  positionMs: number;
  durationMs: number;
  occurredAt: string;
  genres: string[];          // enriched — consumer doesn't need to look this up
}
```

### Combining with Internal Facades

In practice, most subdomain-based modules use **both** patterns:

- **Event-Carried State Transfer** for event-driven processing (queue consumers)
- **Internal Facades** for batch computations that need to query historical data

Example: In an analytics module:
- Watch history aggregation works from enriched queue events (no cross-subdomain reads)
- Trending computation needs historical view events (uses internal facade)

---

## Decision Tree: Which Pattern to Use

```
Does subdomain B need data from subdomain A?
│
├─ NO → No cross-subdomain coupling needed
│
├─ YES, one event at a time (queue consumer)
│   └─ Can the event payload carry all needed data?
│       ├─ YES → Event-Carried State Transfer
│       └─ NO  → Internal Facade
│
├─ YES, batch queries (aggregation, reporting)
│   └─ Is subdomain B a natural downstream consumer?
│       ├─ YES (read-only) → Import subdomain A's module, use exported internal facade
│       └─ NO (writes back) → Internal Facade (tighter control)
│
└─ YES, but data is stable/shared vocabulary
    └─ Shared enums in shared/ (true shared kernel — small and stable)
```

---

## Verification Checklist for Subdomain Persistence

```
□ Each subdomain registers its own repos as providers (not imported from shared)
□ Shared persistence module has zero repository providers/exports
□ Cross-subdomain reads go through internal facades
□ Queue contract types live in shared/contract/
□ No subdomain imports from another subdomain's persistence/ directory
□ TypeORM datasource factory scans all subdomain entity directories
□ Migrations still generate correctly (nx db:generate)
□ Entity files live in their owning subdomain's persistence/entity/
□ Repository files live in their owning subdomain's persistence/repository/
□ Module graph shows explicit subdomain dependencies
```
