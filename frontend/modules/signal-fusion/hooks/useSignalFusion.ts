"use client";

import { useCallback, useEffect, useState } from "react";
import { getFusionSnapshot, promoteCluster, updateCluster } from "../lib/api";
import { seedSnapshot } from "../lib/seed";
import type { FusionSnapshot, IncidentHandoff } from "../types";


export function useSignalFusion() {
  const [snapshot, setSnapshot] = useState<FusionSnapshot>(seedSnapshot);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [lastHandoff, setLastHandoff] = useState<IncidentHandoff>();

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getFusionSnapshot());
      setConnected(true);
      setError(undefined);
    } catch (caught) {
      setConnected(false);
      setError(caught instanceof Error ? caught.message : "Signal Fusion API unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = useCallback(async (
    id: string,
    action: "verify" | "promote" | "dismiss",
  ) => {
    setBusy(id);
    setError(undefined);
    try {
      const result = action === "promote"
        ? await promoteCluster(id)
        : await updateCluster(id, action);
      const changed = result.cluster;
      setSnapshot((current) => ({
        ...current,
        clusters: current.clusters.map((item) => item.id === id ? changed : item),
      }));
      if ("incident" in result) setLastHandoff(result.incident);
      setConnected(true);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `Unable to ${action} cluster`;
      setError(message);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { snapshot, connected, busy, error, lastHandoff, refresh, act };
}
