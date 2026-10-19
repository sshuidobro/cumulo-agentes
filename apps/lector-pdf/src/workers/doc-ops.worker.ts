import { serveDocOps } from '../core/doc-ops/server';
import type { PortLike } from '../core/doc-ops/protocol';
import { DOC_OPS } from '../core/doc-ops/ops';

// Los tipos de DOM describen `self` de forma más general que `PortLike`; dentro del Worker sí tiene
// postMessage y addEventListener con la forma que usa el servidor, así que el cast solo ajusta el tipo.
serveDocOps(self as unknown as PortLike, DOC_OPS);
