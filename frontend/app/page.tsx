"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Pencil,
  Play,
  Send,
  Sparkles,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Config — agree these with your backend teammate                      */
/* ------------------------------------------------------------------ */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const START_PATH = "/approval/start"; // POST { task }
const DECIDE_PATH = "/approval/decide"; // POST { thread_id, action, content?, emails?, feedback? }
// Set NEXT_PUBLIC_MOCK=true to demo the UI without the backend running.
const MOCK = process.env.NEXT_PUBLIC_MOCK === "true";

const PRESET_PROMPT =
  "Find three internship opportunities suitable for a third-year computer science student, compare their eligibility criteria, save the best matches to a spreadsheet, and prepare personalized draft emails for each opportunity.";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */
type StepStatus = "pending" | "running" | "done" | "error";
type Phase = "idle" | "running" | "awaiting" | "deciding" | "sent";

interface Step {
  id: string;
  label: string;
  status: StepStatus;
}
interface Email {
  id: string;
  to?: string;
  subject: string;
  body: string;
}
interface Spreadsheet {
  filename: string;
  rows?: number;
  url?: string; // optional download link served by the backend
  verified?: boolean;
}
interface OperatorResponse {
  thread_id?: string;
  requires_input: boolean;
  status?: string;
  steps?: Step[]; // optional: real step states from the backend
  spreadsheet?: Spreadsheet;
  emails?: Email[];
  draft?: string; // fallback: the template's single-draft string
  final_output?: string;
  error?: string;
}

const STEP_DEFS = [
  { id: "research", label: "Researching internships" },
  { id: "spreadsheet", label: "Saving to spreadsheet" },
  { id: "drafts", label: "Drafting emails" },
  { id: "approval", label: "Awaiting approval" },
  { id: "sent", label: "Sending" },
];

