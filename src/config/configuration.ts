import * as Joi from 'joi';

export const configurationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),

  OPENAI_API_KEY: Joi.string().required(),
  CHAT_MODEL: Joi.string().default('gpt-4o-mini'),
  EXTRACTION_MODEL: Joi.string().default('gpt-4o'),

  EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().default(1536),
  EMBEDDING_BATCH_SIZE: Joi.number().default(20),

  RAG_TOP_K: Joi.number().default(20),
  RAG_SIMILARITY_THRESHOLD: Joi.number().default(0.35),
  QUALIFICATION_CONFIDENCE_THRESHOLD: Joi.number().default(0.05),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  ADMIN_EMAIL: Joi.string().email().required(),
  ADMIN_PASSWORD: Joi.string().min(8).required(),
});

export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),

  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,

  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET,
  },

  openaiApiKey: process.env.OPENAI_API_KEY,
  chatModel: process.env.CHAT_MODEL ?? 'gpt-4o-mini',
  extractionModel: process.env.EXTRACTION_MODEL ?? 'gpt-4o-mini',

  embedding: {
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1536', 10),
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '20', 10),
  },

  rag: {
    topK: parseInt(process.env.RAG_TOP_K ?? '50', 10),
    similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD ?? '0.35'),
  },

  qualification: {
    confidenceThreshold: parseFloat(process.env.QUALIFICATION_CONFIDENCE_THRESHOLD ?? '0.05'),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
  },

  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },

});

export type AppConfig = ReturnType<typeof configuration>;
