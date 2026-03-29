import { AtestadoStatus } from '../../persistence/entity/atestado.entity';

export interface AtestadoRef {
  id: string;
  s3Key: string;
  originalFilename: string;
  status: AtestadoStatus;
  createdAt: Date;
  errorMessage?: string;
}

/**
 * Contract surface for the Documents bounded context.
 * Other modules interact with Atestado exclusively through this interface.
 * When Documents becomes a microservice, swap the in-process facade
 * for an HTTP client implementing this interface — zero changes in consumers.
 */
export interface IDocumentsApi {
  createAtestado(params: { s3Key: string; originalFilename: string }): Promise<AtestadoRef>;
  findAtestadoById(id: string): Promise<AtestadoRef | null>;
  updateAtestadoStatus(
    id: string,
    status: AtestadoStatus,
    errorMessage?: string | null,
  ): Promise<void>;
  deleteAtestado(id: string): Promise<void>;
}

export const DOCUMENTS_API = Symbol('IDocumentsApi');