/* ------------------------------------------------------------------ */
/* Mock backend (only used when NEXT_PUBLIC_MOCK=true)                  */
/* ------------------------------------------------------------------ */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mockStart(): Promise<OperatorResponse> {
  await sleep(7500);
  return {
    thread_id: "mock-thread",
    requires_input: true,
    status: "awaiting_review",
    spreadsheet: { filename: "internships_matched.xlsx", rows: 3, verified: true },
    emails: [1, 2, 3].map((n) => ({
      id: `e${n}`,
      to: `careers@company${n}.example`,
      subject: `Application for Software Engineering Internship — Tanaaz Fathima`,
      body: `Dear Hiring Team,\n\nI am a third-year Information Science student with a 9.0+ CGPA and experience in Python, Java and DSA. I would love to apply for the internship at Company ${n}.\n\nBest regards,\nTanaaz Fathima`,
    })),
  };
}
async function mockDecide(action: string): Promise<OperatorResponse> {
  await sleep(1200);
  if (action === "reject") {
    return {
      requires_input: true,
      status: "awaiting_review",
      spreadsheet: { filename: "internships_matched.xlsx", rows: 3, verified: true },
      emails: [1, 2, 3].map((n) => ({
        id: `e${n}`,
        to: `careers@company${n}.example`,
        subject: `Internship Application — Tanaaz Fathima (Revised)`,
        body: `Dear Hiring Team,\n\nI am a third-year ISE student with a 9.0+ CGPA. I built a portfolio website and would love to apply to Company ${n}.\n\nBest regards,\nTanaaz Fathima`,
      })),
    };
  }
  return {
    requires_input: false,
    status: "sent",
    final_output: "All 3 application emails were approved and sent.",
  };
}
/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */
export default function OperatorPage() {
  const [task, setTask] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [tick, setTick] = useState(0); // client-side progress while waiting
  const [serverSteps, setServerSteps] = useState<Step[] | null>(null);
  const [spreadsheet, setSpreadsheet] = useState<Spreadsheet | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [log, setLog] = useState<{ t: string; msg: string }[]>([]);
  const logEnd = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) =>
    setLog((l) => [...l, { t: new Date().toLocaleTimeString(), msg }]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log]);

  // While the start request is in flight, advance the first three steps on a
  // timer. This is only an estimate; real `steps` from the backend override it.
  useEffect(() => {
    if (phase !== "running") return;
    setTick(0);
    const id = setInterval(() => setTick((t) => Math.min(t + 1, 2)), 2500);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") return;
    const msgs = [
      "Researching internship opportunities…",
      "Saving matches to spreadsheet…",
      "Drafting personalized emails…",
    ];
    if (tick > 0) addLog(msgs[tick]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const applyResponse = (data: OperatorResponse) => {
    if (data.thread_id) setThreadId(data.thread_id);
    setServerSteps(data.steps ?? null);
    if (data.spreadsheet) setSpreadsheet(data.spreadsheet);
    if (data.emails?.length) {
      setEmails(data.emails);
    } else if (data.draft) {
      setEmails([{ id: "draft", subject: "Draft", body: data.draft }]);
    }
    setFinalOutput(data.final_output ?? "");
    setEditing(false);
    setRejecting(false);
    setFeedback("");
    setDirty(false);

    const sent = data.status === "sent" || data.status === "sent_with_unresolved_feedback";
    if (sent) {
      setPhase("sent");
      addLog("Emails approved and sent ✔");
    } else if (data.requires_input || data.status === "awaiting_review") {
      setPhase("awaiting");
      addLog("Paused — waiting for your approval");
    }
  };

  const startRun = async (override?: string) => {
    const goal = (override ?? task).trim();
    if (!goal) return;
    setTask(goal);
    setError(null);
    setLog([]);
    setSpreadsheet(null);
    setEmails([]);
    setFinalOutput("");
    setServerSteps(null);
    setThreadId(null);
    setPhase("running");
    addLog("Goal received — planning tasks");
    try {
      let data: OperatorResponse;
      if (MOCK) {
        data = await mockStart();
      } else {
        const res = await fetch(`${API_URL}${START_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: goal }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }
      if (data.error) throw new Error(data.error);
      applyResponse(data);
    } catch (e) {
      setPhase("idle");
      addLog("Run failed");
      setError(
        `Could not run the operator (${(e as Error).message}). Is the backend running on ${API_URL}?`
      );
    }
  };

  const decide = async (action: "approve" | "edit" | "reject") => {
    if (!threadId && !MOCK) return;
    setError(null);
    setPhase("deciding");
    addLog(
      action === "reject" ? "Sent feedback — redrafting…" : "Approved — sending emails…"
    );
    try {
      let data: OperatorResponse;
      if (MOCK) {
        data = await mockDecide(action);
      } else {
        const res = await fetch(`${API_URL}${DECIDE_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            action,
            emails: action === "edit" ? emails : undefined,
            // the template's approval endpoint expects a single `content` string
            content:
              action === "edit"
                ? emails.map((e) => `Subject: ${e.subject}\n\n${e.body}`).join("\n\n---\n\n")
                : undefined,
            feedback: action === "reject" ? feedback : undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }
      applyResponse(data);
    } catch (e) {
      setPhase("awaiting");
      setError(`Could not submit your decision (${(e as Error).message}). Please try again.`);
    }
  };

  const reset = () => {
    setTask("");
    setThreadId(null);
    setPhase("idle");
    setSpreadsheet(null);
    setEmails([]);
    setFinalOutput("");
    setServerSteps(null);
    setLog([]);
    setError(null);
  };

  const updateEmail = (id: string, patch: Partial<Email>) => {
    setEmails((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  /* ---- derive the timeline ---- */
  const steps: Step[] =
    serverSteps ??
    STEP_DEFS.map((s, i) => {
      let status: StepStatus = "pending";
      if (phase === "running") status = i < tick ? "done" : i === tick ? "running" : "pending";
      else if (phase === "awaiting") status = i < 3 ? "done" : i === 3 ? "running" : "pending";
      else if (phase === "deciding") status = i < 4 ? "done" : "running";
      else if (phase === "sent") status = "done";
      return { ...s, status };
    });

  const busy = phase === "running" || phase === "deciding";
  const reviewing = phase === "awaiting" || phase === "deciding";

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-indigo-50/40 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Bot className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Autonomous AI Operator — Internship &amp; Task Automation
          </h1>
        </div>
        <p className="text-gray-600 text-sm mb-6 ml-[52px]">
          Give it a goal. It plans, researches, saves to a spreadsheet, drafts emails — and
          pauses for your approval before anything is sent.
        </p>

        {/* Goal input */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your goal</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            disabled={busy || reviewing}
            rows={3}
            placeholder="e.g. Find three internships for a third-year CS student and draft application emails…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50"
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={() => (phase === "sent" ? reset() : startRun())}
              disabled={busy || reviewing || (phase !== "sent" && !task.trim())}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              {phase === "running" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {phase === "sent" ? "New task" : "Run operator"}
            </button>
            <button
              onClick={() => startRun(PRESET_PROMPT)}
              disabled={busy || reviewing}
              className="inline-flex items-center gap-1.5 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
              title={PRESET_PROMPT}
            >
              <Sparkles className="w-4 h-4" /> Try demo: Internship search
            </button>
            <button
              onClick={() => setTask(PRESET_PROMPT)}
              disabled={busy || reviewing}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              <Play className="w-3 h-3" /> Fill prompt only
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Execution timeline + log */}
        {phase !== "idle" && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-4">
            <h2 className="font-semibold text-gray-900 mb-3">Execution status</h2>
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 text-sm">
                  {s.status === "done" && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                  {s.status === "running" && (
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                  )}
                  {s.status === "pending" && <Circle className="w-5 h-5 text-gray-300" />}
                  {s.status === "error" && <AlertTriangle className="w-5 h-5 text-red-600" />}
                  <span
                    className={
                      s.status === "pending"
                        ? "text-gray-400"
                        : s.status === "error"
                        ? "text-red-700"
                        : "text-gray-800"
                    }
                  >
                    {s.label}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 max-h-32 overflow-y-auto rounded-lg bg-gray-900 text-gray-200 text-xs font-mono p-3 space-y-1">
              {log.map((l, i) => (
                <div key={i}>
                  <span className="text-gray-500">[{l.t}]</span> {l.msg}
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </div>
        )}

        {/* Human-in-the-loop approval card */}
        {reviewing && (
          <div className="bg-white border border-amber-200 rounded-xl shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Review required</h2>
              <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                Paused for human approval
              </span>
            </div>

            {/* Spreadsheet success indicator */}
            {spreadsheet && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4">
                <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4" />
                    Spreadsheet generated{spreadsheet.verified ? " & verified" : ""}
                  </div>
                  <div className="text-xs text-emerald-700 truncate">
                    {spreadsheet.filename}
                    {spreadsheet.rows != null && ` · ${spreadsheet.rows} internships saved`}
                  </div>
                </div>
                {spreadsheet.url && (
                  <a
                    href={spreadsheet.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    <Download className="w-4 h-4" /> Open
                  </a>
                )}
              </div>
            )}

            {/* Email previews */}
            <div className="space-y-3">
              {emails.map((em, i) => (
                <div key={em.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2">
                    <Mail className="w-4 h-4" /> Draft {i + 1} of {emails.length}
                    {em.to && <span className="text-gray-400">· To: {em.to}</span>}
                  </div>
                  {editing ? (
                    <>
                      <input
                        value={em.subject}
                        onChange={(e) => updateEmail(em.id, { subject: e.target.value })}
                        className="w-full mb-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      <textarea
                        value={em.body}
                        onChange={(e) => updateEmail(em.id, { body: e.target.value })}
                        rows={7}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-gray-900 mb-1">
                        {em.subject}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{em.body}</p>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Reject feedback */}
            {rejecting && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  What should change? The operator will redraft:
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                  placeholder="e.g. Make the emails shorter and mention my portfolio project"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => decide("reject")}
                    disabled={busy || !feedback.trim()}
                    className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-sm font-medium"
                  >
                    <X className="w-4 h-4" /> Request changes
                  </button>
                  <button
                    onClick={() => setRejecting(false)}
                    className="text-sm text-gray-500 hover:text-gray-800 px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action bar */}
            {!rejecting && (
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => decide(dirty ? "edit" : "approve")}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {phase === "deciding" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {dirty ? "Approve edits & Send" : "Approve & Send"}
                </button>
                <button
                  onClick={() => setEditing((v) => !v)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  <Pencil className="w-4 h-4" /> {editing ? "Done editing" : "Edit"}
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  <X className="w-4 h-4" /> Reject
                </button>
              </div>
            )}
          </div>
        )}

        {/* Completion */}
        {phase === "sent" && (
          <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-2">
              <CheckCircle2 className="w-5 h-5" /> Workflow complete
            </div>
            {spreadsheet && (
              <p className="text-sm text-gray-700 mb-2">
                Spreadsheet <span className="font-mono">{spreadsheet.filename}</span> saved.
              </p>
            )}
            {finalOutput && (
              <div className="prose prose-sm max-w-none text-gray-800">
                <ReactMarkdown>{finalOutput}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}