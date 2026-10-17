"use client";

import { useCallback, useEffect, useState } from "react";
import { RadioTower, ShieldCheck } from "lucide-react";
import MainSidebar, { type AppPage } from "@/components/emergency/MainSidebar";
import LiveDispatchPage from "@/components/emergency/LiveDispatchPage";
import SignalFusionPage from "@/modules/signal-fusion/components/SignalFusionPage";
import CareRouteOptimizerPage from "@/modules/care-route-optimizer/components/CareRouteOptimizerPage";
import DispatchAssistantPage from "@/modules/dispatch-assistant/components/DispatchAssistantPage";
import AmbulanceSchedulingPage from "@/modules/ambulance-scheduling/components/AmbulanceSchedulingPage";
import LiveIntakePage from "@/modules/live-intake/components/LiveIntakePage";
import { useLiveRouting } from "@/modules/live-dispatch/hooks/useLiveRouting";
import CommandCenterPage from "@/modules/command-center/components/CommandCenterPage";
import { useCommandCenter } from "@/modules/command-center/hooks/useCommandCenter";

const pageMeta: Record<AppPage, { title: string; subtitle: string }> = {
  "Command Center": { title: "Command Center", subtitle: "Live incidents / units / routes" },
  "Live Dispatch": { title: "Live Dispatch", subtitle: "Real resources / road routes / operator action" },
  "Ambulance Scheduling": { title: "Ambulance Scheduling", subtitle: "Fleet roster / hospital allocation / coverage windows" },
  "Live Intake": { title: "Live Intake", subtitle: "999 call audio / ElevenLabs transcription / AI triage" },
  "Live Signals": { title: "Live Signals", subtitle: "Predictive fusion / clustered evidence / Oracle watch" },
  "Triage Queue": { title: "Triage Queue", subtitle: "AI-scored / filter noise from need" },
  "Dispatch Copilot": { title: "Dispatch Copilot", subtitle: "Grounded recommendations / operator approval required" },
  "Care Routing": { title: "Care Routing", subtitle: "Best destination, measurable minutes" },
};

export default function AppShell() {
  const { snapshot, routes, status: routingStatus, error: routingError, lastUpdated, busyDispatchId, reload, act: actOnDispatch } = useLiveRouting();
  const commandCenter = useCommandCenter();
  const [activePage, setActivePage] = useState<AppPage>("Live Intake");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | undefined>();
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>();
  const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();

  useEffect(() => {
    if (activePage === "Command Center" && !selectedIncidentId && commandCenter.snapshot?.incidents[0]) {
      setSelectedIncidentId(commandCenter.snapshot.incidents[0].id);
      return;
    }
    if ((activePage !== "Live Dispatch" && activePage !== "Care Routing") || routes.length === 0 || selectedRouteId) return;
    const route = routes.find((item) => item.incidentId === selectedIncidentId && item.leg !== "to_hospital")
      ?? routes.find((item) => item.leg !== "to_hospital")
      ?? routes[0];
    setSelectedRouteId(route.id);
    setSelectedIncidentId(route.incidentId);
    setSelectedUnitId(route.unitId);
  }, [activePage, commandCenter.snapshot, routes, selectedIncidentId, selectedRouteId]);

  const selectIncident = useCallback((id: string) => {
    const route = routes.find((item) => item.incidentId === id && item.leg !== "to_hospital");
    setSelectedIncidentId(id);
    setSelectedRouteId(route?.id);
    setSelectedUnitId(route?.unitId);
  }, [routes]);

  const selectUnit = useCallback((id: string) => {
    const route = routes.find((item) => item.unitId === id && item.leg !== "to_hospital");
    setSelectedUnitId(id);
    if (route) {
      setSelectedRouteId(route.id);
      setSelectedIncidentId(route.incidentId);
    }
  }, [routes]);

  const selectRoute = useCallback((id: string) => {
    const route = routes.find((item) => item.id === id);
    setSelectedRouteId(id);
    setSelectedIncidentId(route?.incidentId);
    setSelectedUnitId(route?.unitId);
  }, [routes]);

  const sharedSelection = {
    selectedIncidentId,
    selectedUnitId,
    selectedRouteId,
    onSelectIncident: selectIncident,
    onSelectUnit: selectUnit,
    onSelectRoute: selectRoute,
    routes,
    locations: snapshot?.locations ?? [],
    routingStatus,
    routingError,
    lastUpdated,
    onRetryRouting: reload,
    dispatchSnapshot: snapshot,
    busyDispatchId,
    onDispatchAction: actOnDispatch,
  };
  const activeMeta = pageMeta[activePage];

  return (
    <main className="anwar-shell flex h-screen overflow-hidden">
      <MainSidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="anwar-topbar">
          <div className="flex min-w-0 items-baseline gap-3"><RadioTower size={16} className="shrink-0 text-[var(--anwar-primary)]" /><span className="shrink-0 font-semibold text-[var(--anwar-text)]">{activeMeta.title}</span><span className="hidden truncate normal-case tracking-normal text-[var(--anwar-muted)] sm:inline">{activeMeta.subtitle}</span></div>
          <div className="ml-auto flex items-center gap-4"><span className="hidden sm:inline">MERS 999 / KL Command</span><span className="anwar-engine"><span />Engine live</span><ShieldCheck size={16} /></div>
        </header>
        <div className="anwar-workspace min-h-0 flex-1">
        {activePage === "Command Center" ? (
          <CommandCenterPage
            {...sharedSelection}
            commandSnapshot={commandCenter.snapshot}
            commandConnected={commandCenter.connected}
            commandError={commandCenter.error}
            busyIncidentId={commandCenter.busyIncidentId}
            onCommandAction={commandCenter.act}
            onRefreshCommand={commandCenter.refresh}
            dispatchSnapshot={snapshot}
            busyDispatchId={busyDispatchId}
            onDispatchAction={actOnDispatch}
          />
        ) : null}
        {activePage === "Live Dispatch" ? <LiveDispatchPage {...sharedSelection} /> : null}
        {activePage === "Ambulance Scheduling" ? <AmbulanceSchedulingPage dispatchSnapshot={snapshot} onRefresh={reload} /> : null}
        {activePage === "Live Intake" ? <LiveIntakePage onOpenSignalFusion={() => setActivePage("Live Signals")} /> : null}
        {activePage === "Live Signals" ? <SignalFusionPage workspace="intake" /> : null}
        {activePage === "Triage Queue" ? <SignalFusionPage workspace="queue" /> : null}
        {activePage === "Dispatch Copilot" ? <DispatchAssistantPage selectedIncidentId={selectedIncidentId} onNavigate={setActivePage} /> : null}
        {activePage === "Care Routing" ? <CareRouteOptimizerPage selectedIncidentId={selectedIncidentId} dispatchSnapshot={snapshot} onRefresh={reload} /> : null}
        </div>
      </div>
    </main>
  );
}
