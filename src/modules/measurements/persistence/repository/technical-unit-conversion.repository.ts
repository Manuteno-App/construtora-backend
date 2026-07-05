import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import {
  TechnicalUnitConversion,
  TechnicalUnitConversionStatus,
} from '../entity/technical-unit-conversion.entity';

@Injectable()
export class TechnicalUnitConversionRepository extends DefaultTypeOrmRepository<TechnicalUnitConversion> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(TechnicalUnitConversion, dataSource);
  }

  list(status?: TechnicalUnitConversionStatus): Promise<TechnicalUnitConversion[]> {
    const where = status ? { status } : {};
    return this.find({
      where,
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string): Promise<TechnicalUnitConversion | null> {
    return this.findOne({
      where: { id },
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
    });
  }

  findApprovedByKeyAndPair(
    normalizedServiceKey: string,
    sourceUnitId: string,
    targetUnitId: string,
  ): Promise<TechnicalUnitConversion | null> {
    return this.findOne({
      where: {
        normalizedServiceKey,
        sourceUnitId,
        targetUnitId,
        status: TechnicalUnitConversionStatus.APPROVED,
      },
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
    });
  }

  findExisting(normalizedServiceKey: string, sourceUnitId: string, targetUnitId: string): Promise<TechnicalUnitConversion | null> {
    return this.findOne({
      where: {
        normalizedServiceKey,
        sourceUnitId,
        targetUnitId,
      },
    });
  }

  createEntity(data: Partial<TechnicalUnitConversion>): TechnicalUnitConversion {
    return this.create(data);
  }

  saveEntity(data: Partial<TechnicalUnitConversion>): Promise<TechnicalUnitConversion> {
    return this.save(data as TechnicalUnitConversion) as Promise<TechnicalUnitConversion>;
  }

  async updateEntity(id: string, data: Partial<TechnicalUnitConversion>): Promise<TechnicalUnitConversion | null> {
    await this.update({ id }, data as TechnicalUnitConversion);
    return this.findById(id);
  }
}
