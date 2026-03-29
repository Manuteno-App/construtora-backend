import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  FeatureType,
  Block,
} from '@aws-sdk/client-textract';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

export interface TextractCell {
  rowIndex: number;
  colIndex: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  confidence: number;
}

export interface TextractTable {
  page: number;
  cells: TextractCell[];
  rows: number;
  cols: number;
}

export interface OcrResult {
  text: string;
  pages: Array<{ pageNumber: number; text: string }>;
  tables: TextractTable[];
  keyValuePairs: Record<string, string>;
  avgConfidence: number;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly textractClient: TextractClient;
  private readonly s3Client: S3Client;
  private readonly stagingBucket: string;

  constructor(private readonly config: ConfigService) {
    const region = config.get<string>('aws.textractRegion') ?? 'us-east-1';
    const credentials = {
      accessKeyId: config.get<string>('aws.accessKeyId') ?? '',
      secretAccessKey: config.get<string>('aws.secretAccessKey') ?? '',
    };
    this.textractClient = new TextractClient({ region, credentials });
    // S3 client in the same region as Textract for the staging bucket
    this.s3Client = new S3Client({ region, credentials, followRegionRedirects: true });
    this.stagingBucket = config.get<string>('aws.textractBucket') ?? '';
  }

  /**
   * Stages the PDF buffer to a us-east-1 S3 bucket, runs an async Textract job,
   * then deletes the temporary object regardless of outcome.
   * This is required because:
   *   - DetectDocumentText (sync) only accepts JPEG/PNG bytes, not PDF
   *   - StartDocumentTextDetection (async) requires S3 in the same region as Textract
   */
  async extractText(buffer: Buffer): Promise<OcrResult> {
    if (!this.stagingBucket) {
      throw new Error(
        'AWS_TEXTRACT_BUCKET is not set. Create an S3 bucket in us-east-1 and add it to .env',
      );
    }
    const tempKey = `ocr-staging/${randomUUID()}.pdf`;
    this.logger.log(`Staging PDF to s3://${this.stagingBucket}/${tempKey}`);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.stagingBucket,
        Key: tempKey,
        Body: buffer,
        ContentType: 'application/pdf',
      }),
    );

    try {
      return await this.runAsyncJob(tempKey);
    } finally {
      await this.s3Client
        .send(new DeleteObjectCommand({ Bucket: this.stagingBucket, Key: tempKey }))
        .catch((e) =>
          this.logger.warn(`Could not delete staging object ${tempKey}`, e),
        );
    }
  }

  private async runAsyncJob(s3Key: string): Promise<OcrResult> {
    const start = await this.textractClient.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: { Bucket: this.stagingBucket, Name: s3Key },
        },
        FeatureTypes: [FeatureType.TABLES, FeatureType.FORMS],
      }),
    );
    const jobId = start.JobId;
    if (!jobId) throw new Error('Textract did not return a JobId');
    this.logger.log(`Textract AnalyzeDocument job started: ${jobId}`);
    const blocks = await this.pollJob(jobId);
    return this.blocksToResult(blocks);
  }

  private async pollJob(
    jobId: string,
    intervalMs = 3000,
    maxWaitMs = 300_000,
  ): Promise<Block[]> {
    const deadline = Date.now() + maxWaitMs;
    const allBlocks: Block[] = [];

    while (Date.now() < deadline) {
      await this.sleep(intervalMs);

      const res = await this.textractClient.send(
        new GetDocumentAnalysisCommand({ JobId: jobId }),
      );

      const status = res.JobStatus;

      if (status === 'FAILED') {
        throw new Error(
          `Textract job ${jobId} failed: ${res.StatusMessage ?? 'unknown'}`,
        );
      }

      if (status === 'SUCCEEDED' || status === 'PARTIAL_SUCCESS') {
        allBlocks.push(...(res.Blocks ?? []));
        // Paginate through remaining result pages
        let nextToken = res.NextToken;
        while (nextToken) {
          const page = await this.textractClient.send(
            new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken }),
          );
          allBlocks.push(...(page.Blocks ?? []));
          nextToken = page.NextToken;
        }
        return allBlocks;
      }

      this.logger.debug(`Textract job ${jobId} status: ${status ?? 'IN_PROGRESS'}`);
    }

    throw new Error(`Textract job ${jobId} timed out after ${maxWaitMs / 1000}s`);
  }

  private blocksToResult(blocks: Block[]): OcrResult {
    const blockMap = new Map<string, Block>(blocks.map((b) => [b.Id!, b]));
    const pageTextMap = new Map<number, string[]>();
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const block of blocks) {
      if (block.Confidence != null) {
        totalConfidence += block.Confidence;
        confidenceCount++;
      }
      if (block.BlockType !== 'LINE' || !block.Text) continue;
      const pageNum = block.Page ?? 1;
      if (!pageTextMap.has(pageNum)) pageTextMap.set(pageNum, []);
      pageTextMap.get(pageNum)!.push(block.Text);
    }

    const tables = blocks
      .filter((b) => b.BlockType === 'TABLE')
      .map((b) => this.parseTable(b, blockMap));

    const keyValuePairs = this.parseKeyValuePairs(blocks, blockMap);

    const pages = Array.from(pageTextMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([pageNumber, lines]) => ({ pageNumber, text: lines.join('\n') }));

    return {
      text: pages.map((p) => p.text).join('\n\n'),
      pages,
      tables,
      keyValuePairs,
      avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    };
  }

  private parseTable(tableBlock: Block, blockMap: Map<string, Block>): TextractTable {
    const cells: TextractCell[] = [];
    const page = tableBlock.Page ?? 1;
    let maxRow = 0;
    let maxCol = 0;

    const cellIds =
      tableBlock.Relationships?.find((r) => r.Type === 'CHILD')?.Ids ?? [];

    for (const cellId of cellIds) {
      const cell = blockMap.get(cellId);
      if (!cell || (cell.BlockType !== 'CELL' && cell.BlockType !== 'MERGED_CELL')) continue;

      const rowIndex = cell.RowIndex ?? 0;
      const colIndex = cell.ColumnIndex ?? 0;
      const rowSpan = cell.RowSpan ?? 1;
      const colSpan = cell.ColumnSpan ?? 1;

      const wordIds =
        cell.Relationships?.find((r) => r.Type === 'CHILD')?.Ids ?? [];
      const text = wordIds
        .map((id) => blockMap.get(id))
        .filter(
          (b) =>
            b &&
            (b.BlockType === 'WORD' || b.BlockType === 'SELECTION_ELEMENT'),
        )
        .map((b) =>
          b!.BlockType === 'SELECTION_ELEMENT'
            ? b!.SelectionStatus === 'SELECTED'
              ? 'X'
              : ''
            : (b!.Text ?? ''),
        )
        .join(' ')
        .trim();

      if (rowIndex > maxRow) maxRow = rowIndex;
      if (colIndex > maxCol) maxCol = colIndex;

      cells.push({ rowIndex, colIndex, rowSpan, colSpan, text, confidence: cell.Confidence ?? 0 });
    }

    return { page, cells, rows: maxRow, cols: maxCol };
  }

  private parseKeyValuePairs(
    blocks: Block[],
    blockMap: Map<string, Block>,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    const keyBlocks = blocks.filter(
      (b) =>
        b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY'),
    );

    for (const keyBlock of keyBlocks) {
      const keyWordIds =
        keyBlock.Relationships?.find((r) => r.Type === 'CHILD')?.Ids ?? [];
      const keyText = keyWordIds
        .map((id) => blockMap.get(id))
        .filter((b) => b?.BlockType === 'WORD')
        .map((b) => b!.Text ?? '')
        .join(' ')
        .trim();

      if (!keyText) continue;

      const valueBlockIds =
        keyBlock.Relationships?.find((r) => r.Type === 'VALUE')?.Ids ?? [];
      for (const valueId of valueBlockIds) {
        const valueBlock = blockMap.get(valueId);
        if (!valueBlock) continue;

        const valueWordIds =
          valueBlock.Relationships?.find((r) => r.Type === 'CHILD')?.Ids ?? [];
        const valueText = valueWordIds
          .map((id) => blockMap.get(id))
          .filter((b) => b?.BlockType === 'WORD')
          .map((b) => b!.Text ?? '')
          .join(' ')
          .trim();

        if (valueText) {
          result[keyText] = valueText;
        }
      }
    }

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}


