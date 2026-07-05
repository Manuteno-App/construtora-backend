import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { UnitConversion } from '../entity/unit-conversion.entity';

@Injectable()
export class UnitConversionRepository extends DefaultTypeOrmRepository<UnitConversion> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(UnitConversion, dataSource);
  }

  findAll(): Promise<UnitConversion[]> {
    return this.find({
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
      order: { createdAt: 'DESC' },
    });
  }

  findByPair(sourceUnitId: string, targetUnitId: string): Promise<UnitConversion | null> {
    return this.findOne({
      where: { sourceUnitId, targetUnitId },
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
    });
  }

  createEntity(data: Partial<UnitConversion>): UnitConversion {
    return this.create(data);
  }

  saveEntity(data: Partial<UnitConversion>): Promise<UnitConversion> {
    return this.save(data as UnitConversion) as Promise<UnitConversion>;
  }

  async updateEntity(id: string, data: Partial<UnitConversion>): Promise<UnitConversion | null> {
    await this.update({ id }, data as UnitConversion);
    return this.findOne({
      where: { id },
      relations: { sourceUnit: { family: true }, targetUnit: { family: true } },
    });
  }
}
