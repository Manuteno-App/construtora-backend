import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { UserEntity } from '../entity/user.entity';

@Injectable()
export class UserRepository extends DefaultTypeOrmRepository<UserEntity> {
  constructor(dataSource: DataSource) {
    super(UserEntity, dataSource);
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.findOne({ where: { email } });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.findOne({ where: { id } });
  }

  async createUser(data: { email: string; name: string; passwordHash: string }): Promise<UserEntity> {
    const user = super.create(data);
    return super.save(user) as Promise<UserEntity>;
  }
}
