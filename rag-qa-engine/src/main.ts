// src/main.ts


import { NestFactory }         from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger }              from '@nestjs/common';
import { AppModule }           from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ 
      logger: false,
      trustProxy: true,
    }),
  );
  const fastifyInstance = app.getHttpAdapter().getInstance();
  
  // Register CORS directly on the Fastify instance 
 await fastifyInstance.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*', // Allow all headers for testing
});

  // Global request logger for debugging
  fastifyInstance.addHook('onRequest', async (request, reply) => {
    logger.log(`[Request] ${request.method} ${request.url} - Origin: ${request.headers.origin}`);
  });

  const port = process.env.PORT ?? 3002;
  await app.listen(3002, '0.0.0.0');
  logger.log(`API running at http://localhost:${port}`);
}

bootstrap();

