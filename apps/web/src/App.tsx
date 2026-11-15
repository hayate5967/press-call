import { type Health, healthSchema } from "@press-call/shared";
import { useEffect, useState } from "react";
import { formatApiStatus } from "./format";

/** 骨組みの段階では、API とつながっているかだけを表示する */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => res.json())
      .then((json) => setHealth(healthSchema.parse(json)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>press-call</h1>
      <p>{formatApiStatus(health, error)}</p>
    </main>
  );
}
