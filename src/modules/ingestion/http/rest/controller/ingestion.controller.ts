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
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { IngestionService } from '../../../core/service/ingestion.service';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload de atestado PDF para ingestão' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
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
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo PDF obrigatório');
    return this.ingestionService.uploadAndEnqueue(file);
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
