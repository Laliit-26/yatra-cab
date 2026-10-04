import { randomUUID } from 'crypto';

/**
 * Attach a request ID to every inbound request.
 * Honour an upstream X-Request-Id header (load-balancer / API gateway) so the
 * ID can be propagated end-to-end across services; generate a fresh UUID
 * otherwise. The ID is echoed back in the response header so clients can
 * correlate their calls with server logs.
 */
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
