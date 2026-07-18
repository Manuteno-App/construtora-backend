# Verification Reference

Detection commands, compliance checklists, and maturity assessment framework.

---

# Part 1: Detection Commands

Run these commands to detect violations. **Never skip — they reveal hidden issues.**

## State Isolation (Principle 8) — Run First

```bash
# 1. Duplicate @Entity names (MOST CRITICAL — run this first)
grep -r "@Entity.*name:" packages/ | grep -o "name: '[^']*'" | sort | uniq -d

# 2. Which modules have duplicates
grep -r "@Entity.*name:" packages/ | \
  sed "s/.*packages\/\([^/]*\)\/.*@Entity.*name: *['\"\(]\([^'\"]*\)['\"\)].*/\1:\2/" | \
  sort | awk -F: '{if($2==prev){print "❌ DUPLICATE: " $2 " in " prevmod " and " $1} prevmod=$1; prev=$2}'

# 3. Cross-module entity imports
grep -r "from.*@tlc.*/.*entity" packages/ | grep -v shared

# 4. Shared database configurations (non-env-variable)
grep -r "host.*database.*username" packages/ | grep -v "process.env.*_DATABASE_" | head -5

# 5. Each persistence module has named connection
for module in packages/*/persistence/*.module.ts; do
  if ! grep -q "name: '[a-z]*'" "$module"; then echo "❌ Missing named connection in $module"; fi
done
```

**Expected for all state isolation checks**: Empty output (no violations)

## Subdomain Persistence Ownership (Subdomain-Based Modules)

```bash
# 1. Shared persistence module exporting repositories (VIOLATION in subdomain modules)
rg "exports:.*Repository" package/*/shared/persistence/*.module.ts

# 2. Subdomain services importing from shared persistence repos
rg "from.*shared/persistence/repository" package/*/*/core/service/

# 3. Cross-subdomain direct imports (subdomain A importing B's persistence)
rg "from.*\.\./\.\./\.\./(?!shared)" package/*/*/core/service/

# 4. Queue contract types defined inside a subdomain (should be in shared/contract/)
rg "export interface.*JobData" package/*/*/queue/
```

**Expected**: Empty output for checks 1-3. Check 4 shows contracts only in `shared/contract/`.

## Controller Pattern Violations (Principle 1, Lean Controllers)

```bash
# Controllers with repository injections
grep -r "Repository" packages/*/http/rest/controller/*.ts

# Long controller methods (>30 lines)
awk '/async.*\(.*\).*{/,/^  }/' packages/*/http/rest/controller/*.ts | \
  awk 'BEGIN{count=0;name=""} /async/{name=$0;count=0} /{count++} /^  }/ && count>30 {print name " - " count " lines"}'
```

## Transaction Management (Principle 8, Coding Patterns)

```bash
# Write operations without @Transactional
grep -r "\.save\|\.create\|\.update\|\.delete" packages/*/core/service/*.ts | grep -v "@Transactional"

# @Transactional without connectionName
grep -r "@Transactional()" packages/
```

## Repository Pattern Compliance

```bash
# Repositories extending TypeORM Repository directly (violation)
grep -r "extends Repository" packages/*/persistence/repository/*.ts

# Missing named DataSource injection
grep -L "@InjectDataSource" packages/*/persistence/repository/*.repository.ts

# Services with TypeORM imports (ORM leakage)
grep -r "from 'typeorm'" packages/*/core/service/*.ts | grep -v "typeorm-transactional"
```

## Observability (Principle 9)

```bash
# Services without logging
find packages/*/core/service -name "*.service.ts" -exec grep -L "Logger" {} \;

# HTTP calls without timeout
grep -r "httpService\|axios" packages/ | grep -v "timeout:"

# Check for circuit breaker usage
grep -r "CircuitBreaker" packages/

# Hardcoded API keys (CRITICAL security issue)
grep -r "apiKey.*=.*['\"]" packages/ --exclude-dir=node_modules
```

## Boundary Violations (Principle 1)

```bash
# Clients shared across modules (violation)
grep -r "from '@.*/http/client" packages/

# Internal services exported in index.ts
grep -r "export.*Service\|export.*Repository" packages/*/index.ts
```

