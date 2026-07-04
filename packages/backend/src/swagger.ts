import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mount the OpenAPI documentation.
 *
 * Serves the interactive Swagger UI at `/docs` and the raw OpenAPI JSON at
 * `/docs/json` — the same two entry points the old Fastify API exposed. The
 * document is generated from the controllers' DTOs (`class-validator` +
 * `@ApiProperty` metadata), so it stays in lockstep with the request/response
 * contract without a hand-maintained schema.
 *
 * Called from `bootstrap` (and from the docs e2e) after the app is created and
 * before it starts listening.
 *
 * @param app - the created Nest application.
 * @param version - the OpenAPI `info.version` (the server package version).
 */
export function setupSwagger(app: INestApplication, version = '0.0.0'): void {
  const config = new DocumentBuilder()
    .setTitle('lametrader API')
    .setVersion(version)
    .addTag('config', 'Global configuration')
    .addTag('symbols', 'Symbol discovery and watchlist')
    .addTag('profiles', 'Profiles (selectable templates)')
    .addTag('rules', 'Rule definitions and events (per ADR 0016)')
    .addTag('candles', 'Historical candle backfill and reads')
    .addTag('indicators', 'Indicator catalog (descriptors only)')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/json' });
}
