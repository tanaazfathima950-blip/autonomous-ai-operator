"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Circle,
  Copy, FileSpreadsheet, Loader2, Mail, RefreshCw, Send, ShieldCheck, X, Check,
} from "lucide-react";

/* ---------- Config ---------- */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEFAULT_GOAL = "Find 3 CS internships for a third-year student";

/* ---------- Types ---------- */
type Obj = Record<string, any>;
interface AuditEntry { time: string; node: string; event: string; detail: string }
interface Interrupt {
  type?: string; message?: string; spreadsheet_path?: string | null;
  spreadsheet_saved?: boolean; error_status?: string | null;
  internships?: Obj[]; drafted_emails?: Obj[];
}
interface Resp {
  thread_id: string; requires_input: boolean; interrupt?: Interrupt | null;
  next?: string[]; internships?: Obj[]; drafted_emails?: Obj[];
  spreadsheet_saved: boolean; spreadsheet_path?: string | null;
  error_status?: string | null; retry_count: number;
  approval_status?: "approved" | "rejected" | "retry" | null;
  messages?: string[]; plan?: string[]; audit_log?: AuditEntry[];
}

/* ---------- Helpers ---------- */
const pick = (o: Obj, keys: string[]) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
};
/* ---------- Mock mode (demo without backend) ---------- */
const MOCK = process.env.NEXT_PUBLIC_MOCK === "true";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const M_INTERN = [
  { title: "STEP Intern", company: "Google", link: "https://careers.google.com", eligibility: "2nd-3rd year CS" },
  { title: "SWE Intern", company: "Microsoft", link: "https://careers.microsoft.com", eligibility: "3rd year CS, CGPA 7.5+" },
  { title: "Research Intern", company: "Adobe", link: "https://adobe.com/careers", eligibility: "3rd year CS, ML basics" },
];
const M_EMAILS = M_INTERN.map((i) => ({
  subject: `Application for ${i.title} - ${i.company}`,
  body: `Dear ${i.company} Hiring Team,\n\nI am a third-year Computer Science student interested in the ${i.title} role. My profile matches your eligibility (${i.eligibility}).\n\nRegards,\nStudent`,
}));
let M = { fails: 0, retries: 0, saved: false, audit: [] as AuditEntry[], msgs: [] as string[] };
const mlog = (node: string, event: string, detail: string) =>
  M.audit.push({ time: new Date().toLocaleTimeString(), node, event, detail });
