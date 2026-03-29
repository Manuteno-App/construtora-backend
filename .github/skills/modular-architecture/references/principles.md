# Modular Architecture Principles Reference

All 10 principles with rules and key code examples.

---

## Principle 1: Well-Defined Boundaries

Each module has clear responsibilities and doesn't expose internal details to other modules.

**Rules:**
- ✅ Keep all domain logic within module boundaries
- ✅ Export only public facades and modules from `index.ts`
- ❌ Never import internal classes from other modules
- ❌ Never share database entities between modules

```typescript
// ✅ GOOD: packages/billing/src/index.ts
export { BillingModule } from './billing.module';
export { billingConfigFactory } from './config';
// Services, repositories, entities stay internal

// ❌ BAD: Exposing internals
export { SubscriptionService } from './core/service/subscription.service';
export { Subscription } from './persistence/entity/subscription.entity';
```

---

## Principle 2: Composability

Modules are building blocks that combine flexibly to create different applications.

**Rules:**
- ✅ Design modules to work independently or together
- ✅ Create multiple apps with different module combinations
- ✅ Use dependency injection for loose coupling
- ❌ Never create tight coupling between modules

```typescript
// ✅ GOOD: Same modules, different app compositions
@Module({ imports: [ContentModule, IdentityModule] })  // Monolith
export class MonolithModule {}

@Module({ imports: [BillingModule] })  // Microservice
export class BillingApiModule {}
```

---

## Principle 3: Independence

Modules operate autonomously without tight coupling in code or infrastructure.

**Rules:**
- ✅ Modules can be built, tested, and deployed independently
- ✅ Use interfaces and events for inter-module communication
- ✅ Each module's tests run in isolation
- ❌ Never create shared mutable state between modules
- ❌ Never use direct method calls between modules

```typescript
// ✅ GOOD: Communication via interface, not direct dependency
export interface BillingSubscriptionStatusApi {
  isUserSubscriptionActive(userId: string): Promise<boolean>;
}

@Injectable()
export class BillingFacade implements BillingSubscriptionStatusApi {
  constructor(private readonly subscriptionService: SubscriptionService) {}
  async isUserSubscriptionActive(userId: string): Promise<boolean> {
    return this.subscriptionService.isUserSubscriptionActive(userId);
  }
}

// ❌ BAD: Direct coupling to another module's service
@Injectable()
export class SubscriptionService {
  constructor(private identityService: IdentityService) {} // ❌
}
```

---

## Principle 4: Individual Scale

Each module can scale based on its specific resource needs without affecting others.

**Rules:**
- ✅ Design modules to scale independently (multiple app instances)
- ✅ Use resource-specific configurations per module
- ❌ Never create shared resource bottlenecks between modules

```typescript
// ✅ GOOD: Module-specific scaling configuration
BullModule.registerQueue({
  name: QUEUES.VIDEO_PROCESSING,
  processors: [{ name: 'video-transcription', concurrency: 5 }], // Content-specific
})
```

---

## Principle 5: Explicit Communication

All inter-module communication happens through well-defined contracts.

**Rules:**
- ✅ Define clear interfaces for all module interactions
- ✅ Use DTOs for data transfer between modules
- ❌ Never access other modules' internal data structures
- ❌ Never make assumptions about other modules' implementations

```typescript
// ✅ GOOD: Explicit interface contract in shared package
export interface BillingSubscriptionStatusApi {
  isUserSubscriptionActive(userId: string): Promise<boolean>;
  getSubscriptionPlan(userId: string): Promise<SubscriptionPlan | null>;
}

// ✅ GOOD: HTTP client implements the contract
@Injectable()
export class BillingSubscriptionHttpClient implements BillingSubscriptionStatusApi {
  async isUserSubscriptionActive(userId: string): Promise<boolean> {
    const { isActive } = await this.httpClient.get<...>(
      `${this.configService.get('billingApi').url}/subscription/user/${userId}/active`
    );
    return isActive;
  }
}

// ✅ GOOD: Typed queue payloads
export interface VideoProcessingJobData {
  videoId: string;
  url: string;
  processingType: 'transcription' | 'summary' | 'age-rating';
}
```

---

## Principle 6: Replaceability

Modules can be substituted without affecting other parts of the architecture.

**Rules:**
- ✅ Design modules to be swappable behind interfaces
- ✅ Use dependency injection for all module dependencies
- ❌ Never create hard dependencies on specific implementations
- ❌ Never export concrete classes as module APIs

```typescript
// ✅ GOOD: Swappable implementations
@Module({
  providers: [{
    provide: VideoSummaryGenerationAdapter,
    useFactory: (config: ConfigService) => {
      switch (config.get('VIDEO_PROCESSING_PROVIDER')) {
        case 'gemini': return new GeminiTextExtractorClient();
        case 'openai': return new OpenAITextExtractorClient();
      }
    },
    inject: [ConfigService],
  }],
})
export class ContentVideoProcessorModule {}
```

---

## Principle 7: Deployment Independence

Modules don't dictate how they're deployed — they can run as monolith or distributed services.

**Rules:**
- ✅ Design modules to work in any deployment configuration
- ✅ Use environment variables for deployment-specific config
- ✅ Keep deployment logic in apps, not modules
- ❌ Never hard-code deployment assumptions in modules

```typescript
// ✅ GOOD: Deployment-agnostic module
@Module({
  imports: [TypeOrmModule.forRootAsync({
    useFactory: (config: ConfigService) => ({
      host: config.get('CONTENT_DB_HOST'), // Environment-driven
      port: config.get('CONTENT_DB_PORT'),
      database: config.get('CONTENT_DB_NAME'),
    }),
  })],
})
export class ContentModule {}
```

---

## Principle 8: State Isolation ⚠️ CRITICAL

Each module owns and manages its own state without sharing databases with other modules.

**Rules:**
- ✅ Give each module its own named database connection
- ✅ Prefix ALL entity names with module name (e.g., `BillingPlan`, not `Plan`)
- ✅ Use events or APIs for cross-module data needs
- ✅ Replicate minimal data per module (string references, not foreign keys)
- ❌ NEVER create duplicate `@Entity({ name: 'X' })` across modules — most critical violation
- ❌ Never share database tables between modules
- ❌ Never access other modules' repositories
- ❌ Never use foreign keys across module boundaries

_See `docs/coding-patterns.md` — Entity Naming, DB Configuration, Cross-Module Data Access sections._

---

## Principle 9: Observability

Each module provides individual visibility into its health, performance, and behavior.

**Rules:**
- ✅ Add module-specific logging with module identifier
- ✅ Track business and technical metrics (counters, histograms)
- ✅ Implement module health check endpoint
- ✅ Include correlation IDs for request tracing
- ❌ Never mix module concerns in logging/monitoring

_See `docs/integration-patterns.md` — Structured Logging, Metrics and Health Checks sections._

---

## Principle 10: Fail Independence

Failures in one module don't cascade to other modules.

**Rules:**
- ✅ Implement circuit breakers for external/inter-module calls
- ✅ Design graceful degradation for non-critical features
- ✅ Use timeouts and retries with exponential backoff
- ❌ Never let one module's failure bring down others
- ❌ Never create synchronous dependencies that cascade failures

_See `docs/integration-patterns.md` — Circuit Breakers, Timeouts and Retries sections._
