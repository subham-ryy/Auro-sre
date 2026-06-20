import { r as reactExports, j as jsxRuntimeExports } from "../_libs/react.mjs";
const INITIAL_LINES = [{
  n: 1,
  prefix: "[System]",
  prefixColor: "#6b7a6b",
  text: "AutoSRE v2.4.1 initialized. Workers: 3/3 online."
}, {
  n: 2,
  prefix: "[Telemetry]",
  prefixColor: "#6b7a6b",
  text: "Hooked into target app: api-gateway-prod."
}, {
  n: 3,
  prefix: "[Skeptic]",
  prefixColor: "#86efac",
  text: "Baseline established. p95 latency: 142ms."
}, {
  n: 4,
  prefix: "[System]",
  prefixColor: "#6b7a6b",
  text: "Listening for incidents..."
}, {
  n: 5,
  prefix: "fixer@autosre:~$",
  prefixColor: "#4ade80",
  text: "_"
}];
function AutoSRE() {
  const [isIncidentLive, setIsIncidentLive] = reactExports.useState(false);
  const [activeAgent, setActiveAgent] = reactExports.useState("none");
  const [skepticVerdict, setSkepticVerdict] = reactExports.useState("none");
  const [activeEdge, setActiveEdge] = reactExports.useState(null);
  const [round, setRound] = reactExports.useState(1);
  const [downtimeCost, setDowntimeCost] = reactExports.useState(0);
  const [finalCost, setFinalCost] = reactExports.useState(null);
  const [lines, setLines] = reactExports.useState(INITIAL_LINES);
  const [typing, setTyping] = reactExports.useState(null);
  const [typeQueue, setTypeQueue] = reactExports.useState([]);
  const [isQueuePaused, setIsQueuePaused] = reactExports.useState(false);
  const pauseTimerRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);
  const [now, setNow] = reactExports.useState(() => /* @__PURE__ */ new Date());
  const [latencyData, setLatencyData] = reactExports.useState(() => Array.from({
    length: 40
  }, () => 38 + Math.random() * 7));
  const [spike, setSpike] = reactExports.useState("none");
  const [autoExecute, setAutoExecute] = reactExports.useState(true);
  const [pendingFix, setPendingFix] = reactExports.useState(null);
  const [agentStatuses, setAgentStatuses] = reactExports.useState({
    detective: "idle",
    fixer: "idle",
    skeptic: "idle"
  });
  const [selectedScenario, setSelectedScenario] = reactExports.useState("001");
  const [incidentSummary, setIncidentSummary] = reactExports.useState(null);
  const [showSummary, setShowSummary] = reactExports.useState(false);
  const [summaryButtonVisible, setSummaryButtonVisible] = reactExports.useState(false);
  const [summaryLoading, setSummaryLoading] = reactExports.useState(false);
  const termRef = reactExports.useRef(null);
  const runningRef = reactExports.useRef(false);
  const [resolvedScenarios, setResolvedScenarios] = reactExports.useState([]);
  const [showRebreakModal, setShowRebreakModal] = reactExports.useState(false);
  const [heldGovernancePayload, setHeldGovernancePayload] = reactExports.useState(null);
  const selectedScenarioRef = reactExports.useRef(selectedScenario);
  reactExports.useEffect(() => {
    selectedScenarioRef.current = selectedScenario;
  }, [selectedScenario]);
  const applyStatePatch = (patch) => {
    if (patch.isIncidentLive !== void 0) setIsIncidentLive(patch.isIncidentLive);
    if (patch.activeAgent !== void 0) setActiveAgent(patch.activeAgent);
    if (patch.activeEdge !== void 0) setActiveEdge(patch.activeEdge);
    if (patch.round !== void 0) setRound(patch.round);
    if (patch.skepticVerdict !== void 0) setSkepticVerdict(patch.skepticVerdict);
    if (patch.spike !== void 0) {
      setSpike(patch.spike);
      if (patch.spike === "resolved") {
        setLatencyData(Array.from({
          length: 40
        }, () => 38 + Math.random() * 7));
        setTimeout(() => setSummaryButtonVisible(true), 1e3);
      }
    }
    if (patch.pendingFix !== void 0) setPendingFix(patch.pendingFix);
    if (patch.agentStatuses !== void 0) setAgentStatuses(patch.agentStatuses);
    if (patch.agentStatusesPatch !== void 0) {
      const {
        agent,
        status
      } = patch.agentStatusesPatch;
      setAgentStatuses((prev) => ({
        ...prev,
        [agent]: status
      }));
    }
  };
  const appendQueue = (item) => {
    setTypeQueue((prev) => [...prev, item]);
  };
  const appendLine = (prefix, color, text) => {
    appendQueue({
      type: "line",
      prefix,
      color,
      text
    });
  };
  reactExports.useEffect(() => {
    if (!typing && typeQueue.length === 0 && !isQueuePaused && heldGovernancePayload) {
      setPendingFix(heldGovernancePayload);
      setHeldGovernancePayload(null);
    }
  }, [typing, typeQueue, isQueuePaused, heldGovernancePayload]);
  reactExports.useEffect(() => {
    const id = setInterval(() => setNow(/* @__PURE__ */ new Date()), 1e3);
    return () => clearInterval(id);
  }, []);
  reactExports.useEffect(() => {
    const eventSource = new EventSource("https://auto-sre-production.up.railway.app/stream");
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const {
        type,
        payload
      } = data;
      if (type === "system") {
        const text = payload.message;
        if (text === "AWAITING_APPROVAL") {
          appendQueue({
            type: "line",
            prefix: "[Governance]",
            color: "#f59e0b",
            text: "⚠ AWAITING HUMAN APPROVAL — execution paused."
          });
          return;
        }
        let statePatch = {};
        if (text.includes("Round 1")) statePatch.round = 1;
        if (text.includes("Round 2")) statePatch.round = 2;
        if (text.includes("APPROVED")) statePatch.skepticVerdict = "approved";
        if (text.includes("Rejected")) statePatch.skepticVerdict = "rejected";
        if (text.includes("Round")) {
          statePatch.agentStatuses = {
            detective: "idle",
            fixer: "idle",
            skeptic: "idle"
          };
        }
        if (text.includes("RESOLVED") || text.includes("ABORTED")) {
          statePatch.isIncidentLive = false;
          statePatch.spike = text.includes("RESOLVED") ? "resolved" : "none";
          statePatch.pendingFix = null;
          statePatch.agentStatuses = {
            detective: "idle",
            fixer: "idle",
            skeptic: "idle"
          };
          statePatch.activeAgent = "none";
          statePatch.activeEdge = null;
          if (text.includes("RESOLVED")) {
            const currentScenario = selectedScenarioRef.current;
            setResolvedScenarios((prev) => {
              if (prev.includes(currentScenario)) return prev;
              return [...prev, currentScenario];
            });
          }
          runningRef.current = false;
        }
        if (Object.keys(statePatch).length > 0) {
          appendQueue({
            type: "state",
            statePatch
          });
        }
        appendQueue({
          type: "line",
          prefix: "[System]",
          color: "#6b7a6b",
          text
        });
      } else if (type === "agent_state") {
        const {
          agent,
          status
        } = payload;
        let statePatch = {
          agentStatusesPatch: {
            agent,
            status
          }
        };
        if (status === "processing") {
          statePatch.activeAgent = agent;
          if (agent === "detective") statePatch.activeEdge = "det-fix";
          else if (agent === "fixer") statePatch.activeEdge = "fix-skep";
          else if (agent === "skeptic") statePatch.activeEdge = "skep-det";
        }
        appendQueue({
          type: "state",
          statePatch
        });
      } else if (type === "governance") {
        setHeldGovernancePayload(payload);
      } else if (type === "summary_ready") {
        setIncidentSummary(payload.summary);
        setSummaryLoading(false);
      } else if (type === "agent_update") {
        const {
          role,
          content
        } = payload;
        let prefix = `[${role.charAt(0).toUpperCase() + role.slice(1)}]`;
        let color = "#4ade80";
        let statePatch = {};
        if (role === "detective") {
          statePatch.activeAgent = "detective";
          statePatch.activeEdge = "det-fix";
          color = "#4ade80";
        } else if (role === "fixer") {
          statePatch.activeAgent = "fixer";
          statePatch.activeEdge = "fix-skep";
          color = "#f59e0b";
        } else if (role === "skeptic") {
          statePatch.activeAgent = "skeptic";
          statePatch.activeEdge = "skep-det";
          color = "#ef4444";
        }
        if (content.includes("APPROVED")) {
          prefix = "[Skeptic] APPROVED";
          color = "#86efac";
          statePatch.skepticVerdict = "approved";
        } else if (content.includes("REJECTED")) {
          prefix = "[Skeptic] REJECTED";
          color = "#ef4444";
          statePatch.skepticVerdict = "rejected";
          statePatch.activeEdge = "skep-det";
        }
        appendQueue({
          type: "state",
          statePatch
        });
        appendQueue({
          type: "line",
          prefix,
          color,
          text: content
        });
      }
    };
    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      eventSource.close();
    };
    return () => {
      eventSource.close();
    };
  }, []);
  reactExports.useEffect(() => {
    if (isIncidentLive) return;
    const id = setInterval(() => {
      setLatencyData((prev) => {
        const next = prev.slice(1);
        next.push(38 + Math.random() * 7);
        return next;
      });
    }, 600);
    return () => clearInterval(id);
  }, [isIncidentLive]);
  reactExports.useEffect(() => {
    if (!isIncidentLive) return;
    const poll = async () => {
      try {
        const res = await fetch("http://localhost:3001/health");
        if (res.ok) {
          const data = await res.json();
          const latency = data.latency_ms || 38;
          setLatencyData((prev) => {
            const next = prev.slice(1);
            next.push(latency);
            return next;
          });
        } else {
          const data = await res.json().catch(() => ({}));
          const latency = data.latency_ms || 5e3 + Math.random() * 500;
          setLatencyData((prev) => {
            const next = prev.slice(1);
            next.push(latency);
            return next;
          });
        }
      } catch (err) {
        setLatencyData((prev) => {
          const next = prev.slice(1);
          next.push(8e3 + Math.random() * 800);
          return next;
        });
      }
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [isIncidentLive]);
  reactExports.useEffect(() => {
    if (!isIncidentLive) return;
    setFinalCost(null);
    setDowntimeCost(0);
    const start = Date.now();
    const id = setInterval(() => {
      const secs = (Date.now() - start) / 1e3;
      setDowntimeCost(secs * 240);
    }, 50);
    return () => {
      clearInterval(id);
      setDowntimeCost((c) => {
        setFinalCost(c);
        return c;
      });
    };
  }, [isIncidentLive]);
  reactExports.useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [lines, typing]);
  reactExports.useEffect(() => {
    if (isQueuePaused) return;
    if (typing) {
      const timer = setTimeout(() => {
        if (typing.shown >= typing.text.length) {
          setLines((prev) => {
            const n = (prev[prev.length - 1]?.n ?? 5) + 1;
            return [...prev, {
              n,
              prefix: typing.prefix,
              prefixColor: typing.prefixColor,
              text: typing.text
            }];
          });
          setTyping(null);
        } else {
          setTyping((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              shown: Math.min(prev.text.length, prev.shown + 1)
            };
          });
        }
      }, 6);
      return () => clearTimeout(timer);
    } else if (typeQueue.length > 0) {
      const next = typeQueue[0];
      setTypeQueue((prev) => prev.slice(1));
      if (next.type === "state") {
        applyStatePatch(next.statePatch);
        setIsQueuePaused(true);
        pauseTimerRef.current = setTimeout(() => {
          setIsQueuePaused(false);
        }, 400);
      } else if (next.type === "line") {
        setLines((prev) => {
          const nextN = (prev[prev.length - 1]?.n ?? 5) + 1;
          setTyping({
            n: nextN,
            prefix: next.prefix,
            prefixColor: next.color,
            text: next.text,
            shown: 0
          });
          return prev;
        });
      }
    }
  }, [typing, typeQueue, isQueuePaused]);
  const startIncident = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsIncidentLive(true);
    setSkepticVerdict("none");
    setRound(1);
    setPendingFix(null);
    setHeldGovernancePayload(null);
    setIncidentSummary(null);
    setShowSummary(false);
    setSummaryButtonVisible(false);
    setSummaryLoading(false);
    setTypeQueue([]);
    setTyping(null);
    setIsQueuePaused(false);
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    setAgentStatuses({
      detective: "idle",
      fixer: "idle",
      skeptic: "idle"
    });
    setLatencyData((prev) => {
      const next = [...prev];
      next[next.length - 1] = 12400;
      return next;
    });
    setSpike("spike");
    try {
      const res = await fetch("https://auto-sre-production.up.railway.app/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scenarioId: selectedScenario,
          autoExecute
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to trigger incident");
      }
    } catch (err) {
      console.error("Failed to trigger incident:", err);
      appendLine("[System]", "#ef4444", `Error: ${err.message || "Failed to connect to orchestrator."}`);
      setIsIncidentLive(false);
      runningRef.current = false;
    }
  };
  const handleApprove = async () => {
    setPendingFix(null);
    appendLine("[Governance]", "#86efac", "✓ Operator confirmed deployment. Unblocking orchestrator...");
    await fetch("https://auto-sre-production.up.railway.app/api/incident/approve", {
      method: "POST"
    }).catch(console.error);
  };
  const handleAbort = async () => {
    setPendingFix(null);
    appendLine("[Governance]", "#ef4444", "⛔ Operator aborted deployment.");
    await fetch("https://auto-sre-production.up.railway.app/api/incident/abort", {
      method: "POST"
    }).catch(console.error);
  };
  const utc = now.toISOString().slice(11, 19);
  const chart = reactExports.useMemo(() => {
    const w = 260, h = 70;
    const max = Math.max(...latencyData, 60);
    const pts = latencyData.map((v, i) => {
      const x = i / (latencyData.length - 1) * w;
      const y = h - v / max * (h - 4) - 2;
      return [x, y];
    });
    const d = pts.map(([x, y], i) => i === 0 ? `M${x},${y}` : `L${x},${y}`).join(" ");
    const area = `${d} L${w},${h} L0,${h} Z`;
    const last = pts[pts.length - 1];
    return {
      w,
      h,
      d,
      area,
      last,
      max
    };
  }, [latencyData]);
  const lastLatency = latencyData[latencyData.length - 1] || 142;
  const metrics = isIncidentLive ? {
    p95: `${Math.round(lastLatency).toLocaleString()}ms`,
    err: lastLatency > 500 ? "38.4%" : "0.21%",
    rps: lastLatency > 500 ? "0.1k" : "3.4k",
    up: lastLatency > 500 ? "99.84%" : "99.98%"
  } : {
    p95: `${Math.round(lastLatency).toLocaleString()}ms`,
    err: "0.21%",
    rps: "3.4k",
    up: "99.98%"
  };
  const chartColor = spike === "spike" ? "#ef4444" : "#4ade80";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "h-screen w-screen overflow-hidden text-emerald-100 relative flex flex-col", style: {
    background: "radial-gradient(ellipse at top, #0d1424 0%, #090d16 60%, #05080f 100%)",
    boxShadow: isIncidentLive ? "inset 0 0 120px rgba(239,68,68,0.12)" : "none",
    transition: "box-shadow 0.6s ease"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex-shrink-0 mb-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "h-14 px-4 flex items-center justify-between border-b border-white/5 backdrop-blur-md bg-white/[0.02]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-md flex items-center justify-center", style: {
            background: "linear-gradient(135deg,#0d2b1a,#0a1a10)",
            border: "1px solid #4ade80"
          }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            color: "#4ade80",
            fontWeight: 900,
            fontSize: 14
          }, children: "A" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "leading-tight", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[13px] font-black tracking-[0.28em] font-orbitron", style: {
              color: "#e6fff0"
            }, children: "AUTOSRE" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[9px] tracking-[0.22em] font-mono-term", style: {
              color: "#4ade80aa"
            }, children: "AUTONOMOUS RELIABILITY COMMAND" })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Pill, { label: "SECTOR", value: "US-EAST-2" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Pill, { label: "CLOCK", value: `${utc} UTC`, mono: true }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Pill, { label: "MODE", value: isIncidentLive ? "DEFCON 1 — CRISIS" : "DEFCON 5", tone: isIncidentLive ? "red" : "green", blink: isIncidentLive })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-center gap-3", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5 text-[10px] tracking-[0.18em] font-mono-term", style: {
          color: "#4ade80"
        }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "w-1.5 h-1.5 rounded-full inline-block", style: {
            background: "#4ade80",
            boxShadow: "0 0 8px #4ade80"
          } }),
          "SECURE CHANNEL"
        ] }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "px-4 py-0.5 text-[10.5px] font-normal font-inter tracking-wide", style: {
        color: "#7a9a7a"
      }, children: "Trigger an incident to watch AI agents detect, debate, and resolve it in real time." })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative grid grid-cols-12 gap-4 p-4 flex-1 min-h-0", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "col-span-3 flex flex-col gap-1.5 min-h-0 overflow-hidden", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Panel, { title: "SYSTEM TELEMETRY", className: "flex-shrink-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex gap-1 mb-1", children: [0, 1, 2, 3, 4].map((i) => {
            const isCrisis = isIncidentLive;
            const lit = isCrisis ? i === 0 : i === 4;
            const color = isCrisis ? "#ef4444" : "#4ade80";
            return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex-1 h-1.5 rounded-sm", style: {
              background: lit ? color : "#1a2030",
              boxShadow: lit ? `0 0 10px ${color}` : "none",
              animation: lit && isCrisis ? "blinkCursor 0.8s infinite" : "none"
            } }, i);
          }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between mb-1.5 gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[10px] font-mono-term tracking-[0.18em]", style: {
              color: isIncidentLive ? "#ef4444" : "#4ade80"
            }, children: isIncidentLive ? "DEFCON 1" : "DEFCON 5" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9.5px] font-mono-term tracking-[0.18em]", style: {
              background: isIncidentLive ? "#2b0d0d" : "#0d2b1a",
              border: `1px solid ${isIncidentLive ? "#ef4444" : "#4ade80"}55`,
              color: isIncidentLive ? "#ef4444" : "#4ade80"
            }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "w-1.5 h-1.5 rounded-full", style: {
                background: isIncidentLive ? "#ef4444" : "#4ade80",
                animation: isIncidentLive ? "blinkCursor 0.6s infinite" : "none",
                boxShadow: `0 0 8px ${isIncidentLive ? "#ef4444" : "#4ade80"}`
              } }),
              isIncidentLive ? "CRASHED" : "HEALTHY"
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-1.5 mb-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "P95 LATENCY", value: metrics.p95, red: isIncidentLive }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "ERROR RATE", value: metrics.err, red: isIncidentLive }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "THROUGHPUT", value: metrics.rps, red: false }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "UPTIME", value: metrics.up, red: isIncidentLive })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Panel, { title: "LATENCY · P95 TIMELINE", className: "flex-shrink-0", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "h-[68px]", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { width: "100%", height: "100%", viewBox: `0 0 ${chart.w} ${chart.h}`, preserveAspectRatio: "none", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("defs", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("linearGradient", { id: "lg", x1: "0", y1: "0", x2: "0", y2: "1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "0%", stopColor: chartColor, stopOpacity: "0.45" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "100%", stopColor: chartColor, stopOpacity: "0" })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: chart.area, fill: "url(#lg)" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: chart.d, fill: "none", stroke: chartColor, strokeWidth: "1.5" }),
          chart.last && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: chart.last[0], cy: chart.last[1], r: "3", fill: chartColor }),
            spike !== "none" && /* @__PURE__ */ jsxRuntimeExports.jsx("text", { x: chart.last[0] - 4, y: chart.last[1] - 8, textAnchor: "end", fontSize: "8", fontFamily: "JetBrains Mono", fill: spike === "spike" ? "#ef4444" : "#86efac", children: spike === "spike" ? "INCIDENT ▲ 12,400ms" : "RESOLVED ✓" })
          ] })
        ] }) }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(Panel, { title: "DOWNTIME COST METER", className: "flex-shrink-0", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-baseline gap-2 mb-0.5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-xl font-inter font-black tabular-nums tracking-tight", style: {
              color: isIncidentLive ? "#ef4444" : "#f87171",
              textShadow: isIncidentLive ? "0 0 20px rgba(239,68,68,0.6)" : "none"
            }, children: [
              "$",
              finalCost !== null ? finalCost.toLocaleString() : downtimeCost.toLocaleString()
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[10px] font-mono-term tracking-[0.1em]", style: {
              color: "#fca5a5"
            }, children: "USD" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between text-[8px] font-mono-term tracking-[0.2em] opacity-60", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
              color: "#fca5a5"
            }, children: "EST: $3.4K / MINUTE" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
              color: "#ef4444"
            }, children: isIncidentLive ? "ESCALATING" : "STABLE" })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1.5 p-2.5 rounded-lg flex-shrink-0 transition-all duration-300 relative overflow-hidden", style: {
          background: autoExecute ? "linear-gradient(135deg, rgba(6, 78, 59, 0.25) 0%, rgba(2, 44, 34, 0.15) 100%)" : "linear-gradient(135deg, rgba(120, 53, 4, 0.25) 0%, rgba(67, 20, 7, 0.15) 100%)",
          border: `2px dashed ${autoExecute ? "#10b98155" : "#f59e0b55"}`,
          boxShadow: autoExecute ? "0 0 16px rgba(16, 185, 129, 0.08), inset 0 1px 0 rgba(255,255,255,0.03)" : "0 0 16px rgba(245, 158, 11, 0.08), inset 0 1px 0 rgba(255,255,255,0.03)"
        }, children: [
          !autoExecute && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute inset-0 opacity-[0.03] pointer-events-none", style: {
            backgroundImage: "repeating-linear-gradient(45deg, #f59e0b, #f59e0b 10px, transparent 10px, transparent 20px)"
          } }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3 relative z-10", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-0.5", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[8px] font-bold tracking-[0.25em] text-emerald-400/60 font-orbitron uppercase", children: "GOVERNANCE MODE" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs font-black tracking-wider font-orbitron transition-all duration-300", style: {
                color: autoExecute ? "#34d399" : "#fbbf24",
                textShadow: autoExecute ? "0 0 8px rgba(52, 211, 153, 0.3)" : "0 0 8px rgba(251, 191, 36, 0.3)"
              }, children: autoExecute ? "AUTO-REMEDIATION: ACTIVE" : "HUMAN-IN-THE-LOOP: REQUIRED" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[8.5px] text-slate-400 font-mono-term leading-normal mt-0.5", children: autoExecute ? "✓ AI will execute patches immediately" : "⚠ AI will pause for verification before deployment" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { id: "auto-execute-toggle", onClick: () => setAutoExecute((v) => !v), disabled: isIncidentLive, className: "relative flex-shrink-0 w-12 h-6 rounded-full transition-all duration-300 border disabled:opacity-50 disabled:cursor-not-allowed", style: {
              background: autoExecute ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
              borderColor: autoExecute ? "#10b981" : "#f59e0b",
              boxShadow: autoExecute ? "0 0 12px rgba(16, 185, 129, 0.4)" : "0 0 12px rgba(245, 158, 11, 0.4)"
            }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "absolute top-[3px] w-4 h-4 rounded-full transition-all duration-300", style: {
              background: autoExecute ? "#10b981" : "#f59e0b",
              left: autoExecute ? "calc(100% - 20px)" : "4px",
              boxShadow: `0 0 8px ${autoExecute ? "#10b981" : "#f59e0b"}`
            } }) })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => {
          if (resolvedScenarios.includes(selectedScenario)) {
            setShowRebreakModal(true);
          } else {
            startIncident();
          }
        }, disabled: isIncidentLive, className: "mt-auto w-full rounded-md py-1.5 px-3 text-left transition-all font-mono-term disabled:cursor-not-allowed flex-shrink-0", style: {
          background: isIncidentLive ? "#1a0606" : "#1a0d00",
          border: `2px solid ${isIncidentLive ? "#ef4444" : "#f59e0b"}`,
          color: isIncidentLive ? "#ef4444" : "#fbbf24",
          animation: isIncidentLive ? "none" : "triggerGlow 2s ease-in-out infinite"
        }, children: isIncidentLive ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[10px] tracking-[0.2em] opacity-80", children: "■ INCIDENT LIVE" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[14px] font-bold tracking-[0.15em] mt-0.5", children: "AGENTS RESPONDING" })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-[10px] tracking-[0.2em] opacity-90", children: [
            "⚠ TRIGGER INCIDENT ",
            selectedScenario
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[15px] font-bold tracking-[0.18em] mt-0.5", children: "ARM → FIRE" })
        ] }) })
      ] }),
      pendingFix && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute inset-0 flex items-center justify-center", style: {
        zIndex: 50,
        backdropFilter: "blur(4px)",
        background: "rgba(0,0,0,0.6)"
      }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl p-5 max-w-lg w-full mx-4", style: {
        background: "#0a0f0a",
        border: "2px solid #f59e0b",
        animation: "pulseBorder 2s infinite ease-in-out"
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            fontSize: 18
          }, children: "⚠️" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[11px] tracking-[0.28em] font-orbitron font-bold", style: {
              color: "#f59e0b"
            }, children: "GOVERNANCE GUARDRAIL" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[9px] tracking-[0.18em] font-mono-term mt-0.5", style: {
              color: "#f59e0b88"
            }, children: "HUMAN APPROVAL REQUIRED BEFORE DEPLOYMENT" })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2 mb-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[9px] font-mono-term tracking-[0.15em] px-2 py-0.5 rounded", style: {
            background: "#1a1200",
            border: "1px solid #f59e0b55",
            color: "#f59e0b"
          }, children: pendingFix.fix_type.toUpperCase() }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[9px] font-mono-term tracking-[0.15em] px-2 py-0.5 rounded", style: {
            background: "#0d1a0d",
            border: "1px solid #4ade8055",
            color: "#4ade80"
          }, children: [
            "TARGET: ",
            pendingFix.target
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-[9px] font-mono-term tracking-[0.15em] px-2 py-0.5 rounded", style: {
            background: pendingFix.estimated_risk === "low" ? "#0d1a0d" : "#1a0606",
            border: `1px solid ${pendingFix.estimated_risk === "low" ? "#4ade8055" : "#ef444455"}`,
            color: pendingFix.estimated_risk === "low" ? "#4ade80" : "#ef4444"
          }, children: [
            "RISK: ",
            pendingFix.estimated_risk.toUpperCase()
          ] })
        ] }),
        (pendingFix.problem || pendingFix.rootCause) && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-md p-3 mb-3 font-mono-term text-[10px] leading-relaxed", style: {
          background: "#050905",
          border: "1px solid #f59e0b33",
          color: "#c8f5d8"
        }, children: [
          pendingFix.problem && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-amber-500 font-bold block mb-0.5 uppercase tracking-wider text-[8.5px] font-orbitron", children: "🚨 DETECTED SYMPTOMS" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "opacity-95", children: pendingFix.problem })
          ] }),
          pendingFix.rootCause && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-amber-500 font-bold block mb-0.5 uppercase tracking-wider text-[8.5px] font-orbitron", children: "🔍 IDENTIFIED ROOT CAUSE" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "opacity-95", children: pendingFix.rootCause })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[8.5px] tracking-[0.2em] font-orbitron text-emerald-400 font-bold mb-1.5 uppercase", children: "PROPOSED CODE REMEDIATION" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md p-3 mb-4 overflow-auto font-mono-term text-[10.5px] leading-relaxed", style: {
          background: "#020402",
          border: "1px solid #2a3d2a",
          color: "#86efac",
          maxHeight: 160,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all"
        }, children: pendingFix.code }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { id: "governance-confirm-btn", onClick: handleApprove, className: "flex-1 py-2.5 rounded-lg font-mono-term font-bold text-[11px] tracking-[0.18em] transition-all", style: {
            background: "#0d2b1a",
            border: "2px solid #4ade80",
            color: "#4ade80",
            boxShadow: "0 0 16px #4ade8033"
          }, onMouseEnter: (e) => {
            e.currentTarget.style.boxShadow = "0 0 28px #4ade8066";
          }, onMouseLeave: (e) => {
            e.currentTarget.style.boxShadow = "0 0 16px #4ade8033";
          }, children: "✓ CONFIRM & DEPLOY" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { id: "governance-abort-btn", onClick: handleAbort, className: "flex-1 py-2.5 rounded-lg font-mono-term font-bold text-[11px] tracking-[0.18em] transition-all", style: {
            background: "#1a0606",
            border: "2px solid #ef4444",
            color: "#ef4444",
            boxShadow: "0 0 16px #ef444433"
          }, onMouseEnter: (e) => {
            e.currentTarget.style.boxShadow = "0 0 28px #ef444466";
          }, onMouseLeave: (e) => {
            e.currentTarget.style.boxShadow = "0 0 16px #ef444433";
          }, children: "✕ ABORT" })
        ] })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("section", { className: "col-span-5 min-h-0", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Panel, { title: "AGENT NETWORK", right: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-[9px] font-mono-term tracking-[0.18em] px-2 py-1 rounded", style: {
        background: "#0d1a14",
        border: "1px solid #2a3d2a",
        color: "#4ade80"
      }, children: [
        "ROUND ",
        round,
        " OF 2"
      ] }), full: true, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "absolute top-10 left-4 z-20 w-58 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 backdrop-blur-md shadow-2xl", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-[8.5px] tracking-[0.22em] font-orbitron text-emerald-400 font-black mb-1.5 block uppercase", children: "TARGET INCIDENT PROFILE" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative group", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: selectedScenario, onChange: (e) => setSelectedScenario(e.target.value), disabled: isIncidentLive, className: "w-full bg-[#0a0f18] text-emerald-100 text-[10px] font-mono-term rounded border border-emerald-500/40 px-2 py-1.5 appearance-none focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/35 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer", style: {
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              background: "radial-gradient(ellipse at top, #0d1424 0%, #070a10 100%)"
            }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "001", className: "bg-[#090d16] text-emerald-100", title: "Simulates a missing composite database index causing query bottlenecks.", children: "SCN 001: MISSING INDEX" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "002", className: "bg-[#090d16] text-emerald-100", title: "Simulates connection pool exhaustion by leaking DB clients.", children: "SCN 002: CONN POOL LEAK" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "003", className: "bg-[#090d16] text-emerald-100", title: "Simulates a tight retry storm that saturates the thread pool.", children: "SCN 003: RETRY STORM" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "pointer-events-none absolute inset-y-0 right-2 flex items-center text-emerald-400", children: /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { className: "fill-current h-3 w-3 transition-transform group-hover:translate-y-0.5", xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 20 20", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" }) }) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-2 text-[9px] font-mono-term text-[#c8f5d8] opacity-85 leading-normal border-t border-emerald-500/15 pt-2", children: [
            selectedScenario === "001" && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { className: "text-emerald-400", children: "Missing DB Index:" }),
              " Slows Query 402, triggering transaction backlogs and connection timeouts."
            ] }),
            selectedScenario === "002" && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { className: "text-emerald-400", children: "Connection Pool Leak:" }),
              " Leaks connections in /break-pool, freezing queries when max pool limit is reached."
            ] }),
            selectedScenario === "003" && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { className: "text-emerald-400", children: "Retry Storm:" }),
              " Hammers downstream API without delays inside /break-retry, saturating the thread pool."
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(AgentNetwork, { agentStatuses, skepticVerdict, activeEdge })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("section", { className: "col-span-4 min-h-0 relative", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Panel, { title: "AGENT TERMINAL · LIVE", full: true, noPad: true, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative h-full w-full", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { ref: termRef, className: "h-full w-full overflow-y-auto no-scrollbar p-3 font-mono-term text-[11.5px] leading-[1.55]", style: {
          background: "#020402",
          boxShadow: "inset 0 0 40px rgba(0,0,0,0.8), 0 0 1px #4ade8033",
          color: "#4ade80"
        }, children: [
          lines.map((l) => /* @__PURE__ */ jsxRuntimeExports.jsx(TermRow, { line: l }, l.n)),
          typing && /* @__PURE__ */ jsxRuntimeExports.jsx(TermRow, { line: {
            n: typing.n,
            prefix: typing.prefix,
            prefixColor: typing.prefixColor,
            text: typing.text.slice(0, typing.shown)
          }, caret: true })
        ] }),
        summaryButtonVisible && !showSummary && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute bottom-4 left-4 z-10", style: {
          animation: "fadeInUp 0.4s ease both"
        }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => {
          setShowSummary(true);
          if (!incidentSummary) setSummaryLoading(true);
        }, className: "px-2.5 py-1 rounded font-orbitron font-bold text-[8.5px] tracking-[0.15em]", style: {
          background: "#0d2b1a",
          border: "1px solid #4ade80",
          color: "#4ade80",
          boxShadow: "0 0 16px #4ade8066, 0 0 4px #4ade8033"
        }, onMouseEnter: (e) => {
          e.currentTarget.style.boxShadow = "0 0 28px #4ade80aa, 0 0 8px #4ade8055";
        }, onMouseLeave: (e) => {
          e.currentTarget.style.boxShadow = "0 0 16px #4ade8066, 0 0 4px #4ade8033";
        }, children: "INCIDENT SUMMARY" }) }),
        showSummary && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "absolute inset-0 z-20 flex flex-col p-6", style: {
          background: "rgba(2, 4, 2, 0.90)",
          backdropFilter: "blur(6px)"
        }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between items-center mb-4 flex-shrink-0", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-orbitron font-bold tracking-[0.2em] text-[12px] text-emerald-400", style: {
              textShadow: "0 0 12px #4ade8088"
            }, children: "POST-INCIDENT REPORT" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => setShowSummary(false), className: "text-emerald-400/60 hover:text-emerald-400 transition-colors", children: /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M18 6L6 18M6 6l12 12", strokeLinecap: "round" }) }) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex-1 overflow-auto rounded-lg border border-emerald-500/20 bg-emerald-950/30 p-5", style: {
            boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)"
          }, children: summaryLoading || !incidentSummary ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-mono-term text-[11px] text-emerald-400/60", style: {
              animation: "blinkCursor 1.2s ease infinite"
            }, children: "▌ Analysing incident thread... generating report..." }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2 mt-2", children: ["70%", "55%", "80%"].map((w, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
              height: 10,
              width: w,
              background: "#4ade8022",
              borderRadius: 4,
              animation: `pulse 1.8s ease-in-out ${i * 0.3}s infinite`
            } }, i)) })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "font-mono-term text-[11.5px] leading-[1.8] text-[#c8f5d8] whitespace-pre-wrap", children: incidentSummary }) })
        ] })
      ] }) }) })
    ] }),
    showRebreakModal && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute inset-0 flex items-center justify-center", style: {
      zIndex: 60,
      backdropFilter: "blur(5px)",
      background: "rgba(0,0,0,0.7)"
    }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl p-6 max-w-md w-full mx-4 border", style: {
      background: "#0c0d12",
      borderColor: "#f59e0b",
      boxShadow: "0 0 60px rgba(245,158,11,0.25), 0 0 120px rgba(245,158,11,0.1)"
    }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xl", children: "⚠️" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[12px] tracking-[0.25em] font-orbitron font-black text-amber-500 uppercase", children: "ENVIRONMENT HEALTHY" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[9px] tracking-[0.18em] font-mono-term mt-0.5 text-amber-500/60 uppercase", children: "ACTIVE PATCH DETECTED" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-[11px] font-mono-term leading-relaxed text-[#c8f5d8] opacity-90 mb-5", children: [
        "Scenario ",
        selectedScenario,
        " is currently running smoothly under AutoSRE governance. The system has been fully stabilized. Would you like to override the active AI patch and re-inject the infrastructure failure to run the simulation again?"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: () => setShowRebreakModal(false), className: "flex-1 py-2 rounded font-mono-term text-[10.5px] tracking-[0.15em] border border-white/10 hover:border-white/20 transition-all text-slate-300 bg-white/[0.02] hover:bg-white/[0.05]", children: "CANCEL" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: async () => {
          setShowRebreakModal(false);
          setResolvedScenarios((prev) => prev.filter((id) => id !== selectedScenario));
          try {
            const res = await fetch("https://auto-sre-production.up.railway.app/api/reset", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                scenarioId: selectedScenario
              })
            });
            if (!res.ok) {
              throw new Error("Failed to reset sandbox environment");
            }
          } catch (err) {
            console.error("Failed to reset scenario environment:", err);
          }
          startIncident();
        }, className: "flex-1 py-2 rounded font-mono-term font-bold text-[10.5px] tracking-[0.15em] transition-all cursor-pointer", style: {
          background: "rgba(245, 158, 11, 0.15)",
          border: "2px solid #f59e0b",
          color: "#f59e0b",
          boxShadow: "0 0 16px rgba(245, 158, 11, 0.3)"
        }, onMouseEnter: (e) => {
          e.currentTarget.style.boxShadow = "0 0 28px rgba(245, 158, 11, 0.6)";
        }, onMouseLeave: (e) => {
          e.currentTarget.style.boxShadow = "0 0 16px rgba(245, 158, 11, 0.3)";
        }, children: "RE-BREAK & RUN" })
      ] })
    ] }) })
  ] });
}
function TermRow({
  line,
  caret
}) {
  const isHighlight = line.text.toLowerCase().includes("sandbox") || line.text.includes("✓ Connection pool") || line.text.includes("✓ Retry storm") || line.text.includes("✓ Query performance");
  const rowStyle = isHighlight ? {
    fontSize: "12.5px",
    fontWeight: "bold",
    textShadow: "0 0 8px rgba(251, 191, 36, 0.4)"
  } : {};
  const prefixColor = isHighlight ? "#fbbf24" : line.prefixColor;
  const textColor = isHighlight ? "#fbbf24" : "#c8f5d8";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2 whitespace-pre-wrap py-0.5", style: rowStyle, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
      color: "#2a3d2a",
      minWidth: 28,
      fontSize: isHighlight ? "11.5px" : void 0
    }, children: String(line.n).padStart(3, "0") }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
      color: prefixColor,
      minWidth: 120
    }, children: line.prefix }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: {
      color: textColor,
      flex: 1
    }, children: [
      line.text,
      caret && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
        animation: "blinkCursor 1s infinite"
      }, children: "█" })
    ] })
  ] });
}
function Pill({
  label,
  value,
  tone,
  mono,
  blink
}) {
  const color = tone === "red" ? "#ef4444" : tone === "green" ? "#4ade80" : "#9ca3af";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "px-2.5 py-1 rounded flex items-center gap-1.5", style: {
    background: tone === "red" ? "#2b0d0d" : "rgba(255,255,255,0.03)",
    border: `1px solid ${tone === "red" ? "#ef444466" : "rgba(255,255,255,0.08)"}`,
    animation: blink ? "blinkCursor 1s infinite" : "none"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[9px] tracking-[0.2em] font-mono-term", style: {
      color: "#6b7a6b"
    }, children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `text-[10.5px] font-bold tracking-[0.12em] ${mono ? "font-mono-term tabular-nums" : "font-mono-term"}`, style: {
      color
    }, children: value })
  ] });
}
function Panel({
  title,
  children,
  right,
  full,
  noPad,
  className = ""
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: `rounded-lg backdrop-blur-md flex flex-col ${full ? "h-full" : ""} ${className}`, style: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between px-3 py-2 border-b border-white/5", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[9.5px] tracking-[0.22em] font-orbitron uppercase", style: {
        color: "#4ade8099"
      }, children: title }),
      right
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: `flex-1 min-h-0 ${noPad ? "" : "p-3"}`, children })
  ] });
}
function Metric({
  label,
  value,
  red
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded p-2", style: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.04)"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[8.5px] font-mono-term tracking-[0.2em]", style: {
      color: "#6b7a6b"
    }, children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "font-inter tabular-nums font-bold mt-0.5", style: {
      color: red ? "#ef4444" : "#4ade80",
      fontSize: red ? 16 : 15,
      textShadow: red ? "0 0 12px rgba(239,68,68,0.5)" : "none"
    }, children: value })
  ] });
}
function AgentNetwork({
  agentStatuses,
  skepticVerdict,
  activeEdge
}) {
  const nodes = {
    skeptic: {
      x: 50,
      y: 14,
      label: "THE SKEPTIC",
      role: "Critic"
    },
    detective: {
      x: 15,
      y: 78,
      label: "THE DETECTIVE",
      role: "Investigator"
    },
    fixer: {
      x: 85,
      y: 78,
      label: "THE FIXER",
      role: "Engineer"
    }
  };
  const edge = (from, to, id, rejected = false) => {
    const isActive = activeEdge === id;
    const stroke = rejected && isActive ? "#ef4444" : isActive ? "#4ade80" : "#1a2e1a";
    return /* @__PURE__ */ jsxRuntimeExports.jsx("line", { x1: `${nodes[from].x}%`, y1: `${nodes[from].y}%`, x2: `${nodes[to].x}%`, y2: `${nodes[to].y}%`, stroke, strokeWidth: isActive ? 2 : 1, strokeDasharray: "6 6", style: {
      animation: isActive ? "dashFlow 0.8s linear infinite" : "none",
      filter: isActive ? `drop-shadow(0 0 4px ${stroke})` : "none"
    } }, id);
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative w-full h-full", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { className: "absolute inset-0 w-full h-full", style: {
      zIndex: 1
    }, children: [
      edge("detective", "fixer", "det-fix"),
      edge("fixer", "skeptic", "fix-skep"),
      edge("skeptic", "detective", "skep-det", true)
    ] }),
    Object.keys(nodes).map((k) => {
      const n = nodes[k];
      const status = agentStatuses[k] || "idle";
      const isActive = status === "processing";
      const isCompleted = status === "completed";
      const hasProcessing = Object.values(agentStatuses).some((s) => s === "processing");
      const isDimmed = hasProcessing && !isActive;
      let bg = "rgba(255,255,255,0.02)";
      let border = "rgba(255,255,255,0.08)";
      let iconColor = "#4b5563";
      let badgeText = "● STANDBY";
      let badgeColor = "#4b5563";
      if (isActive) {
        bg = "#1e1505";
        border = "#fbbf24";
        iconColor = "#fbbf24";
        badgeColor = "#fbbf24";
        badgeText = k === "detective" ? "● SEARCHING LOGS" : k === "fixer" ? "● GENERATING PATCH" : "● REVIEWING FIX";
      } else if (isCompleted) {
        bg = "#0d2b1a";
        border = "#4ade80";
        iconColor = "#4ade80";
        badgeColor = "#4ade80";
        badgeText = "✓ COMPLETED";
      }
      return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "absolute", style: {
        left: `${n.x}%`,
        top: `${n.y}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 2,
        opacity: isDimmed ? 0.4 : 1,
        transition: "opacity 0.4s ease"
      }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative", children: [
          isActive && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "absolute inset-0 rounded-xl", style: {
              border: `2px solid ${border}`,
              animation: "pulseRing 1.6s ease-out infinite"
            } }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "absolute inset-0 rounded-xl", style: {
              border: `2px solid ${border}`,
              animation: "pulseRing 1.6s ease-out infinite 0.4s"
            } })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-[72px] h-[72px] rounded-xl flex items-center justify-center relative", style: {
            background: bg,
            border: `${isActive || isCompleted ? 2 : 1}px solid ${border}`,
            boxShadow: isActive ? `0 0 24px ${border}55` : isCompleted ? `0 0 16px ${border}33` : "none"
          }, children: /* @__PURE__ */ jsxRuntimeExports.jsx(AgentIcon, { kind: k, color: iconColor }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-center", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[10px] font-bold tracking-[0.2em] font-inter", style: {
            color: "#e6fff0"
          }, children: n.label }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-[8.5px] font-mono-term tracking-[0.15em]", style: {
            color: "#6b7a6b"
          }, children: n.role })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "px-2 py-0.5 rounded text-[8.5px] font-mono-term tracking-[0.15em]", style: {
          background: isActive || isCompleted ? bg : "#0a0f0a",
          border: `1px solid ${isActive || isCompleted ? badgeColor : "#1a2030"}`,
          color: badgeColor,
          whiteSpace: "nowrap"
        }, children: badgeText })
      ] }) }, k);
    })
  ] });
}
function AgentIcon({
  kind,
  color
}) {
  if (kind === "detective") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { width: "32", height: "32", viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "1.8", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "11", cy: "11", r: "6" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M20 20l-4.5-4.5", strokeLinecap: "round" })
    ] });
  }
  if (kind === "fixer") {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "32", height: "32", viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "1.8", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z", strokeLinejoin: "round" }) });
  }
  if (kind === "skeptic") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { width: "32", height: "32", viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "1.8", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z", strokeLinejoin: "round" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M9 12l2 2 4-4", strokeLinecap: "round", strokeLinejoin: "round" })
    ] });
  }
  return null;
}
export {
  AutoSRE as component
};
