import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Duckworth API',
        description: 'Household shopping coordination API',
        version: '1.0.0',
      },
      tags: [{ name: 'health' }, { name: 'shopping' }, { name: 'events' }, { name: 'language-packs' }],
    },
  });
}
