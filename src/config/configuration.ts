import * as Joi from 'joi';

export const configurationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  AWS_REGION: Joi.string().required(),
  AWS_TEXTRACT_REGION: Joi.string().default('us-east-1'),
  AWS_TEXTRACT_BUCKET: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),

  OPENAI_API_KEY: Joi.string().required(),

  EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().default(1536),
  EMBEDDING_BATCH_SIZE: Joi.number().default(20),

  RAG_TOP_K: Joi.number().default(10),
  RAG_SIMILARITY_THRESHOLD: Joi.number().default(0.35),

});

export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,

  aws: {
    region: process.env.AWS_REGION,
    textractRegion: process.env.AWS_TEXTRACT_REGION ?? 'us-east-1',
    textractBucket: process.env.AWS_TEXTRACT_BUCKET,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET,
  },

  openaiApiKey: process.env.OPENAI_API_KEY,

  embedding: {
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1536', 10),
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '20', 10),
  },

  rag: {
    topK: parseInt(process.env.RAG_TOP_K ?? '10', 10),
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD ?? '0.35'),
  },

});

export type AppConfig = ReturnType<typeof configuration>;
