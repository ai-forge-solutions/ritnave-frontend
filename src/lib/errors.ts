export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); this.name = 'AppError'; }
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof AppError;
  return Response.json({ error: known ? error.message : 'Servicio no disponible', ...(known && error.code ? { code: error.code } : {}) }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
