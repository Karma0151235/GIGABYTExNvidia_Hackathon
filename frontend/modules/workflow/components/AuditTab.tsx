"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Network, Send } from "lucide-react";
import type { Case } from "@/modules/workflow/lib/caseReducer";
import { buildDocs, buildGraph, type KNode, type Lane } from "@/modules/workflow/lib/knowledge";
import { citedIds, retrieve, type Doc } from "@/modules/workflow/lib/retrieval";
import { askCaseAudit } from "@/modules/workflow/lib/caseAudit";

const W = 1200;
const H = 600;
const SLOT_Y: Record<number, number> = { [-2]: 70, [-1]: 185, 0: 300, 1: 415, 2: 530 };
const LANE: Record<Lane, { stroke: string; fill: string; text: string }> = {
  intake: { stroke: "#2563eb", fill: "#eff6ff", text: "#1e3a8a" },
  routing: { stroke: "#d97706", fill: "#fffbeb", text: "#78350f" },
  on_scene: { stroke: "#e11d48", fill: "#fff1f2", text: "#881337" },
  admitted: { stroke: "#059669", fill: "#ecfdf5", text: "#064e3b" },
};
const SUGGESTIONS = ["What happened in this case?", "Why was it given this priority?", "Which ambulance responded and how fast?", "What were the vitals on scene?", "Where was the patient admitted and why?"];

type Message = { role: "user" | "assistant"; content: string; sources?: Doc[]; offline?: boolean; error?: string };

