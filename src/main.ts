import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// Polyfill Map.prototype.getOrInsert / getOrInsertComputed (TC39 Upsert proposal).
// Required by pdfjs-dist v5.5+ but only natively available in Node.js 24 / V8 13.4+.
if (typeof (Map.prototype as any).getOrInsertComputed !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value<K, V>(this: Map<K, V>, key: K, fn: (key: K) => V): V {
      if (!this.has(key)) this.set(key, fn(key));
      return this.get(key) as V;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
if (typeof (Map.prototype as any).getOrInsert !== 'function') {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value<K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
      if (!this.has(key)) this.set(key, defaultValue);
      return this.get(key) as V;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Construtora RAG API')
    .setDescription('Sistema RAG de Atestados de Obras')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
  console.log(`Application running on port ${port}`);
}

bootstrap();
