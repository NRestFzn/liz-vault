export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errorCode(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}
