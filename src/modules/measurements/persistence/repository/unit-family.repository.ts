import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { UnitFamily } from '../entity/unit-family.entity';

@Injectable()
export class UnitFamilyRepository extends DefaultTypeOrmRepository<UnitFamily> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(UnitFamily, dataSource);
  }

  findAll(): Promise<UnitFamily[]> {
    return this.find({ order: { name: 'ASC' } });
  }

  findById(id: string): Promise<UnitFamily | null> {
    return this.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<UnitFamily | null> {
    return this.findOne({ where: { slug } });
  }
}