function mockSave() {
  while (true) {
    if (M.fails > 0) {
      M.fails--; M.retries++;
      mlog("excel_writer", "save_failed", "Excel file locked (simulated outage)");
      continue;
    }
    M.saved = true;
    mlog("excel_writer", "spreadsheet_saved", "internships_matched.xlsx");
    return;
  }
}
function snap(done: boolean, approval: Resp["approval_status"]): Resp {
  const path = M.saved ? "outputs/internships_matched.xlsx" : null;
  return {
    thread_id: "mock-thread",
    requires_input: !done,
    interrupt: done ? null : {
      type: "approval_request",
      message: "Please review the internships and drafted emails before finalizing.",
      spreadsheet_path: path, spreadsheet_saved: M.saved, error_status: null,
      internships: M_INTERN, drafted_emails: M_EMAILS,
    },
    internships: M_INTERN, drafted_emails: M_EMAILS,
    spreadsheet_saved: M.saved, spreadsheet_path: path, error_status: null,
    retry_count: M.retries, approval_status: approval, messages: M.msgs,
    plan: ["Search internships", "Draft emails", "Save to Excel", "Wait for human approval"],
    audit_log: M.audit,
  };
}
async function mockPost(path: string, body: Obj): Promise<Resp> {
  if (path.endsWith("/start")) {
    await sleep(3500);
    M = { fails: body.simulate_failures ?? 0, retries: 0, saved: false, audit: [], msgs: [] };
    mlog("planner", "plan_created", body.goal);
    M.msgs.push("Planning tasks");
    mlog("search", "internships_found", "3 internships found");
    M.msgs.push("Found 3 internships");
    mlog("email_drafter", "emails_drafted", "3 drafts created");
    M.msgs.push("Drafted 3 emails");
    mockSave();
    M.msgs.push("Spreadsheet saved");
    mlog("human_approval", "awaiting_human", "Paused for approval");
    M.msgs.push("Waiting for human approval");
    return snap(false, null);
  }
  await sleep(1000);
  const a = body.action as string;
  mlog("human_approval", `human_${a}`, `Human chose ${a}`);
  if (a === "approve") {
    M.msgs.push("Approved. 3 email drafts finalized and spreadsheet saved.");
    return snap(true, "approved");
  }
  M.msgs.push("Rejected. Run stopped without finalizing.");
  return snap(true, "rejected");
}
async function post(path: string, body: Obj): Promise<Resp> {
       if (MOCK) return mockPost(path, body);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach the backend at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

const eventStyle = (ev: string) => {
  const e = ev.toLowerCase();
  if (e.includes("fail") || e.includes("error")) return "bg-red-50 text-red-700 border-red-200";
  if (e.includes("fallback") || e.includes("unavailable")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (/(human|approv|reject|retry|decision)/.test(e)) return "bg-blue-50 text-blue-700 border-blue-200";
  if (/(saved|success|complete|found|drafted|final|done)/.test(e)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
};

/* ---------- Small components ---------- */
const TITLE_KEYS = ["title", "role", "position", "job_title", "name"];
const COMPANY_KEYS = ["company", "organization", "organisation", "employer"];
const LINK_KEYS = ["link", "url", "apply_link", "apply_url", "application_url"];

function InternshipCard({ item, index }: { item: Obj; index: number }) {
  if (typeof item !== "object" || item === null)
    return <div className="rounded-lg border border-gray-200 p-3 text-sm">{String(item)}</div>;
  const title = pick(item, TITLE_KEYS) || `Internship ${index + 1}`;
  const company = pick(item, COMPANY_KEYS);
  const link = pick(item, LINK_KEYS);
  const used = [...TITLE_KEYS, ...COMPANY_KEYS, ...LINK_KEYS];
  const rest = Object.entries(item)
    .filter(([k, v]) => !used.includes(k) && v !== null && typeof v !== "object" && String(v).trim() !== "")
    .slice(0, 5);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-2">
        <Briefcase className="w-4 h-4 mt-1 text-indigo-600 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{title}</div>
          {company && <div className="text-xs text-gray-600">{company}</div>}
        </div>
      </div>
      {rest.length > 0 && (
        <dl className="mt-2 space-y-0.5">
          {rest.map(([k, v]) => (
            <div key={k} className="text-xs text-gray-600">
              <span className="font-medium capitalize">{k.replace(/_/g, " ")}:</span> {String(v)}
            </div>
          ))}
        </dl>
      )}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-indigo-600 hover:underline break-all">
          {link}
        </a>
      )}
    </div>
  );
}