const pos = (node: KNode) => ({ x: 100 + node.column * 200, y: SLOT_Y[node.slot] });
const size = (node: KNode) => (node.slot === 0 ? { w: 168, h: 64 } : { w: 150, h: 50 });
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Graph({ item, highlight, selectedId, onSelect }: { item: Case; highlight: Set<string>; selectedId?: string; onSelect: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => buildGraph(item), [item]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <svg data-testid="knowledge-graph" viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Case knowledge graph">
      <defs>
        <marker id="kg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#64748b" /></marker>
      </defs>
      {edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const a = pos(from);
        const b = pos(to);
        const dash = edge.pending ? "5 5" : undefined;
        if (edge.spine) {
          const x1 = a.x + size(from).w / 2;
          const x2 = b.x - size(to).w / 2 - 4;
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line x1={x1} y1={a.y} x2={x2} y2={b.y} stroke={edge.pending ? "#cbd5e1" : "#64748b"} strokeWidth={2} strokeDasharray={dash} markerEnd="url(#kg-arrow)" />
              <text x={(x1 + x2) / 2} y={a.y - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill={edge.pending ? "#94a3b8" : "#334155"}>{edge.label}</text>
            </g>
          );
        }
        const y1 = a.y + (b.y < a.y ? -size(from).h / 2 : size(from).h / 2);
        const y2 = b.y + (b.y < a.y ? size(to).h / 2 : -size(to).h / 2);
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <line x1={a.x} y1={y1} x2={b.x} y2={y2} stroke={edge.pending ? "#e2e8f0" : "#94a3b8"} strokeWidth={1.5} strokeDasharray={dash} />
            <text x={a.x + 6} y={(y1 + y2) / 2 + 4} fontSize={10} fill="#64748b">{edge.label}</text>
          </g>
        );
      })}
      {nodes.map((node) => {
        const { x, y } = pos(node);
        const { w, h } = size(node);
        const tone = LANE[node.lane];
        const lit = highlight.has(node.id);
        const picked = selectedId === node.id;
        return (
          <g key={node.id} data-testid={`kg-node-${node.id}`} data-cited={lit || undefined} onClick={() => onSelect(node.id)} className="cursor-pointer">
            {lit ? <rect x={x - w / 2 - 5} y={y - h / 2 - 5} width={w + 10} height={h + 10} rx={14} fill="none" stroke="#76b900" strokeWidth={3} /> : null}
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={10} fill={node.pending ? "#f8fafc" : tone.fill} stroke={node.pending ? "#cbd5e1" : picked ? "#0f172a" : tone.stroke} strokeWidth={picked ? 2.5 : node.slot === 0 ? 2 : 1.25} strokeDasharray={node.pending ? "5 4" : undefined} />
            <text x={x} y={y - (node.slot === 0 ? 6 : 4)} textAnchor="middle" fontSize={node.slot === 0 ? 14 : 12} fontWeight={800} fill={node.pending ? "#94a3b8" : tone.text}>{clip(node.title, 20)}</text>
            <text x={x} y={y + (node.slot === 0 ? 14 : 12)} textAnchor="middle" fontSize={11} fill={node.pending ? "#94a3b8" : "#334155"}>{clip(node.pending && node.slot === 0 ? "pending" : node.label, 24)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Answer({ message, onCite }: { message: Message; onCite: (id: string) => void }) {
  if (message.role === "user") return <div className="ml-8 rounded-xl bg-blue-600 px-3 py-2 text-xs text-white">{message.content}</div>;
  const parts = message.content.split(/(\[S\d+(?:,\s*S\d+)*\])/g);
  return (
    <div data-testid="audit-answer" className="mr-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-800">
      {message.offline ? <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700" title={message.error}>Nemotron unreachable / retrieved records only{message.error ? `: ${message.error}` : ""}</div> : null}
      <p className="whitespace-pre-wrap">
        {parts.map((part, index) => (/^\[S\d+/.test(part) ? citedIds(part).map((id) => <button key={`${index}-${id}`} type="button" onClick={() => onCite(id)} className="mx-0.5 rounded bg-[#76b900]/15 px-1 font-mono text-[10px] font-bold text-[#3f6300] hover:bg-[#76b900]/30">{id}</button>) : <span key={index}>{part}</span>))}
      </p>
      {message.sources?.length ? (
        <details className="mt-1.5 text-[11px] text-slate-500">
          <summary className="cursor-pointer font-semibold">{message.sources.length} retrieved records</summary>
          <ol className="mt-1 space-y-1">{message.sources.map((source) => <li key={source.id}><b className="font-mono">{source.id}</b> {source.text}</li>)}</ol>
        </details>
      ) : null}
    </div>
  );
}

export default function AuditTab({ cases, selected }: { cases: Case[]; selected?: Case }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [nodeId, setNodeId] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, busy]);
  useEffect(() => { setHighlight(new Set()); setNodeId(undefined); }, [selected?.callId]);

  const node = selected && nodeId ? buildGraph(selected).nodes.find((entry) => entry.id === nodeId) : undefined;

  const cite = (sources: Doc[] | undefined, id: string) => {
    const source = sources?.find((entry) => entry.id === id);
    if (source && source.callId === selected?.callId) { setHighlight(new Set([source.nodeId])); setNodeId(source.nodeId); }
  };

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy || !cases.length) return;
    // Renumber retrieved docs S1..Sk so the model's citations map back to graph nodes.
    const sources = retrieve(buildDocs(cases), text, selected?.callId).map((doc, index) => ({ ...doc, id: `S${index + 1}` }));
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    let reply: Message;
    try {
      // Backend sees only the retrieved records; source text is capped to the schema limit.
      const result = await askCaseAudit({ question: text, sources: sources.map(({ id, text: body }) => ({ id, text: body.slice(0, 2000) })), history: history.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 4000) })) });
      reply = { role: "assistant", content: result.answer, sources };
    } catch (error) {
      reply = { role: "assistant", offline: true, sources, error: error instanceof Error ? error.message : "request failed", content: sources.map((source) => `${source.text} [${source.id}]`).join("\n") || "No matching records." };
    }
    setBusy(false);
    setMessages((current) => [...current, reply]);
    setHighlight(new Set(citedIds(reply.content).map((id) => sources.find((source) => source.id === id)).filter((source) => source?.callId === selected?.callId).map((source) => source!.nodeId)));
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_380px] gap-3 p-3.5">
      <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <Network size={16} className="text-blue-600" />
          <span className="text-sm font-bold text-slate-900">Case knowledge graph</span>
          <span className="truncate text-xs text-slate-500">{selected ? `${selected.priority} / ${selected.title} / ${selected.callId}` : "No case selected"}</span>
          <span className="ml-auto flex shrink-0 items-center gap-3 text-[10px] font-semibold text-slate-500">
            {(Object.keys(LANE) as Lane[]).map((lane) => <span key={lane} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: LANE[lane].stroke }} />{lane.replace("_", " ")}</span>)}
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-2 border-[#76b900]" />cited</span>
          </span>
        </header>
        <div className="min-h-0 flex-1 p-2">
          {selected ? <Graph item={selected} highlight={highlight} selectedId={nodeId} onSelect={setNodeId} /> : <div className="grid h-full place-items-center text-sm text-slate-500">Run a call to build its knowledge graph.</div>}
        </div>
        {node ? (
          <div data-testid="kg-detail" className="border-t border-slate-200 px-4 py-3 text-xs">
            <div className="flex items-center gap-2"><b className="text-slate-900">{node.title}</b>{node.pending ? <span className="text-slate-400">pending</span> : null}
              <button type="button" onClick={() => void ask(`Explain the ${node.title.toLowerCase()} step of this case.`)} className="ml-auto rounded-md border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50">Ask Nemotron about this</button>
            </div>
            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap leading-5 text-slate-700">{node.detail}</p>
          </div>
        ) : <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400">Click a node for its full record. Dashed nodes have not happened yet.</div>}
      </section>

      <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-slate-50">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <Bot size={16} className="text-[#76b900]" /><span className="text-sm font-bold text-slate-900">Audit assistant</span>
          <span className="ml-auto text-[10px] font-semibold text-slate-500">RAG over {cases.length} case{cases.length === 1 ? "" : "s"} / Nemotron</span>
        </header>
        <div data-testid="audit-chat" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">Ask what happened. Answers cite the case records they came from.</p>
              {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={!cases.length} onClick={() => void ask(suggestion)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-blue-300 disabled:opacity-40">{suggestion}</button>)}
            </div>
          ) : messages.map((message, index) => <Answer key={index} message={message} onCite={(id) => cite(message.sources, id)} />)}
          {busy ? <div className="mr-4 animate-pulse rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Nemotron is reading the records...</div> : null}
          <div ref={end} />
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void ask(input); }} className="flex gap-2 border-t border-slate-200 p-3">
          <input aria-label="Ask the audit assistant" value={input} onChange={(event) => setInput(event.target.value)} disabled={!cases.length} placeholder={cases.length ? "Ask about any case..." : "Run a call first"} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 disabled:opacity-50" />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white disabled:opacity-40"><Send size={14} /></button>
        </form>
      </section>
    </div>
  );
}
