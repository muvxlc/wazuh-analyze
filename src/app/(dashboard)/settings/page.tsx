"use client";
import { useEffect, useState } from "react";
export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  useEffect(() => { void fetch("/api/settings").then((r) => r.json()).then((b) => setSettings(b.data)); }, []);
  return <section><h1>Settings</h1>{settings ? <ul><li>Retention (days): {settings.retentionDays}</li><li>Maintenance batch size: {settings.maintenanceBatchSize}</li></ul> : <p role="status">Loading...</p>}</section>;
}