function EmailCard({ item, index }: { item: Obj; index: number }) {
  const isObj = typeof item === "object" && item !== null;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [subject, setSubject] = useState(isObj ? pick(item, ["subject", "title"]) : "");
  const [body, setBody] = useState(
    isObj ? pick(item, ["body", "content", "text", "email", "draft", "message"]) : String(item)
  );
  const to = isObj ? pick(item, ["to", "recipient", "email_to"]) : "";
  const text = subject || body ? `Subject: ${subject}\n\n${body}` : JSON.stringify(item, null, 2);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 p-3 text-left">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Mail className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
          {subject || `Draft ${index + 1}`}
        </span>
        {edited && (
          <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
            edited
          </span>
        )}
        {to && <span className="text-xs text-gray-500 hidden sm:inline">To: {to}</span>}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {editing ? (
            <>
              <input
                value={subject}
                onChange={(e) => { setSubject(e.target.value); setEdited(true); }}
                className="w-full mb-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); setEdited(true); }}
                rows={8}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </>
          ) : subject || body ? (
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{body}</p>
          ) : (
            <pre className="text-xs overflow-auto">{text}</pre>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs border border-indigo-200 text-indigo-700 bg-white rounded-md px-2.5 py-1 hover:bg-indigo-50"
            >
              {editing ? "Save" : "Edit"}
            </button>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 text-xs border border-gray-200 bg-white rounded-md px-2.5 py-1 hover:bg-gray-100"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditLog({ log }: { log: AuditEntry[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <ShieldCheck className="w-4 h-4 text-indigo-600" />
        <h2 className="font-semibold text-gray-900">Audit log</h2>
        <span className="text-xs text-gray-500">({log.length} events)</span>
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Node</th>
                <th className="py-1 pr-3">Event</th><th className="py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="py-1.5 pr-3 font-mono text-gray-500 whitespace-nowrap">{l.time}</td>
                  <td className="py-1.5 pr-3 text-gray-700">{l.node}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`inline-block border rounded-full px-2 py-0.5 ${eventStyle(l.event)}`}>{l.event}</span>
                  </td>
                  <td className="py-1.5 text-gray-600">{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Page ---------- */
export default function OperatorPage() {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [simulate, setSimulate] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<null | "start" | "approve" | "reject" | "retry">(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(0);
  const prevThread = useRef<string | null>(null);

  // reveal progress messages one by one on a fresh run (live-looking)
  useEffect(() => {
    const total = data?.messages?.length ?? 0;
    if (!data) { prevThread.current = null; setVisible(0); return; }
    if (prevThread.current === data.thread_id) { setVisible(total); return; }
    prevThread.current = data.thread_id;
    setVisible(0);
    if (!total) return;
    let i = 0;
    const id = setInterval(() => { i++; setVisible(i); if (i >= total) clearInterval(id); }, 350);
    return () => clearInterval(id);
  }, [data]);

  const start = async () => {
    if (!goal.trim()) return;
    setError(null); setBusy("start");
    try {
      setData(await post("/internship/start", { goal: goal.trim(), simulate_failures: simulate ? 2 : null }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const decide = async (action: "approve" | "reject" | "retry") => {
    if (!data) return;
    setError(null); setBusy(action);
    try {
      setData(await post("/internship/decide", { thread_id: data.thread_id, action }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const reset = () => { setData(null); setError(null); setGoal(DEFAULT_GOAL); setSimulate(false); setBusy(null); };

  const paused = !!data?.requires_input;
  const finished = !!data && !data.requires_input;
  const internships = data?.internships?.length ? data.internships : data?.interrupt?.internships ?? [];
  const emails = data?.drafted_emails?.length ? data.drafted_emails : data?.interrupt?.drafted_emails ?? [];
  const showRetry = !!data && (!data.spreadsheet_saved || !!data.error_status);
  const messages = data?.messages ?? [];
  const lastMsg = messages[messages.length - 1] ?? "";
  const inFlight = busy !== null;

  const resultTone =
    data?.approval_status === "approved" && data.spreadsheet_saved
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : data?.approval_status === "approved"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-gray-300 bg-gray-50 text-gray-800";

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-indigo-50/40 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">
          Autonomous AI Operator — Internship &amp; Task Automation
        </h1>
        <p className="text-gray-600 text-sm mt-1 mb-6">
          It finds internships, drafts emails, saves a spreadsheet, and pauses for your approval.
        </p>

        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {/* 1. Start form */}
        {!data && busy !== "start" && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">Your goal</label>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
              Simulate Excel outage (demo)
            </label>
            <button
              onClick={start}
              disabled={!goal.trim()}
              className="mt-4 inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Send className="w-4 h-4" /> Start
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {busy === "start" && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <div className="flex items-center gap-2 text-indigo-700 font-medium text-sm mb-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Running the workflow… this can take several seconds
            </div>
            <div className="space-y-2 animate-pulse">
              {[80, 65, 72, 50].map((w, i) => (
                <div key={i} className="h-3 rounded bg-gray-200" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        )}

        {data && (
          <>
            {/* 2. Progress / plan */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">Plan &amp; progress</h2>
                <span className="text-xs text-gray-500">Automatic retries used: {data.retry_count}</span>
              </div>

              {data.retry_count > 0 && (
                data.spreadsheet_saved ? (
                  <div className="mb-3 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 p-3">
                    Spreadsheet save failed {data.retry_count} time{data.retry_count > 1 ? "s" : ""}, recovered
                    automatically on attempt {data.retry_count + 1}.
                  </div>
                ) : (
                  <div className="mb-3 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-3">
                    Spreadsheet save failed after {data.retry_count} automatic retr{data.retry_count > 1 ? "ies" : "y"}.
                  </div>
                )
              )}

              {!!data.plan?.length && (
                <ol className="space-y-1.5 mb-3">
                  {data.plan.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" /> {p}
                    </li>
                  ))}
                </ol>
              )}

              <ul className="space-y-1">
                {messages.slice(0, visible).map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <Circle className="w-2.5 h-2.5 mt-1 text-gray-400 shrink-0" /> {m}
                  </li>
                ))}
                {visible < messages.length && (
                  <li className="flex items-center gap-2 text-xs text-indigo-600">
                    <Loader2 className="w-3 h-3 animate-spin" /> working…
                  </li>
                )}
              </ul>
            </div>

            {/* 3. Approval panel */}
            {paused && (
              <div className="bg-white border border-amber-200 rounded-xl shadow-sm p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900">Review required</h2>
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                    Paused for human approval
                  </span>
                </div>
                {data.interrupt?.message && <p className="text-sm text-gray-700 mb-3">{data.interrupt.message}</p>}

                {/* Spreadsheet status */}
                {data.spreadsheet_saved ? (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4">
                    <FileSpreadsheet className="w-7 h-7 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-emerald-800">Spreadsheet saved</div>
                      <div className="text-xs text-emerald-700 break-all">{data.spreadsheet_path}</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 mb-4">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-red-800">Spreadsheet not saved</div>
                      <div className="text-xs text-red-700">{data.error_status || "Unknown error"}</div>
                    </div>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-800 mb-2">Internships ({internships.length})</h3>
                <div className="grid gap-3 sm:grid-cols-2 mb-4">
                  {internships.map((it, i) => <InternshipCard key={i} item={it} index={i} />)}
                </div>

                <h3 className="text-sm font-semibold text-gray-800 mb-2">Email drafts ({emails.length})</h3>
                <div className="space-y-2 mb-4">
                  {emails.map((em, i) => <EmailCard key={i} item={em} index={i} />)}
                </div>
                <p className="text-xs text-gray-500 mb-4">Emails are drafts only. Nothing is sent.</p>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => decide("approve")} disabled={inFlight}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                  >
                    {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Approve
                  </button>
                  <button
                    onClick={() => decide("reject")} disabled={inFlight}
                    className="inline-flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-800 rounded-lg px-4 py-2 text-sm font-medium"
                  >
                    {busy === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Reject
                  </button>
                  {showRetry && (
                    <button
                      onClick={() => decide("retry")} disabled={inFlight}
                      className="inline-flex items-center gap-1.5 bg-white border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-medium"
                    >
                      {busy === "retry" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Retry save
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 4. Final result */}
            {finished && (
              <div className={`border rounded-xl shadow-sm p-5 mb-4 ${resultTone}`}>
                <div className="flex items-center gap-2 font-semibold mb-2">
                  <CheckCircle2 className="w-5 h-5" />
                  {data.approval_status === "rejected" ? "Run rejected" : "Workflow complete"}
                </div>
                <p className="text-sm whitespace-pre-wrap">{lastMsg}</p>
                <p className="text-xs mt-3 opacity-80">Emails are drafts only. Nothing was sent.</p>
                <button
                  onClick={reset}
                  className="mt-4 inline-flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Start new run
                </button>
              </div>
            )}

            {/* 5. Audit log */}
            {!!data.audit_log?.length && <AuditLog log={data.audit_log} />}
          </>
        )}
      </div>
    </main>
  );
}