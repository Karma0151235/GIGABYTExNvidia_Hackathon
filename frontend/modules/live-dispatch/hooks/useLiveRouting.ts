"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDispatchSnapshot, performDispatchAction } from "@/modules/live-dispatch/lib/api";
import type { DispatchAction, DispatchSnapshot, RoutingStatus } from "@/modules/live-dispatch/types";

export function useLiveRouting() {
  const [snapshot, setSnapshot] = useState<DispatchSnapshot | null>(null);
  const [status, setStatus] = useState<RoutingStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busyDispatchId, setBusyDispatchId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setStatus("loading");
    setError(null);
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let requestInFlight = false;

    const refresh = async () => {
      if (requestInFlight || controller.signal.aborted) return;
      requestInFlight = true;
      try {
        const data = await fetchDispatchSnapshot(controller.signal);
        setSnapshot(data);
        setLastUpdated(new Date());
        setStatus(data.routingOnline ? "online" : "offline");
        setError(data.routingOnline ? null : `No road geometry for ${data.failedRouteIds.length} seeded routes`);
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setStatus("offline");
        setError(reason instanceof Error ? reason.message : "Local routing is unavailable");
      } finally {
        requestInFlight = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);

    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [reloadKey]);

  const act = useCallback(async (action: DispatchAction) => {
    setBusyDispatchId(action.recommendation.id);
    setError(null);
    try {
      const result = await performDispatchAction(action);
      reload();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Dispatch action failed");
      throw reason;
    } finally {
      setBusyDispatchId(null);
    }
  }, [reload]);

  return { snapshot, routes: snapshot?.routes ?? [], status, error, lastUpdated, busyDispatchId, reload, act };
}
