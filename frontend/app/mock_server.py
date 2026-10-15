import uuid
import datetime
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNS = {}


class StartReq(BaseModel):
    goal: str
    simulate_failures: Optional[int] = None


class DecideReq(BaseModel):
    thread_id: str
    action: str


INTERNSHIPS = [
    {"title": "STEP Intern", "company": "Google", "link": "https://careers.google.com", "eligibility": "2nd-3rd year CS"},
    {"title": "SWE Intern", "company": "Microsoft", "link": "https://careers.microsoft.com", "eligibility": "3rd year CS, CGPA 7.5+"},
    {"title": "Research Intern", "company": "Adobe", "link": "https://adobe.com/careers", "eligibility": "3rd year CS, ML basics"},
]
EMAILS = [
    {
        "subject": f"Application for {i['title']} - {i['company']}",
        "body": f"Dear {i['company']} Hiring Team,\n\nI am a third-year Computer Science student interested in the {i['title']} role.\n\nRegards,\nStudent",
    }
    for i in INTERNSHIPS
]


def log(r, node, event, detail):
    r["audit"].append(
        {"time": datetime.datetime.now().strftime("%H:%M:%S"), "node": node, "event": event, "detail": detail}
    )


def try_save(r):
    while True:
        if r["fails_left"] > 0:
            r["fails_left"] -= 1
            r["retry_count"] += 1
            log(r, "excel_writer", "save_failed", "Excel file locked (simulated)")
            if r["retry_count"] >= 3:
                r["saved"] = False
                r["error"] = "Excel save failed after 3 attempts"
                return
            continue
        r["saved"] = True
        r["error"] = None
        log(r, "excel_writer", "spreadsheet_saved", "internships_matched.xlsx")
        return


def snapshot(tid):
    r = RUNS[tid]
    paused = r["status"] == "paused"
    path = "outputs/internships_matched.xlsx" if r["saved"] else None
    return {
        "thread_id": tid,
        "requires_input": paused,
        "interrupt": {
            "type": "approval_request",
            "message": "Please review the internships and drafted emails before finalizing.",
            "spreadsheet_path": path,
            "spreadsheet_saved": r["saved"],
            "error_status": r["error"],
            "internships": INTERNSHIPS,
            "drafted_emails": EMAILS,
        } if paused else None,
        "next": ["human_approval"] if paused else [],
        "internships": INTERNSHIPS,
        "drafted_emails": EMAILS,
        "spreadsheet_saved": r["saved"],
        "spreadsheet_path": path,
        "error_status": r["error"],
        "retry_count": r["retry_count"],
        "approval_status": r["approval"],
        "messages": r["messages"],
        "plan": ["Search internships", "Draft emails", "Save to Excel", "Wait for human approval"],
        "audit_log": r["audit"],
    }


@app.post("/internship/start")
def start(req: StartReq):
    tid = str(uuid.uuid4())
    r = {
        "status": "paused", "saved": False, "error": None, "approval": None,
        "retry_count": 0, "fails_left": req.simulate_failures or 0,
        "audit": [], "messages": [],
    }
    RUNS[tid] = r
    log(r, "planner", "plan_created", req.goal)
    r["messages"].append("Planning tasks")
    log(r, "search", "internships_found", "3 internships")
    r["messages"].append("Found 3 internships")
    log(r, "email_drafter", "emails_drafted", "3 drafts")
    r["messages"].append("Drafted 3 emails")
    try_save(r)
    r["messages"].append("Spreadsheet saved" if r["saved"] else "Spreadsheet save failed")
    log(r, "human_approval", "awaiting_human", "paused")
    r["messages"].append("Waiting for human approval")
    return snapshot(tid)


@app.post("/internship/decide")
def decide(req: DecideReq):
    r = RUNS[req.thread_id]
    log(r, "human_approval", f"human_{req.action}", f"Human chose {req.action}")
    if req.action == "retry":
        try_save(r)
        r["approval"] = "retry"
        r["messages"].append("Retried spreadsheet save")
        return snapshot(req.thread_id)
    r["status"] = "done"
    if req.action == "approve":
        r["approval"] = "approved"
        r["messages"].append(
            "Approved. 3 email drafts finalized and spreadsheet saved."
            if r["saved"]
            else "Approved, but the spreadsheet was NOT saved."
        )
    else:
        r["approval"] = "rejected"
        r["messages"].append("Rejected. Run stopped without finalizing.")
    return snapshot(req.thread_id)