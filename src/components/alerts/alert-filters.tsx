"use client";

export function AlertFilters({ onChange }: { onChange: (filters: { search?: string; status?: string }) => void }) {
  return <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onChange({ search: String(form.get("search") || "") || undefined, status: String(form.get("status") || "") || undefined }); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <label>Search <input name="search" placeholder="Rule or agent" /></label>
    <label>Status <select name="status" defaultValue=""><option value="">All</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select></label>
    <button type="submit">Filter</button>
  </form>;
}
