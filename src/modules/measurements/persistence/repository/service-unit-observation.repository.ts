import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { ServiceUnitObservation } from '../entity/service-unit-observation.entity';

@Injectable()
export class ServiceUnitObservationRepository extends DefaultTypeOrmRepository<ServiceUnitObservation> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(ServiceUnitObservation, dataSource);
  }

  async findGroupedCandidates(normalizedServiceKey: string): Promise<Array<{
    normalizedServiceKey: string;
    serviceDescription: string;
    unitId: string;
    unitSymbol: string;
    familyId: string;
    familyName: string;
    sampleCount: string;
    avgQuantity: string | null;
  }>> {
    return this.query(
      `SELECT
         o.normalized_service_key AS "normalizedServiceKey",
         MAX(o.service_description) AS "serviceDescription",
         o.unit_id AS "unitId",
         MAX(u.canonical_symbol) AS "unitSymbol",
         MAX(u.family_id) AS "familyId",
         MAX(f.name) AS "familyName",
         COUNT(*)::text AS "sampleCount",
         AVG(o.quantidade)::text AS "avgQuantity"
       FROM service_unit_observations o
       INNER JOIN units u ON u.id = o.unit_id
       INNER JOIN unit_families f ON f.id = u.family_id
       WHERE o.normalized_service_key = $1
       GROUP BY o.normalized_service_key, o.unit_id`,
      [normalizedServiceKey],
    );
  }

  saveEntity(data: Partial<ServiceUnitObservation>): Promise<ServiceUnitObservation> {
    return this.save(data as ServiceUnitObservation) as Promise<ServiceUnitObservation>;
  }

  createEntity(data: Partial<ServiceUnitObservation>): ServiceUnitObservation {
    return this.create(data);
  }
}