---

# Part 2: Compliance Checklists

## New Feature Checklist

```
□ Identify correct module (doesn't cross bounded context)
□ Entity uses module-prefixed name (e.g., BillingCustomer)
□ No duplicate @Entity names across modules
□ Repository extends DefaultTypeOrmRepository
□ Repository uses @InjectDataSource('moduleName')
□ No TypeORM operators/where/relations in services
□ Controller is lean (<20 lines/method, no business logic)
□ Controller only injects services (never repositories)
□ Write operations use @Transactional({ connectionName: 'moduleName' })
□ No nested @Transactional methods
□ Read-only operations have no @Transactional
□ Cross-module communication via HTTP/events (not direct DB)
□ index.ts exports only facades and module class
□ Structured logging with module identifier
□ Circuit breakers for external service calls
□ Run detection commands (no violations)
□ Tests are module-isolated (no other module's DB)
```

## Refactoring Checklist

```
□ Preserve existing module boundaries
□ Maintain existing facade/interface contracts
□ Fat Controller → move logic to service, remove repo injections
□ Direct Repository → extend DefaultTypeOrmRepository, named DataSource
□ Missing Transactions → add @Transactional({ connectionName })
□ ORM leakage → move where/relations to repository methods
□ Shared persistence anti-pattern → move repos to owning subdomains
□ Cross-subdomain direct imports → add internal facades
□ Queue contracts in subdomain → move to shared/contract/
□ Run detection commands (still clean after refactor)
□ All tests pass
```

## Pre-Commit Checklist

```
□ grep -r "@Entity.*name:" packages/ | grep -o "name: '[^']*'" | sort | uniq -d
□ grep -r "from.*@tlc.*/.*entity" packages/ | grep -v shared
□ grep -r "@Transactional()" packages/  (should have no results)
□ All unit tests pass
□ No linter errors
```

---

# Part 3: Maturity Assessment Framework

## Assessment Process

1. Run all detection commands above
2. Score each principle (1-10)
3. Apply weighted scoring
4. Determine maturity level
5. Generate prioritized recommendations

## Scoring per Principle

- **10 — Excellent**: Full compliance, best practices followed
- **8-9 — Good**: Strong compliance, minor improvements
- **6-7 — Acceptable**: Partial compliance, some violations
- **4-5 — Needs Improvement**: Multiple violations, requires attention
- **1-3 — Critical**: Major violations, immediate action required

## Weighted Scoring Table

| Principle | Weight | Notes |
|-----------|--------|-------|
| 1. Well-Defined Boundaries | 1.0 | |
| 2. Composability | 0.8 | |
| 3. Independence | 1.0 | |
| 4. Individual Scale | 0.6 | |
| 5. Explicit Communication | 1.0 | |
| 6. Replaceability | 0.8 | |
| 7. Deployment Independence | 0.7 | |
| 8. State Isolation ⚠️ | **1.5** | Highest weight — most critical |
| 9. Observability | 0.9 | |
| 10. Fail Independence | 0.9 | |

Total possible: 100 weighted points (each principle max score × weight, normalized to 100)

## Maturity Level Definitions

| Level | Score | Characteristics |
|-------|-------|-----------------|
| **Immature** | 0-40 | Critical violations, no clear boundaries, shared state, multiple P0 issues |
| **Developing** | 41-65 | Some boundaries defined, known critical issues, can deploy with risk |
| **Mature** | 66-85 | Strong boundaries, good compliance, safe independent deployment, mostly P2/P3 |
| **Advanced** | 86-100 | Excellent compliance, best practices throughout, zero critical violations |

## Report Template

