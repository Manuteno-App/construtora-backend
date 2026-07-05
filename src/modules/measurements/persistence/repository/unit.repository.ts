import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Unit, UnitOrigin, UnitStatus } from '../entity/unit.entity';

export interface UnitAdminFilters {
  search?: string;
  familyId?: string;
  status?: UnitStatus;
  origin?: UnitOrigin;
}

@Injectable()
export class UnitRepository extends DefaultTypeOrmRepository<Unit> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Unit, dataSource);
  }

  findById(id: string): Promise<Unit | null> {
    return this.findOne({ where: { id }, relations: { family: true } });
  }

  async findByNormalizedOrAlias(normalizedSymbol: string): Promise<Unit | null> {
    const rows = await this.query<Unit>(
      `SELECT u.*
       FROM units u
       WHERE u.normalized_symbol = $1
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(u.aliases_json::jsonb) AS alias
            WHERE alias = $1
          )
       LIMIT 1`,
      [normalizedSymbol],
    );
    if (rows.length === 0) return null;
    return this.findById(rows[0].id);
  }

  async list(filters: UnitAdminFilters): Promise<Unit[]> {
    const qb = this.createQueryBuilder('u')
      .leftJoinAndSelect('u.family', 'family')
      .orderBy('family.name', 'ASC')
      .addOrderBy('u.name', 'ASC');

    if (filters.search) {
      qb.andWhere('(UPPER(u.name) LIKE UPPER(:search) OR UPPER(u.canonicalSymbol) LIKE UPPER(:search))', {
        search: `%${filters.search}%`,
      });
    }
    if (filters.familyId) {
      qb.andWhere('u.familyId = :familyId', { familyId: filters.familyId });
    }
    if (filters.status) {
      qb.andWhere('u.status = :status', { status: filters.status });
    }
    if (filters.origin) {
      qb.andWhere('u.origin = :origin', { origin: filters.origin });
    }

    return qb.getMany();
  }

  createEntity(data: Partial<Unit>): Unit {
    return this.create(data);
  }

  saveEntity(data: Partial<Unit>): Promise<Unit> {
    return this.save(data as Unit) as Promise<Unit>;
  }

  async updateEntity(id: string, data: Partial<Unit>): Promise<Unit | null> {
    await this.update({ id }, data as Unit);
    return this.findById(id);
  }
}
