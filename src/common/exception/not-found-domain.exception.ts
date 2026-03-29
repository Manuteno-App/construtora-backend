import { DomainException } from './domain.exception';

export class NotFoundDomainException extends DomainException {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} não encontrado`, 'NOT_FOUND');
    this.name = 'NotFoundDomainException';
  }
}
