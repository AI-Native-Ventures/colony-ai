import * as React from "react";

import { meshConnectedHosts } from "@/shared/api/tauriMesh";
import type { MeshConnectedHost } from "@/shared/api/tauriMesh";

export function useMeshConnectedHosts(): {
  hosts: MeshConnectedHost[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [hosts, setHosts] = React.useState<MeshConnectedHost[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  const inFlight = React.useRef(false);
  const stopped = React.useRef(false);
  const hasFetched = React.useRef(false);
  const lastFailed = React.useRef(false);

  const refresh = React.useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestGeneration = ++generation.current;
    if (!hasFetched.current || lastFailed.current) setLoading(true);
    setError(null);

    void meshConnectedHosts()
      .then((value) => {
        if (!stopped.current && generation.current === requestGeneration) {
          setHosts(value);
          lastFailed.current = false;
        }
      })
      .catch((reason: unknown) => {
        if (!stopped.current && generation.current === requestGeneration) {
          setHosts([]);
          setError(reason instanceof Error ? reason.message : String(reason));
          lastFailed.current = true;
        }
      })
      .finally(() => {
        inFlight.current = false;
        if (!stopped.current && generation.current === requestGeneration) {
          hasFetched.current = true;
          setLoading(false);
        }
      });
  }, []);

  React.useEffect(() => {
    stopped.current = false;
    refresh();
    return () => {
      stopped.current = true;
      generation.current += 1;
    };
  }, [refresh]);

  React.useEffect(() => {
    if (error) return;
    const interval = window.setInterval(refresh, 45_000);
    return () => window.clearInterval(interval);
  }, [error, refresh]);

  return { hosts, loading, error, refresh };
}
