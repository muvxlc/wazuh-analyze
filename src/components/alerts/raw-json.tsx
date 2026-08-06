export function RawJson({ value }: { value: unknown }) {
  return <pre style={{ overflowX: "auto", padding: 16, background: "var(--color-canvas-soft)" }}>{JSON.stringify(value, null, 2)}</pre>;
}
