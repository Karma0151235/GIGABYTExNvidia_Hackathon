"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCommandSnapshot, performCommandAction } from "@/modules/command-center/lib/api";
import type { CommandAction, CommandSnapshot } from "@/modules/command-center/types";

export function useCommandCenter() {
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIncidentId, setBusyIncidentId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const data = await fetchCommandSnapshot(controller.signal);
        setSnapshot(data);
        setConnected(true);
        setError(null);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setConnected(false);
        setError(reason instanceof Error ? reason.message : "Command Center is unavailable");
      } finally {
        inFlight = false;
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [reloadKey]);

  const act = useCallback(async (action: CommandAction) => {
    setBusyIncidentId(action.incident.id);
    setError(null);
    try {
      const incident = await performCommandAction(action);
      setSnapshot((current) => current ? {
        ...current,
        incidents: current.incidents.map((item) => item.id === incident.id ? incident : item),
      } : current);
      refresh();
      return incident;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Command action failed";
      setError(message);
      throw reason;
    } finally {
      setBusyIncidentId(null);
    }
  }, [refresh]);

  return { snapshot, connected, error, busyIncidentId, refresh, act };
}
