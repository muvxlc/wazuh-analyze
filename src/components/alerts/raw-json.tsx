export function RawJson({ value }: { value: unknown }) {
  return <pre className="raw-json">{JSON.stringify(value, null, 2)}</pre>;
}
