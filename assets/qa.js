(() => {
    "use strict";

    const byId = id => document.getElementById(id);
    const scorecards = {
        human: { label: "Human agent", criteria: ["Resolution accuracy", "Policy adherence", "Communication", "Documentation", "Follow-through"] },
        ai: { label: "AI agent", criteria: ["Answer accuracy", "Policy and source alignment", "Clarity", "Escalation judgment", "Promises made"] },
        handoff: { label: "AI to human handoff", criteria: ["Escalation timing", "Routing accuracy", "Context carried over", "Customer repetition", "Continuity of support"] }
    };
    const scoreValues = ["pass", "fail", "na"];
    const options = '<option value="">Select rating</option><option value="pass">Meets standard</option><option value="fail">Misses standard</option><option value="na">Not applicable</option>';
    const state = { key: "", view: "queue", candidates: [], sourceRequest: 0, reviewRequest: 0, current: null, messages: [], evidence: null };
    const esc = value => escapeHtml(String(value ?? ""));
    const readable = value => String(value || "").replaceAll("_", " ");
    const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const sourceKey = item => JSON.stringify([item.type, item.sourceId]);
    const formStatus = message => { byId("qaFormStatus").textContent = message; };
    const notice = message => { byId("qaStatus").textContent = message; };

    function read() {
        try { return JSON.parse(window.NOVARA_LOCAL_STORAGE.getItem(state.key) || "[]"); }
        catch { return []; }
    }

    function persist(record) {
        try {
            const records = read();
            const index = records.findIndex(item => sourceKey(item) === sourceKey(record));
            if (index >= 0) {
                const saved = records[index];
                if (saved.status !== state.current.status || saved.updated !== state.current.updated) {
                    formStatus("This audit changed in another tab. Reopen it before saving.");
                    return false;
                }
                records[index] = record;
            } else records.push(record);
            window.NOVARA_LOCAL_STORAGE.setItem(state.key, JSON.stringify(records));
            state.current = record;
            return true;
        } catch {
            formStatus("The browser could not save this audit. Your entries are still on screen.");
            return false;
        }
    }

    function scoreOf(ratings) {
        const rated = ratings.filter(value => value === "pass" || value === "fail");
        return rated.length ? Math.round(rated.filter(value => value === "pass").length / rated.length * 100) : null;
    }

    function showRating() {
        const score = scoreOf([...byId("qaCriteria").querySelectorAll("select")].map(field => field.value));
        byId("qaScore").textContent = score === null ? "Unscored" : `${score}%${byId("qaCritical").checked ? " · Critical fail" : ""}`;
    }

    function row(title, subtitle, event, value, label) {
        return `<div class="qa-row"><div><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div><button type="button" data-${event}="${esc(value)}">${label}</button></div>`;
    }

    function showList(view = state.view, message = "", focus = false) {
        state.view = view;
        state.current = null;
        state.messages = [];
        state.reviewRequest++;
        const items = read();
        const drafts = items.filter(item => item.status === "draft");
        const actions = items.filter(item => item.status === "followup");
        const complete = items.filter(item => item.status === "complete");
        byId("qaDraftCount").textContent = drafts.length;
        byId("qaActionCount").textContent = actions.length;
        byId("qaCompletedCount").textContent = complete.length + actions.length;
        const visible = { queue: drafts, followup: actions, completed: [...complete, ...actions] }[view];
        const empty = { queue: "No audits in review. Start a new audit to select a case.", followup: "No open follow-ups.", completed: "Submitted audits will appear here." }[view];
        byId("qaList").innerHTML = [...visible].reverse().map(item => {
            const details = [scorecards[item.type].label, item.status === "draft" ? "Draft" : `${item.score}%`, item.critical ? "Critical error" : ""];
            if (item.status === "followup") details.push(item.action.owner, `Due ${item.action.due}${item.action.due < localDate() ? " · Overdue" : ""}`);
            if (item.status === "complete" && item.action) details.push("Follow-up verified");
            return row(item.title, details.filter(Boolean).join(" · "), "qa-audit", sourceKey(item), item.status === "draft" ? "Resume" : "Open");
        }).join("") || `<p class="qa-muted">${empty}</p>`;
        byId("qaList").hidden = false;
        byId("qaPicker").hidden = true;
        byId("qaReview").hidden = true;
        document.querySelectorAll("[data-qa-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.qaView === view)));
        notice(message);
        if (focus) document.querySelector(`[data-qa-view="${view}"]`)?.focus();
    }

    async function request(path) {
        const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Request failed");
        return response.json();
    }

    function candidates() {
        const query = byId("qaSearch").value.trim().toLowerCase();
        const higherRisk = byId("qaRisk").getAttribute("aria-pressed") === "true";
        const saved = new Set(read().map(sourceKey));
        return state.candidates.filter(item => !saved.has(sourceKey(item)) &&
            (!higherRisk || item.risk.length) && [item.title, item.topic, item.sourceId].some(value => value.toLowerCase().includes(query)));
    }

    function renderCandidates() {
        const matches = candidates();
        byId("qaSample").disabled = matches.length === 0;
        byId("qaCandidates").innerHTML = matches.map(item =>
            row(item.title, [item.topic, ...item.risk].filter(Boolean).join(" · "), "qa-candidate", sourceKey(item), "Review")
        ).join("");
        return matches.length;
    }

    async function loadCandidates() {
        const sequence = ++state.sourceRequest;
        const type = byId("qaType").value;
        state.candidates = [];
        renderCandidates();
        byId("qaCandidatesInfo").textContent = "Loading recent cases…";
        try {
            const rows = await request(type === "ai" ? "/conversations?limit=100&period=28" : "/tickets?limit=100&period=28");
            if (sequence !== state.sourceRequest) return;
            if (!Array.isArray(rows)) throw new Error("Unexpected case list");
            const items = new Map();
            for (const item of rows) {
                const sourceId = String((type === "ai" ? item.session_id : item.id) ?? "");
                if (!sourceId || items.has(sourceId)) continue;
                if (type === "handoff" && !(item.session_id || item.escalation_reason)) continue;
                const risk = [];
                if (item.status === "reopened") risk.push("Reopened");
                if (item.sentiment === "negative") risk.push("Negative sentiment");
                if (["urgent", "high"].includes(item.priority)) risk.push("High priority");
                if (item.resolution_status === "escalated") risk.push("Escalated");
                items.set(sourceId, {
                    type, sourceId, risk,
                    title: type === "ai" ? sourceId : (item.ticket_number || `NX-${sourceId.padStart(4, "0")}`),
                    topic: readable(item.subject || item.intent || item.channel)
                });
            }
            state.candidates = [...items.values()].slice(0, 100);
            updateCandidateCount();
        } catch {
            if (sequence === state.sourceRequest) byId("qaCandidatesInfo").textContent = "Could not load cases. Choose a scorecard or reopen New audit to retry.";
        }
    }

    function updateCandidateCount() {
        const count = renderCandidates();
        byId("qaCandidatesInfo").textContent = count ? `${count} available from recent cases` : "No matching cases available.";
    }

    function showPicker() {
        state.reviewRequest++;
        state.current = null;
        byId("qaList").hidden = true;
        byId("qaReview").hidden = true;
        byId("qaPicker").hidden = false;
        byId("qaSearch").value = "";
        byId("qaRisk").setAttribute("aria-pressed", "false");
        notice("");
        byId("qaPickerHeading").focus();
        loadCandidates();
    }

    function transcriptRows(data, type) {
        const messages = [];
        const append = (row, channel, who, content) => {
            if (!content) return;
            const date = row.created_at || row.timestamp || "";
            const reference = row.id ?? row.message_id ?? [date, messages.length];
            messages.push({ key: JSON.stringify([channel, who, reference]), channel, who, date, content });
        };
        const turns = Array.isArray(data) ? data : (data.conversation || data.logs || (type === "ai" ? data.messages : []));
        (Array.isArray(turns) ? turns : turns ? [turns] : []).forEach(turn => {
            append(turn, "AI conversation", "Customer", turn.user_message);
            append(turn, "AI conversation", "Novara AI", turn.bot_reply);
            if (type === "ai" && !turn.user_message && !turn.bot_reply) {
                append(turn, "AI conversation", (turn.sender_type || turn.sender) === "customer" ? "Customer" : "Support", turn.message);
            }
        });
        if (type !== "ai") (data.messages || []).forEach(message => {
            append(message, "Human conversation", message.sender_type === "customer" ? "Customer" : "Agent", message.message);
        });
        return messages;
    }

    function renderEvidence() {
        const evidence = state.evidence;
        byId("qaEvidence").innerHTML = evidence
            ? `<div class="qa-evidence"><span>Evidence · ${esc(evidence.label)}</span>${state.current.status === "draft" ? '<button type="button" id="qaRemoveEvidence">Remove</button>' : ""}</div>`
            : '<p class="qa-muted">Select a transcript message to attach evidence.</p>';
        document.querySelectorAll("[data-qa-transcript-index]").forEach(card => {
            const selected = state.messages[Number(card.dataset.qaTranscriptIndex)]?.key === evidence?.key;
            card.classList.toggle("qa-message-evidence", selected);
        });
        document.querySelectorAll("[data-qa-message]").forEach(button => {
            const selected = state.messages[Number(button.dataset.qaMessage)]?.key === evidence?.key;
            button.setAttribute("aria-pressed", String(selected));
            button.textContent = selected ? "Evidence attached" : "Use as evidence";
        });
    }

    async function loadTranscript() {
        const record = state.current;
        const sequence = ++state.reviewRequest;
        state.messages = [];
        const transcript = byId("qaTranscript");
        transcript.textContent = "Loading conversation…";
        byId("qaRetryTranscript").hidden = true;
        try {
            const encoded = encodeURIComponent(record.sourceId);
            const data = await request(record.type === "ai" ? `/conversation?session=${encoded}` : `/ticket-detail?id=${encoded}`);
            if (sequence !== state.reviewRequest) return;
            if (data.success === false || (record.type !== "ai" && String(data.ticket?.id) !== record.sourceId)) throw new Error("Conversation unavailable");
            state.messages = transcriptRows(data, record.type);
            transcript.innerHTML = state.messages.map((message, index) => `
                <div class="qa-message" data-qa-transcript-index="${index}"><strong>${esc(message.who)}</strong>
                    <p class="qa-muted">${esc(message.channel)} · ${esc(message.date ? ticketDateText(message.date) : `Message ${index + 1}`)}</p>
                    <div>${esc(message.content)}</div>
                    ${record.status === "draft" ? `<button type="button" data-qa-message="${index}" aria-pressed="false">Use as evidence</button>` : ""}
                </div>`).join("") || '<p class="qa-muted">There are no messages on this case.</p>';
            renderEvidence();
        } catch {
            if (sequence !== state.reviewRequest) return;
            transcript.textContent = "Could not load the conversation.";
            byId("qaRetryTranscript").hidden = false;
        }
    }

    function openAudit(record) {
        state.current = record;
        state.evidence = record.evidence || null;
        const editing = record.status === "draft";
        const card = scorecards[record.type];
        notice("");
        byId("qaList").hidden = true;
        byId("qaPicker").hidden = true;
        byId("qaReview").hidden = false;
        byId("qaReviewHeading").textContent = record.title;
        byId("qaReviewMeta").textContent = [card.label, { draft: "In review", followup: "Follow-up open", complete: "Completed" }[record.status], record.reviewer].filter(Boolean).join(" · ");
        byId("qaCriteria").innerHTML = card.criteria.map((name, index) => `<div class="qa-criterion">
            <label for="qaCriterion${index}">${name}</label><select id="qaCriterion${index}" data-native-select>${options}</select></div>`).join("");
        card.criteria.forEach((_, index) => { byId(`qaCriterion${index}`).value = record.ratings?.[index] || ""; });
        ["qaScores", "qaFindings", "qaAction"].forEach(id => { byId(id).disabled = !editing; });
        byId("qaCritical").checked = Boolean(record.critical);
        byId("qaNotes").value = record.notes || "";
        byId("qaActionType").value = record.action?.type || "";
        byId("qaActionFields").hidden = !record.action;
        byId("qaOwner").value = record.action?.owner || "";
        byId("qaDue").value = record.action?.due || "";
        byId("qaNextStep").value = record.action?.next || "";
        byId("qaSave").hidden = !editing;
        byId("qaSubmit").hidden = !editing;
        byId("qaVerify").hidden = record.status !== "followup" && !record.action?.outcome;
        byId("qaOutcome").value = record.action?.outcome || "";
        byId("qaOutcome").readOnly = record.status !== "followup";
        byId("qaCompleteAction").hidden = record.status !== "followup";
        formStatus("");
        showRating();
        renderEvidence();
        loadTranscript();
        byId("qaReviewHeading").focus();
    }

    function saveAudit(submit) {
        if (state.current?.status !== "draft") return;
        const ratings = [...byId("qaCriteria").querySelectorAll("select")].map(field => field.value);
        const score = scoreOf(ratings);
        const critical = byId("qaCritical").checked;
        const actionType = byId("qaActionType").value;
        const action = actionType ? { type: actionType, owner: byId("qaOwner").value.trim(), due: byId("qaDue").value, next: byId("qaNextStep").value.trim() } : null;
        if (submit) {
            if (!state.messages.length) return formStatus("Load and review the conversation before submitting.");
            if (ratings.some(value => !scoreValues.includes(value)) || score === null) return formStatus("Rate every criterion and score at least one as meeting or missing the standard.");
            if (critical && (!action || !state.messages.some(message => message.key === state.evidence?.key))) return formStatus("A critical error needs evidence from this transcript and a follow-up action.");
            if (action && !(action.owner && action.due && action.next)) return formStatus("Add an owner, due date, and next step for the follow-up.");
        }
        const status = submit ? (action ? "followup" : "complete") : "draft";
        const saved = persist({ ...state.current, ratings, score, critical, action, status, evidence: state.evidence, notes: byId("qaNotes").value.trim(), updated: new Date().toISOString() });
        if (!saved) return;
        if (submit) showList(action ? "followup" : "completed", action ? "Audit submitted. Follow-up added." : "Audit submitted.", true);
        else formStatus("Draft saved.");
    }

    function startAudit(item) {
        const existing = read().find(saved => sourceKey(saved) === sourceKey(item));
        openAudit(existing || { ...item, status: "draft", reviewer: state.reviewer });
    }

    function completeFollowup() {
        if (state.current?.status !== "followup") return;
        const outcome = byId("qaOutcome").value.trim();
        if (!outcome) return formStatus("Record how you verified the fix.");
        if (persist({ ...state.current, status: "complete", updated: new Date().toISOString(), action: { ...state.current.action, outcome } })) {
            showList("completed", "Follow-up completed.", true);
        }
    }

    byId("qaBoard").addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button || !state.key) return;
        const { qaView, qaAudit, qaCandidate, qaMessage } = button.dataset;
        if (qaView || button.hasAttribute("data-qa-close")) showList(qaView || state.view, "", true);
        else if (qaAudit) {
            const saved = read().find(item => sourceKey(item) === qaAudit);
            if (saved) openAudit(saved);
        } else if (qaCandidate) {
            const item = state.candidates.find(candidate => sourceKey(candidate) === qaCandidate);
            if (item) startAudit(item);
        } else if (qaMessage !== undefined && state.current?.status === "draft") {
            const message = state.messages[Number(qaMessage)];
            state.evidence = { key: message.key, label: [message.channel, message.who, message.date ? ticketDateText(message.date) : `Message ${Number(qaMessage) + 1}`].join(" · ") };
            renderEvidence();
        } else if (button.id === "qaRemoveEvidence") {
            state.evidence = null;
            renderEvidence();
            byId("qaNotes").focus();
        }
    });
    byId("qaNewAudit").addEventListener("click", () => { if (state.key) showPicker(); });
    byId("qaType").addEventListener("change", loadCandidates);
    byId("qaSearch").addEventListener("input", updateCandidateCount);
    byId("qaRisk").addEventListener("click", event => {
        const element = event.currentTarget;
        element.setAttribute("aria-pressed", String(element.getAttribute("aria-pressed") !== "true"));
        updateCandidateCount();
    });
    byId("qaSample").addEventListener("click", () => {
        const available = candidates();
        if (available.length) startAudit(available[Math.floor(Math.random() * available.length)]);
    });
    byId("qaForm").addEventListener("submit", event => { event.preventDefault(); saveAudit(true); });
    byId("qaSave").addEventListener("click", () => saveAudit(false));
    byId("qaRetryTranscript").addEventListener("click", loadTranscript);
    byId("qaCompleteAction").addEventListener("click", completeFollowup);
    byId("qaCriteria").addEventListener("change", showRating);
    byId("qaCritical").addEventListener("change", showRating);
    byId("qaActionType").addEventListener("change", event => { byId("qaActionFields").hidden = !event.target.value; });

    window.NovaraQA = {
        initialize(user) {
            const identity = String(user?.email || user?.id || "").trim().toLowerCase();
            if (!identity) return;
            state.key = `novaradesk_qa_v1:${JSON.stringify([user.workspace_id || "", identity])}`;
            state.reviewer = user.name || user.email || "Reviewer";
            if (window.NOVARA_DEMO_MODE) byId("qaStorageNote").textContent = "Preview audits reset when you leave or reload the preview.";
            if (currentTab === "qa") this.activate();
        },
        activate() {
            if (state.key && !state.current && byId("qaPicker").hidden) showList();
        },
        fromTicket(ticket) {
            if (!state.key || !ticket?.id) return;
            showWorkspace("qa");
            startAudit({ type: "human", sourceId: String(ticket.id), title: ticket.ticket_number || `NX-${String(ticket.id).padStart(4, "0")}`, topic: readable(ticket.subject || ticket.intent) });
        }
    };
})();
