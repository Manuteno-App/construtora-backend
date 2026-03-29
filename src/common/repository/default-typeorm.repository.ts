import {
  DataSource,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  DeepPartial,
  ObjectLiteral,
} from 'typeorm';

/**
 * Base repository that encapsulates TypeORM internals.
 * Subclasses expose only domain-named methods (e.g. findActiveById) — never
 * raw TypeORM options — so services remain decoupled from the persistence layer.
 */
export abstract class DefaultTypeOrmRepository<T extends ObjectLiteral> {
  protected readonly manager: EntityManager;

  constructor(
    private readonly entity: EntityTarget<T>,
    dataSource: DataSource,
  ) {
    this.manager = dataSource.manager;
  }

  protected findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.manager.findOne(this.entity, options);
  }

  protected find(options?: FindManyOptions<T>): Promise<T[]> {
    return this.manager.find(this.entity, options);
  }

  protected findAndCount(options?: FindManyOptions<T>): Promise<[T[], number]> {
    return this.manager.findAndCount(this.entity, options);
  }

  protected create(data: DeepPartial<T>): T {
    return this.manager.create(this.entity, data);
  }

  protected async save(entity: DeepPartial<T> | DeepPartial<T>[]): Promise<T | T[]> {
    return this.manager.save(this.entity, entity as DeepPartial<T>[]) as Promise<T | T[]>;
  }

  protected async update(criteria: FindOptionsWhere<T>, data: Partial<T>): Promise<void> {
    await this.manager.update(this.entity, criteria, data);
  }

  protected async delete(criteria: FindOptionsWhere<T>): Promise<void> {
    await this.manager.delete(this.entity, criteria);
  }

  protected createQueryBuilder(alias?: string) {
    if (alias) {
      return this.manager.createQueryBuilder(this.entity, alias);
    }
    return this.manager.createQueryBuilder();
  }

  protected query<R = unknown>(sql: string, params?: unknown[]): Promise<R[]> {
    return this.manager.query(sql, params as unknown[]) as Promise<R[]>;
  }
}