```markdown
# Modularity Maturity Assessment Report

**Assessment Date**: [Date]
**Codebase**: Fakeflix

---

## Executive Summary

- **Overall Maturity Level**: [Immature/Developing/Mature/Advanced]
- **Critical Issues**: [Count] P0 violations
- **Compliance Score**: [X/100] weighted points
- **Key Strengths**: ...
- **Key Weaknesses**: ...

---

## Principle-by-Principle Assessment

### Principle 8: State Isolation ⚠️ CRITICAL

**Status**: [✅ Compliant / ⚠️ Partial / ❌ Violated]
**Score**: X/10

**Duplicate Entity Names Detection**:
```
[Output from: grep -r "@Entity.*name:" packages/ | grep -o "name: '[^']*'" | sort | uniq -d]
```

**Evidence**: [Specific violations with file paths]
**Recommendations**: [Actionable fixes]

[Repeat for all 10 principles]

---

## Detection Command Results

[Output from each command in Part 1]

---

## Maturity Scoring

| Principle | Score | Weight | Weighted Score |
|-----------|-------|--------|----------------|
| 1. Boundaries | X/10 | 1.0 | X |
| ... | | | |
| 8. State Isolation | X/10 | 1.5 | X |
| **TOTAL** | | | **X/100** |

---

## Recommendations by Priority

### P0 — Critical (Fix Immediately)
[Violations that block safe operation]

### P1 — High (Fix This Sprint)
[Violations causing technical debt]

### P2 — Medium (Next 2-3 Sprints)
[Improvements for better compliance]

### P3 — Low (Nice to Have)
[Enhancements when capacity allows]
```

---

# Part 4: Automation

## Pre-commit Hook

Create `.git/hooks/pre-commit` and make it executable (`chmod +x`):

```bash
#!/bin/bash
echo "🔍 Running Architecture Verification..."

# 1. State Isolation — CRITICAL
echo "Checking for duplicate entity names..."
DUPLICATES=$(grep -r "@Entity.*name:" packages/ | grep -o "name: '[^']*'" | sort | uniq -d)
if [ ! -z "$DUPLICATES" ]; then
  echo "❌ COMMIT BLOCKED: Duplicate entity names found:"
  echo "$DUPLICATES"
  echo "Fix: use module-prefixed names like @Entity({ name: 'BillingPlan' })"
  exit 1
fi

# 2. Cross-Module Imports
CROSS_IMPORTS=$(grep -r "from.*@tlc.*/.*entity" packages/ | grep -v shared)
if [ ! -z "$CROSS_IMPORTS" ]; then
  echo "❌ COMMIT BLOCKED: Cross-module entity imports found:"
  echo "$CROSS_IMPORTS"
  exit 1
fi

# 3. Controller Violations (warning only)
CONTROLLER_REPOS=$(grep -r "Repository" packages/*/http/rest/controller/*.ts 2>/dev/null)
if [ ! -z "$CONTROLLER_REPOS" ]; then
  echo "⚠️  Warning: Controllers with repository injections:"
  echo "$CONTROLLER_REPOS"
fi

# 4. Transaction Usage (warning only)
MISSING_CONNECTION=$(grep -r "@Transactional()" packages/ 2>/dev/null)
if [ ! -z "$MISSING_CONNECTION" ]; then
  echo "⚠️  Warning: @Transactional without connectionName:"
  echo "$MISSING_CONNECTION"
fi

echo "✅ Architecture verification passed"
exit 0
```

## CI/CD Integration

```yaml
# .github/workflows/architecture-check.yml
name: Architecture Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Check State Isolation
        run: |
          DUPLICATES=$(grep -r "@Entity.*name:" packages/ | grep -o "name: '[^']*'" | sort | uniq -d)
          if [ ! -z "$DUPLICATES" ]; then
            echo "❌ Duplicate entity names found"
            exit 1
          fi

      - name: Check Cross-Module Imports
        run: |
          VIOLATIONS=$(grep -r "from.*@tlc.*/.*entity" packages/ | grep -v shared)
          if [ ! -z "$VIOLATIONS" ]; then
            echo "❌ Cross-module entity imports found"
            exit 1
          fi

      - name: Check Controller Patterns
        run: |
          VIOLATIONS=$(grep -r "Repository" packages/*/http/rest/controller/*.ts 2>/dev/null || true)
          if [ ! -z "$VIOLATIONS" ]; then
            echo "⚠️  Controllers with repository injections:"
            echo "$VIOLATIONS"
          fi
```
