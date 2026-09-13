/** Server-side API origin — RF_API_BASE overrides build-time NEXT_PUBLIC_API_BASE at runtime. */
export function resolveApiBase(): string {
  const raw =
    process.env.RF_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE?.trim() ||
    'http://127.0.0.1:8000';
  return raw.replace(/\/$/, '');
}
