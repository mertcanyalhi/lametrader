import { Type } from '@fastify/type-provider-typebox';

/**
 * The uniform error response body, shared by every controller's error responses.
 */
export const ErrorSchema = Type.Object({ error: Type.String() }, { $id: 'Error' });
