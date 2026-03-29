import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from '../storage/storage.service';
import { Atestado, AtestadoStatus } from '../database/entities/atestado.entity';
import { Chunk } from '../database/entities/chunk.entity';
import { Embedding } from '../database/entities/embedding.entity';
import { INGESTION_QUEUE } from '../queue/queue.module';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(
    @InjectRepository(Atestado)
    private readonly atestadoRepo: Repository<Atestado>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectRepository(Embedding)
    private readonly embeddingRepo: Repository<Embedding>,
    @InjectQueue(INGESTION_QUEUE)
    private readonly ingestionQueue: Queue,
    private readonly storage: StorageService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload de atestado PDF para ingestão' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Somente arquivos PDF são aceitos'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo PDF obrigatório');

    const s3Key = `atestados/${uuidv4()}/${file.originalname}`;
    await this.storage.upload(file.buffer, s3Key, 'application/pdf');

    const atestado = this.atestadoRepo.create({
      s3Key,
      originalFilename: file.originalname,
      status: AtestadoStatus.PENDING,
    });
    await this.atestadoRepo.save(atestado);

    await this.ingestionQueue.add('process-pdf', { atestadoId: atestado.id });

    return { atestadoId: atestado.id, status: atestado.status };
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: 'Re-indexa um atestado existente (útil após melhorias no OCR/extração)' })
  async reindex(@Param('id', ParseUUIDPipe) id: string) {
    const atestado = await this.atestadoRepo.findOneOrFail({ where: { id } });

    // Remove existing chunks (embeddings cascade via FK)
    await this.chunkRepo.delete({ atestadoId: id });

    await this.atestadoRepo.update(id, { status: AtestadoStatus.PENDING, errorMessage: undefined });
    await this.ingestionQueue.add('process-pdf', { atestadoId: id });

    return { atestadoId: id, originalFilename: atestado.originalFilename, status: AtestadoStatus.PENDING };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Status de processamento de um atestado' })
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    const atestado = await this.atestadoRepo.findOneOrFail({ where: { id } });
    return {
      atestadoId: atestado.id,
      status: atestado.status,
      originalFilename: atestado.originalFilename,
      createdAt: atestado.createdAt,
      errorMessage: atestado.errorMessage,
    };
  }
}
