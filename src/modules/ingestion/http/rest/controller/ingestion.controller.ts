import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { IngestionService } from '../../../core/service/ingestion.service';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 20;

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload de um ou mais atestados PDF para ingestão' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
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
  upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) throw new BadRequestException('Ao menos um arquivo PDF é obrigatório');
    return this.ingestionService.uploadManyAndEnqueue(files);
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: 'Re-indexa um atestado existente' })
  reindex(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestionService.reindex(id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Status de processamento de um atestado' })
  getStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestionService.getStatus(id);
  }
}
