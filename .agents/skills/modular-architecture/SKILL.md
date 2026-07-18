---
name: modular-architecture
description: Fakeflix modular architecture expert for designing modules, assessing compliance, creating domain modules, and evaluating module boundaries. Use when creating modules, "scaffold a module", assessing architecture compliance, evaluating whether to split modules, understanding modular principles, or when the user mentions "architecture assessment", "module boundaries", "modularity", "compliance check", "maturity assessment", or "create a module".
---

# Modular Architecture Expert

You are an expert in Fakeflix's modular architecture. This skill provides everything needed for architecture design, module creation, evaluation, and compliance assessment.

## Core Philosophy

- **Apps = Bootstraps**: Applications (`apps/`) only orchestrate modules — minimal logic
- **Packages = Logic**: All business logic lives in packages (`packages/`) for maximum reusability
- **Modules = Independent, Composable Domains**: Each module is a bounded context with its own database, state, and lifecycle

## Module Structure (3-Level Hierarchy)

```
package/{module-name}/                # Bounded Context (e.g., billing, content, identity)
├── {subdomain}/                      # Sub-domain (optional, e.g., content/admin, content/catalog)
│   ├── core/
│   │   ├── service/                  # Business logic
│   │   └── use-case/                 # Application use cases
│   ├── http/
│   │   ├── rest/controller/          # REST controllers (lean, <20 lines/method)
│   │   ├── rest/dto/                 # Request/Response DTOs
│   │   └── client/                   # External API clients
│   ├── persistence/
│   │   ├── entity/                   # TypeORM entities (module-prefixed names)
│   │   └── repository/               # DefaultTypeOrmRepository extensions
│   └── queue/                        # Async processing (producers/consumers)
└── shared/                           # Cross-subdomain: entities, enums, persistence module
```

## The 10 Principles

| # | Principle | Criticality | Key Rule |
|---|-----------|-------------|----------|
| 1 | **Well-Defined Boundaries** | High | Export only facades/modules from `index.ts` |
| 2 | **Composability** | Medium | Modules work independently or together |
| 3 | **Independence** | High | No shared mutable state; test in isolation |
| 4 | **Individual Scale** | Medium | Module-specific resource configurations |
| 5 | **Explicit Communication** | High | All inter-module contracts via interfaces/DTOs |
| 6 | **Replaceability** | Medium | Interface-based dependencies where needed |
| 7 | **Deployment Independence** | Medium | No deployment assumptions in modules |
| 8 | **State Isolation** | 🔴 CRITICAL | Module-prefixed entity names; no shared DB tables |
| 9 | **Observability** | High | Module-specific logging, metrics, health checks |
| 10 | **Fail Independence** | High | Circuit breakers; failures don't cascade |

## Top 8 Critical Violations

1. 🔴 **Duplicate entity names** — `@Entity({ name: 'Plan' })` in multiple modules → use `BillingPlan`, `ContentPlan`
2. 🔴 **Cross-module database access** — `@InjectRepository(UserEntity, 'identity')` in billing module
3. 🔴 **Monolithic shared persistence in subdomain modules** — shared module registering ALL repos for ALL subdomains → each subdomain owns its repos
4. 🟠 **Fat controllers** — business logic in controllers instead of services
5. 🟠 **Repository injection in controllers** — controllers must only inject services
6. 🟠 **Missing `@Transactional({ connectionName })` on writes** — always name the connection
7. 🟠 **Exporting internal services** — subdomains must expose only facades, never services or repositories
8. 🟠 **Facade containing logic** — facades must be pure delegation to services; all querying and mapping belongs in services

## Decision Tree: Which Reference to Load

```
TASK TYPE                              → LOAD REFERENCE
─────────────────────────────────────────────────────────
Creating a new module from scratch     → references/module-scaffolding.md (Part 1)
Evaluating whether to split a module   → references/module-scaffolding.md (Part 2)
Assessing architecture compliance      → references/verification.md
Understanding a specific principle     → references/principles.md
Running detection commands             → references/verification.md
Maturity scoring                       → references/verification.md
Managing persistence in subdomain      → references/subdomain-persistence.md
  modules (ownership, facades,
  cross-subdomain data access)
```

## Use Case Instructions

### Creating a New Module

Load `references/module-scaffolding.md` — Part 1: Module Creation.

Follow this process:
1. Gather requirements (module name, pattern, entities, external integrations)
2. Decide architecture pattern: **flat** (single domain, 3-8 entities) vs **subdomain-based** (10+ entities or independent scaling needs)
3. If subdomain-based, load `references/subdomain-persistence.md` for persistence ownership patterns
4. Generate structure → config → entities → repositories → persistence module → services → controllers → DTOs → main module → index.ts → NX config files
5. Run verification commands from `references/verification.md`

### Evaluating Whether to Split a Module

Load `references/module-scaffolding.md` — Part 2: Module Evaluation.

Apply the 6-criteria test and cohesion/coupling scoring. Key principle: **flat is often better** — split only when sub-domains prove themselves through real usage.

### Managing Persistence in Subdomain Modules

Load `references/subdomain-persistence.md`.

Use when a subdomain-based module needs to assign entity/repository ownership to individual subdomains. Key patterns:
- **Subdomain-owned persistence**: each subdomain registers its own repos (not shared)
- **Internal facades**: cross-subdomain reads go through explicit facades
- **Event-carried state transfer**: enrich queue payloads to avoid cross-subdomain queries
- **Shared kernel anti-pattern**: detect and refactor monolithic shared persistence

### Assessing Architecture Compliance

Load `references/verification.md`.

Run all detection commands, then score each principle. Produce a prioritized report with P0 (critical), P1 (high), P2 (medium) recommendations.

### Understanding a Specific Principle

Load `references/principles.md`.

Each principle includes: definition, rules for AI agents, and one key code example.

## Quick Anti-Pattern Check

Before generating any code, verify:
- [ ] Entity names use module prefix (`BillingPlan`, not `Plan`)
- [ ] No duplicate `@Entity` names across modules
- [ ] Controllers only inject services (not repositories)
- [ ] Write operations use `@Transactional({ connectionName: 'moduleName' })`
- [ ] `index.ts` exports only facades and module class
- [ ] Cross-module communication via HTTP/events (never direct DB access)
- [ ] In subdomain modules: each subdomain registers its own repos (shared module has zero repos)
- [ ] In subdomain modules: cross-subdomain reads use internal facades, not shared repo injection
