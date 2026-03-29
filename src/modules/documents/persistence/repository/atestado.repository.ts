import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Atestado, AtestadoStatus } from '../entity/atestado.entity';

@Injectable()
export class AtestadoRepository extends DefaultTypeOrmRepository<Atestado> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Atestado, dataSource);
  }

  async findById(id: string): Promise<Atestado | null> {
    return this.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<Atestado> {
    const atestado = await this.findOne({ where: { id } });
    if (!atestado) throw new Error(`Atestado ${id} não encontrado`);
    return atestado;
  }

  async findByIdWithRelations(id: string): Promise<Atestado | null> {
    return this.findOne({
      where: { id },
      relations: ['obras', 'obras.contratos', 'obras.contratos.empresa'],
    });
  }

  async findPaginated(
    status: AtestadoStatus | undefined,
    page: number,
    limit: number,
  ): Promise<[Atestado[], number]> {
    const qb = this.createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.where('a.status = :status', { status });
    }

    return qb.getManyAndCount();
  }

  async createAndSave(data: { s3Key: string; originalFilename: string }): Promise<Atestado> {
    const entity = super.create({ ...data, status: AtestadoStatus.PENDING });
    return (await super.save(entity)) as Atestado;
  }

  async updateStatus(
    id: string,
    status: AtestadoStatus,
    errorMessage?: string | null,
  ): Promise<void> {
    await this.update(
      { id },
      { status, ...(errorMessage !== undefined ? { errorMessage: errorMessage ?? undefined } : {}) },
    );
  }

  async deleteById(id: string): Promise<void> {
    await this.delete({ id });
  }
}
