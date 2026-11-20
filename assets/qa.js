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
    const state = { key: "", candidates: [], sourceRequest: 0, reviewRequest: 0, current: null, messages: [], evidence: null, view: "history", historyKey: null };
    const esc = value => escapeHtml(String(value ?? ""));
    const readable = value => String(value || "").replaceAll("_", " ");
    const sourceKey = item => JSON.stringify([item.type, item.sourceId]);
    const formStatus = message => { byId("qaFormStatus").textContent = message; };

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
        const ratings = [...byId("qaCriteria").querySelectorAll("select")].map(field => field.value);
        const score = scoreOf(ratings);
        const rated = ratings.filter(value => scoreValues.includes(value)).length;
        const critical = byId("qaCritical").checked;
        const badge = byId("qaScore");
        const displayScore = score === null ? "" : `${score / 10}/10`;
        badge.textContent = [displayScore, critical && "Critical fail"].filter(Boolean).join(" · ") || "Unscored";
        badge.classList.toggle("qa-score-critical", critical);
        badge.classList.toggle("qa-score-unscored", score === null && !critical);
        const progress = byId("qaRatingProgress");
        progress.max = ratings.length || 1;
        progress.value = rated;
        byId("qaRatedCount").textContent = `${rated} of ${ratings.length} criteria rated`;
    }

    function conversationTopic(item) {
        return item.topic ? item.topic.charAt(0).toUpperCase() + item.topic.slice(1) : "";
    }

    function conversationTitle(item) {
        return item.customer || conversationTopic(item) || "AI conversation";
    }

    function conversationCard(item) {
        const key = sourceKey(item);
        const selected = state.current && sourceKey(state.current) === key;
        const heading = conversationTitle(item);
        const summary = [item.customer ? conversationTopic(item) : "", ...item.risk].filter(Boolean).join(" · ");
        return `<button type="button" class="ticket-queue-card qa-ai-card${selected ? " active" : ""}" data-qa-candidate="${esc(key)}" aria-controls="qaReview" aria-pressed="${Boolean(selected)}" title="${esc(item.sourceId)}">
            <span class="qa-card-head"><strong>${esc(heading)}</strong><span class="qa-ai-label">AI chat</span></span>
            ${summary ? `<span class="ticket-queue-card-query">${esc(summary)}</span>` : ""}
        </button>`;
    }

    function showTools(tab, focus = false) {
        const settings = tab === "settings";
        byId("qaScoringPanel").hidden = settings;
        byId("qaSettingsPanel").hidden = !settings;
        [byId("qaScoringTab"), byId("qaSettingsTab")].forEach((button, index) => {
            const active = index === Number(settings);
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
            if (active && focus) button.focus();
        });
    }

    function configuredCriteria(type) {
        try {
            const saved = JSON.parse(window.NOVARA_LOCAL_STORAGE.getItem(`${state.key}:criteria:${type}`) || "null");
            if (Array.isArray(saved) && saved.length && saved.every(item => typeof item === "string" && item.trim())) return saved;
        } catch { /* Use defaults when settings cannot be read. */ }
        return scorecards[type].criteria;
    }

    function loadCriteriaSettings() {
        const type = byId("qaSettingsType").value;
        byId("qaSettingsCriteria").value = configuredCriteria(type).join("\n");
        byId("qaSettingsStatus").textContent = "";
    }

    function saveCriteria(event) {
        event.preventDefault();
        if (!state.key) return;
        const type = byId("qaSettingsType").value;
        const criteria = byId("qaSettingsCriteria").value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        const status = byId("qaSettingsStatus");
        if (!criteria.length || new Set(criteria.map(item => item.toLowerCase())).size !== criteria.length) {
            status.textContent = "Enter at least one criterion and remove duplicates.";
            return;
        }
        try {
            window.NOVARA_LOCAL_STORAGE.setItem(`${state.key}:criteria:${type}`, JSON.stringify(criteria));
            status.textContent = "Criteria saved.";
            if (state.current?.type === type && !state.current.updated) {
                const values = [...byId("qaCriteria").querySelectorAll("select")].map(field => field.value);
                const ratings = new Map(state.current.criteria.map((name, index) => [name, values[index]]));
                state.current.criteria = criteria;
                renderCriteria(criteria, criteria.map(name => ratings.get(name)));
                showRating();
            }
        } catch {
            status.textContent = "Could not save criteria.";
        }
    }

    function renderCriteria(criteria, ratings = []) {
        const container = byId("qaCriteria");
        for (const select of container.querySelectorAll("select")) {
            const instance = select._unifiedSelect;
            if (instance) {
                closeUnifiedSelect(instance);
                instance.menu.remove();
            }
        }
        container.innerHTML = criteria.map((name, index) => `<div class="qa-criterion">
            <label for="qaCriterion${index}">${esc(name)}</label><select id="qaCriterion${index}" aria-label="${esc(name)}">${options}</select></div>`).join("");
        criteria.forEach((_, index) => { byId(`qaCriterion${index}`).value = ratings[index] || ""; });
    }

    function selectRow(key) {
        byId("qaBoard").querySelectorAll("[data-qa-candidate]").forEach(button => {
            const selected = button.dataset.qaCandidate === key;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
    }

    function closeDetail() {
        const key = state.current && sourceKey(state.current);
        state.current = null;
        state.messages = [];
        state.reviewRequest++;
        byId("qaReview").hidden = true;
        byId("qaForm").hidden = true;
        byId("qaEmptyScore").hidden = false;
        byId("qaEmptyDetail").hidden = false;
        selectRow(null);
        return key;
    }

    async function request(path) {
        const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Request failed");
        return response.json();
    }

    function candidates() {
        const query = byId("qaSearch").value.trim().toLowerCase();
        const view = byId("qaTicketView").value;
        return state.candidates.filter(item => (view === "all" || (view === "needs_reply" ? item.needsReply : view === `status:${item.status}`)) &&
            [item.title, item.topic, item.sourceId, item.customer].some(value => String(value ?? "").toLowerCase().includes(query)));
    }

    function renderCandidates() {
        const matches = candidates();
        byId("qaCandidates").innerHTML = matches.map(item => {
            if (item.ticket) {
                const key = sourceKey(item);
                const selected = Boolean(state.current && sourceKey(state.current) === key);
                return renderTicketQueueCard(item.ticket, selected, `data-qa-candidate="${esc(key)}" aria-controls="qaReview" aria-pressed="${selected}"`);
            }
            return conversationCard(item);
        }).join("");
        return matches.length;
    }

    async function loadCandidates(autoSelect = true) {
        const sequence = ++state.sourceRequest;
        const type = byId("qaType").value;
        state.candidates = [];
        renderCandidates();
        byId("qaCandidatesInfo").textContent = "Loading recent cases…";
        try {
            const types = type === "both" ? ["human", "ai"] : [type];
            const lists = await Promise.allSettled(types.map(async source => {
                const endpoint = source === "ai" ? "conversations" : "tickets";
                const data = await request(`/${endpoint}?limit=100&period=28`);
                const rows = Array.isArray(data) ? data : data?.[endpoint];
                if (!Array.isArray(rows)) throw new Error("Unexpected case list");
                return rows.map(item => ({ item, type: source }));
            }));
            if (sequence !== state.sourceRequest) return;
            const available = lists.filter(result => result.status === "fulfilled");
            if (!available.length) throw new Error("No case sources loaded");
            const items = new Map();
            for (const { item, type } of available.flatMap(result => result.value)) {
                const sourceId = String((type === "ai" ? item.session_id : item.id) ?? "");
                const key = sourceKey({ type, sourceId });
                if (!sourceId || items.has(key)) continue;
                const risk = [];
                if (item.status === "reopened") risk.push("Reopened");
                if (item.sentiment === "negative") risk.push("Negative sentiment");
                if (["urgent", "high"].includes(item.priority)) risk.push("High priority");
                if (item.resolution_status === "escalated") risk.push("Escalated");
                const ticket = type === "human" ? normalizeTicket(item, items.size) : null;
                const status = ticket?.status || (["resolved", "closed"].includes(String(item.resolution_status).toLowerCase()) ? "resolved" : "open");
                items.set(key, {
                    ticket, status, needsReply: Boolean(ticket?.needsReply),
                    type, sourceId, risk,
                    title: type === "ai" ? sourceId : (item.ticket_number || `NX-${sourceId.padStart(4, "0")}`),
                    topic: readable(item.customer_query || item.subject || item.intent || item.channel),
                    customer: item.customer_name,
                    date: item.created_at || item.started_at || ""
                });
            }
            state.candidates = [...items.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
            updateCandidateCount();
            if (available.length < types.length) byId("qaCandidatesInfo").textContent += " · One case source could not load.";
            const first = candidates()[0];
            if (autoSelect && first && !state.current) startAudit(first, false);
        } catch {
            if (sequence === state.sourceRequest) byId("qaCandidatesInfo").textContent = "Could not load cases. Use Refresh to try again.";
        }
    }

    function updateCandidateCount() {
        const count = renderCandidates();
        byId("qaCandidatesInfo").textContent = count ? `${count} available from recent cases` : "No matching cases available.";
    }

    function showPicker(autoSelect = true) {
        closeDetail();
        byId("qaPicker").hidden = false;
        byId("qaSearch").value = "";
        loadCandidates(autoSelect);
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

    const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

    function renderTicketContext(ticket) {
        const context = byId("qaTicketContext");
        const status = byId("qaTicketStatus");
        context.hidden = !ticket;
        byId("qaTicketMeta").hidden = !ticket;
        byId("qaResponseMeta").hidden = !ticket;
        status.hidden = !ticket?.status;
        if (!ticket) return;
        const details = normalizeTicket(ticket, 0);
        status.textContent = ticketStatusLabel(details.status);
        status.className = `ticket-queue-status ${ticketStatusClass(details.status)}`;
        byId("qaAssignedAgent").textContent = details.agent;
        byId("qaAssigneeAvatar").textContent = initials(details.agent);
        const response = byId("qaFirstResponse");
        response.textContent = details.firstResponseAt ? "Complete" : "Pending";
        response.classList.toggle("pending", !details.firstResponseAt);
        const sla = ticketSlaDisplay(details);
        byId("qaSlaState").textContent = sla.label;
        byId("qaSlaState").dataset.state = ["SLA not set", "SLA unavailable"].includes(sla.label) ? "unset" : sla.className;
        const item = (label, value) => `<div class="ticket-context-item"><span>${label}</span>${esc(value || "—")}</div>`;
        byId("qaTicketCustomer").textContent = ticket.customer_name || "";
        byId("qaTicketFields").innerHTML = `
            <div class="ticket-context-section identity">
                ${item("Customer name", ticket.customer_name)}
                ${item("Phone number", ticket.customer_phone)}
                ${item("Created date", ticketDatePart(ticket.created_at))}
                ${item("Created time", ticketTimePart(ticket.created_at))}
                ${item("First response time", formatTicketElapsed(ticket.created_at, ticket.first_response_at, "Awaiting response"))}
                ${item("Resolution time", formatTicketElapsed(ticket.created_at, ticket.resolved_at, "In progress"))}
            </div>
            <div class="ticket-context-section case">
                ${item("Original query", ticket.customer_query)}
                ${item("Escalation reason", readable(ticket.escalation_reason))}
                ${item("Sentiment", ticket.sentiment)}
            </div>`;
    }

    function selectChannel(channel) {
        byId("qaChannelSwitch").querySelectorAll("[data-qa-channel]").forEach(tab => {
            const active = tab.dataset.qaChannel === channel;
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
            byId(tab.getAttribute("aria-controls")).hidden = !active;
        });
    }

    function renderActivity(data, message) {
        const targets = {
            history: byId("qaHistoryTimeline"), historyCount: byId("qaHistoryCount"),
            calls: byId("qaCallRows"), callCount: byId("qaCallCount")
        };
        targets.historyCount.textContent = "";
        targets.callCount.textContent = "";
        if (data?.ticket) {
            window.renderQaTicketActivity?.(data, targets);
        } else {
            targets.history.textContent = message;
            targets.calls.innerHTML = `<tr><td colspan="8">${esc(message)}</td></tr>`;
        }
    }

    async function loadTranscript() {
        const record = state.current;
        const sequence = ++state.reviewRequest;
        state.messages = [];
        const transcript = byId("qaTranscript");
        renderTicketContext(null);
        renderActivity(null, "Loading case activity…");
        byId("qaMessageCount").textContent = "";
        transcript.textContent = "Loading conversation…";
        byId("qaRetryTranscript").hidden = true;
        try {
            const encoded = encodeURIComponent(record.sourceId);
            const data = await request(record.type === "ai" ? `/conversation?session=${encoded}` : `/ticket-detail?id=${encoded}`);
            if (sequence !== state.reviewRequest) return;
            if (data.success === false || (record.type !== "ai" && String(data.ticket?.id) !== record.sourceId)) throw new Error("Conversation unavailable");
            renderTicketContext(record.type === "ai" ? null : data.ticket);
            renderActivity(record.type === "ai" ? null : data, "No ticket activity for this standalone AI chat.");
            state.messages = transcriptRows(data, record.type);
            const count = state.messages.length;
            byId("qaMessageCount").textContent = count ? `${count} ${count === 1 ? "message" : "messages"}` : "";
            transcript.innerHTML = state.messages.map((message, index) => `
                <article class="qa-message${message.who === "Customer" ? "" : " qa-message-support"}" data-qa-transcript-index="${index}">
                    <header><strong>${esc(message.who)}</strong><span>${esc(message.channel)} · ${esc(message.date ? ticketDateText(message.date) : `Message ${index + 1}`)}</span></header>
                    <div class="qa-message-text">${renderSafeMarkdown(String(message.content ?? ""))}</div>
                    ${record.status === "draft" ? `<button type="button" data-qa-message="${index}" aria-pressed="false">Use as evidence</button>` : ""}
                </article>`).join("") || '<p class="qa-muted">There are no messages on this case.</p>';
            renderEvidence();
        } catch {
            if (sequence !== state.reviewRequest) return;
            transcript.textContent = "Could not load the conversation.";
            renderActivity(null, "Could not load case activity. Retry from Chat.");
            byId("qaRetryTranscript").hidden = false;
        }
    }

    function openAudit(record, focus = true) {
        if (!state.current || sourceKey(state.current) !== sourceKey(record)) {
            selectChannel("chat");
            byId("qaTicketContext").open = false;
            byId("qaScoringPanel").scrollTop = 0;
        }
        state.current = { ...record, criteria: record.criteria || scorecards[record.type].criteria };
        state.evidence = record.evidence || null;
        const editing = record.status === "draft";
        const card = scorecards[record.type];
        byId("qaReview").hidden = false;
        byId("qaEmptyDetail").hidden = true;
        byId("qaReview").querySelector(".qa-review-body").scrollTop = 0;
        selectRow(sourceKey(record));
        byId("qaForm").hidden = false;
        byId("qaEmptyScore").hidden = true;
        byId("qaScorecardTitle").textContent = card.label;
        if (focus) showTools("scoring");
        byId("qaReviewHeading").textContent = record.type === "ai" ? conversationTitle(record) : record.title;
        byId("qaCaseCopy").dataset.copyTicketNumber = record.title;
        byId("qaCaseCopy").hidden = record.type === "ai";
        const statusLabel = { draft: "In review", followup: "Follow-up open", complete: "Completed" }[record.status];
        byId("qaAuditStatus").textContent = statusLabel;
        byId("qaAuditorName").textContent = record.reviewer || "";
        byId("qaAuditorAvatar").textContent = initials(record.reviewer || "");
        byId("qaAuditedBy").hidden = !record.reviewer;
        byId("qaReviewMeta").textContent = [card.label, record.type === "ai" ? record.sourceId : statusLabel].filter(Boolean).join(" · ");
        renderCriteria(state.current.criteria, record.ratings);
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
        if (focus) byId("qaReviewHeading").focus();
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
        const updated = new Date().toISOString();
        const saved = persist({ ...state.current, ratings, score, critical, action, status, evidence: state.evidence, notes: byId("qaNotes").value.trim(), updated, ...(submit ? { submittedAt: updated } : {}) });
        if (!saved) return;
        if (submit) {
            openAudit(state.current, false);
            formStatus(action ? "Audit submitted. Follow-up added." : "Audit submitted.");
        }
        else formStatus("Draft saved.");
    }

    function startAudit(item, focus = true) {
        if (state.current && sourceKey(state.current) === sourceKey(item)) return;
        const existing = read().find(saved => sourceKey(saved) === sourceKey(item));
        const { type, sourceId, title, topic, customer } = item;
        openAudit(existing || { type, sourceId, title, topic, customer, status: "draft", reviewer: state.reviewer, criteria: configuredCriteria(type) }, focus);
    }

    function completeFollowup() {
        if (state.current?.status !== "followup") return;
        const outcome = byId("qaOutcome").value.trim();
        if (!outcome) return formStatus("Record how you verified the fix.");
        if (persist({ ...state.current, status: "complete", submittedAt: auditDate(state.current), updated: new Date().toISOString(), action: { ...state.current.action, outcome } })) {
            openAudit(state.current, false);
            formStatus("Follow-up completed.");
        }
    }

    const channelSwitch = byId("qaChannelSwitch");
    channelSwitch.addEventListener("click", event => {
        const tab = event.target.closest("[data-qa-channel]");
        if (tab) selectChannel(tab.dataset.qaChannel);
    });
    channelSwitch.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...channelSwitch.querySelectorAll("[data-qa-channel]")];
        const index = tabs.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
            (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectChannel(tabs[next].dataset.qaChannel);
        tabs[next].focus();
    });

    byId("qaBoard").addEventListener("click", event => {
        const copy = event.target.closest("[data-copy-ticket-number]");
        if (copy) { copyTicketQueueNumber(copy); return; }
        const button = event.target.closest("button, [data-qa-candidate]");
        if (!button || !state.key) return;
        const { qaMessage } = button.dataset;
        if (button.hasAttribute("data-qa-close-detail")) {
            const key = closeDetail();
            const source = [...byId("qaBoard").querySelectorAll("[data-qa-candidate]")].find(row => row.dataset.qaCandidate === key);
            (source || byId("qaTicketView")).focus();
        } else if (button.id === "qaScoringTab" || button.id === "qaSettingsTab") {
            showTools(button.id === "qaSettingsTab" ? "settings" : "scoring");
        } else if (button.dataset.qaCandidate) {
            const item = state.candidates.find(candidate => sourceKey(candidate) === button.dataset.qaCandidate);
            if (item) startAudit(item);
        } else if (qaMessage !== undefined && state.current?.status === "draft") {
            const message = state.messages[Number(qaMessage)];
            state.evidence = { key: message.key, label: [message.channel, message.who, message.date ? ticketDateText(message.date) : `Message ${Number(qaMessage) + 1}`].join(" · ") };
            showTools("scoring");
            renderEvidence();
            byId("qaNotes").focus();
        } else if (button.id === "qaRemoveEvidence") {
            state.evidence = null;
            renderEvidence();
            byId("qaNotes").focus();
        }
    });
    byId("qaCandidates").addEventListener("keydown", event => {
        if (event.target.matches('[role="button"][data-qa-candidate]') && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.target.click();
        }
    });
    byId("qaTicketView").addEventListener("change", () => {
        closeDetail();
        updateCandidateCount();
        const first = candidates()[0];
        if (first) startAudit(first, false);
    });
    byId("qaType").addEventListener("change", () => { closeDetail(); loadCandidates(); });
    byId("qaSettingsForm").addEventListener("submit", saveCriteria);
    byId("qaSettingsType").addEventListener("change", loadCriteriaSettings);
    byId("qaScoringTab").parentElement.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const settings = event.key === "End" || (event.key !== "Home" && event.target.id === "qaScoringTab");
        showTools(settings ? "settings" : "scoring", true);
    });
    byId("qaSearch").addEventListener("input", updateCandidateCount);
    byId("qaForm").addEventListener("submit", event => { event.preventDefault(); saveAudit(true); });
    byId("qaSave").addEventListener("click", () => saveAudit(false));
    byId("qaRetryTranscript").addEventListener("click", loadTranscript);
    byId("qaCompleteAction").addEventListener("click", completeFollowup);
    byId("qaCriteria").addEventListener("change", showRating);
    byId("qaCritical").addEventListener("change", showRating);
    byId("qaActionType").addEventListener("change", event => { byId("qaActionFields").hidden = !event.target.value; });

    const viewTabs = [byId("qaHistoryTab"), byId("qaQueueTab")];
    const auditDate = record => record.submittedAt || record.updated;
    const auditScore = record => Number.isFinite(record.score) ? `${record.score / 10}/10` : "—";
    const auditLabel = record => record.title || record.sourceId;
    const followupLabel = record => record.status === "followup" ? "Open" : record.action ? "Completed" : "No follow-up";

    const demoAudits = window.NOVARA_DEMO_MODE ? [
        [0, "human", "Meera Joshi", "Duplicate payment", "Anika Rao", 4, "open"],
        [1, "ai", "Aarav Shah", "Order tracking", "Kabir Sen", 5],
        [2, "human", "Ishaan Verma", "Delivery address change", "Anika Rao", 5],
        [3, "handoff", "Diya Patel", "Refund escalation", "Kabir Sen", 3, "completed"],
        [4, "ai", "Sana Gupta", "Return eligibility", "Kabir Sen", 4, "open"],
        [5, "human", "Veer Nair", "Damaged item", "Anika Rao", 4],
        [6, "human", "Aditi Singh", "Subscription upgrade", "Anika Rao", 5],
        [8, "ai", "Nikhil Rao", "Invoice copy", "Kabir Sen", 5],
        [10, "human", "Tara Bose", "Replacement delivery", "Anika Rao", 3, "open"],
        [12, "ai", "Riya Das", "Warranty coverage", "Kabir Sen", 4],
        [18, "human", "Neil Sethi", "Payment method update", "Anika Rao", 5],
        [35, "ai", "Ana Kapoor", "Cancellation window", "Kabir Sen", 4]
    ].map(([age, type, customer, topic, reviewer, passed, followup], index) => {
        const sourceId = `sample-audit-${index + 1}`;
        return {
            sourceId, title: type === "ai" ? `AI-DEMO-${101 + index}` : `NX-DEMO-${101 + index}`,
            type, customer, topic, reviewer,
            submittedAt: new Date(Date.now() - age * 86400000).toISOString(),
            status: followup === "open" ? "followup" : "complete",
            score: passed * 20, criteria: scorecards[type].criteria,
            ratings: scorecards[type].criteria.map((_, index) => index < passed ? "pass" : "fail"),
            notes: passed === 5 ? "The response met every criterion on the scorecard." : "Review the criteria marked as missing the standard.",
            action: followup ? {
                type: "Process fix", owner: "QA team", next: "Review the missed criteria and update the response checklist.",
                outcome: followup === "completed" ? "Verified the updated checklist against a sample conversation." : ""
            } : null
        };
    }) : [];

    function submittedAudits() {
        return [...demoAudits, ...(state.key ? read() : []).filter(record => ["complete", "followup"].includes(record.status))];
    }

    let historyPeriod = 14;
    let historyRange = null;
    const historyView = byId("qaHistoryViewSelect");
    const historyColumns = [...byId("qaAuditHistoryView").querySelectorAll("[data-qa-history-column]")];
    const followupKey = record => record.status === "followup" ? "open" : record.action ? "completed" : "none";
    const matchesView = (record, view) => view === "all" || record.type === view || followupKey(record) === view;

    function historyColumnValues(record) {
        return [auditLabel(record), ticketDateText(auditDate(record)), [record.customer, record.topic].filter(Boolean).join(" · "),
            record.reviewer, scorecards[record.type]?.label, followupLabel(record), auditScore(record)];
    }

    function renderHistoryMetrics(records) {
        const scored = records.filter(record => Number.isFinite(record.score));
        byId("qaAuditHistoryView").querySelectorAll("[data-qa-history-value]").forEach(metric => {
            const key = metric.dataset.qaHistoryValue;
            metric.textContent = key === "average"
                ? (scored.length ? `${(scored.reduce((total, record) => total + record.score, 0) / scored.length / 10).toFixed(1)}/10` : "—")
                : records.filter(record => matchesView(record, key)).length;
        });
        byId("qaAuditHistoryView").querySelectorAll("[data-qa-history-metric]").forEach(metric => {
            const active = historyView.value === metric.dataset.qaHistoryMetric;
            metric.classList.toggle("active", active);
            metric.setAttribute("aria-pressed", String(active));
        });
    }

    function renderAuditDetail(record) {
        byId("qaHistoryList").hidden = true;
        byId("qaHistoryDetail").hidden = false;
        byId("qaHistoryDetailTitle").textContent = auditLabel(record);
        const criteria = record.criteria || scorecards[record.type]?.criteria || [];
        const ratingLabels = { pass: "Meets standard", fail: "Misses standard", na: "Not applicable" };
        byId("qaHistoryDetailBody").innerHTML = `
            <p class="qa-muted">${esc([record.customer, scorecards[record.type]?.label, ticketDateText(auditDate(record)), record.reviewer].filter(Boolean).join(" · "))}</p>
            ${record.topic ? `<p>${esc(record.topic)}</p>` : ""}
            <h3>Scorecard <span class="qa-history-chip">${auditScore(record)}</span></h3>
            <dl>${criteria.map((criterion, index) => `<div><dt>${esc(criterion)}</dt><dd>${ratingLabels[record.ratings?.[index]] || "—"}</dd></div>`).join("")}</dl>
            <h3>Findings</h3>
            <p>${record.critical ? "Critical error flagged" : "No critical error flagged"}</p>
            ${record.evidence?.label ? `<p class="qa-muted">Evidence · ${esc(record.evidence.label)}</p>` : ""}
            ${record.notes ? `<p class="qa-history-note">${esc(record.notes)}</p>` : ""}
            <h3>Follow-up <span class="qa-history-chip">${followupLabel(record)}</span></h3>
            ${record.action ? `<p>${esc([record.action.type, record.action.owner, record.action.due].filter(Boolean).join(" · "))}</p>
                <p class="qa-history-note">${esc(record.action.next)}</p>
                ${record.action.outcome ? `<p class="qa-history-note">Verification · ${esc(record.action.outcome)}</p>` : ""}` : ""}`;
    }

    function renderAuditHistory() {
        const records = submittedAudits();
        const selected = records.find(record => sourceKey(record) === state.historyKey);
        if (selected) return renderAuditDetail(selected);
        state.historyKey = null;
        byId("qaHistoryList").hidden = false;
        byId("qaHistoryDetail").hidden = true;
        const type = byId("qaHistoryType").value;
        const query = byId("qaHistorySearch").value.trim().toLowerCase();
        const filters = historyColumns.map(input => input.value.trim().toLowerCase());
        const filterCount = Number(Boolean(type)) + Number(Boolean(query)) + filters.filter(Boolean).length;
        byId("qaHistoryFilterCount").hidden = !filterCount;
        byId("qaHistoryFilterCount").textContent = filterCount;
        historyColumns.forEach((input, index) => input.closest("details").classList.toggle("filtered", Boolean(filters[index])));
        const start = recordDateInIst(new Date(Date.now() - (historyPeriod - 1) * 86400000));
        const periodRecords = records.filter(record => {
            const date = recordDateInIst(auditDate(record));
            const terms = [auditLabel(record), record.sourceId, record.customer, record.topic, record.reviewer];
            return (!date || (historyRange ? date >= historyRange.start && date <= historyRange.end : date >= start)) &&
                (!type || record.type === type) &&
                terms.some(value => String(value ?? "").toLowerCase().includes(query)) &&
                historyColumnValues(record).every((value, index) => String(value ?? "").toLowerCase().includes(filters[index]));
        });
        renderHistoryMetrics(periodRecords);
        const matches = periodRecords.filter(record => matchesView(record, historyView.value))
            .sort((a, b) => (Date.parse(auditDate(b)) || 0) - (Date.parse(auditDate(a)) || 0));
        byId("qaAuditRows").innerHTML = matches.map(record => {
            const followup = followupKey(record);
            const topic = record.topic || "—";
            const shortTopic = topic.length > 52 ? `${topic.slice(0, 52)}…` : topic;
            return `
                <tr><td><button type="button" class="ticket-id" data-qa-history-key="${esc(sourceKey(record))}">${esc(auditLabel(record))}</button></td>
                <td>${formatTicketDate(auditDate(record))}</td>
                <td class="query" title="${esc(topic)}"><span class="ticket-customer">${esc(record.customer || "—")}</span><br><span>${esc(shortTopic)}</span></td>
                <td><span class="ticket-assignee">${esc(record.reviewer || "—")}</span></td>
                <td><span class="ticket-age">${esc(scorecards[record.type]?.label || "—")}</span></td>
                <td><span class="ticket-badge ${followup === "open" ? "open" : followup === "completed" ? "resolved" : ""}">${followupLabel(record)}</span></td>
                <td><span class="sla-badge met">${auditScore(record)}</span></td></tr>`;
        }).join("");
        byId("qaHistoryEmpty").hidden = matches.length > 0;
        byId("qaHistoryEmptyTitle").textContent = records.length ? "No matching audits" : "No submitted audits yet";
        byId("qaHistoryEmptyMessage").textContent = records.length ? "Try a different date range, view, or filter." : "Audits appear here after you submit them from Open Audits.";
    }

    function showAuditView(view) {
        state.view = view;
        const history = view === "history";
        document.body.classList.toggle("qa-open-audits", !history);
        viewTabs.forEach((tab, index) => {
            const active = (index === 0) === history;
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        byId("qaQueueView").hidden = history;
        byId("qaAuditHistoryView").hidden = !history;
        if (history) renderAuditHistory();
        else {
            closeHistoryPopovers();
            if (state.key && byId("qaPicker").hidden) showPicker();
        }
    }

    viewTabs.forEach((tab, index) => tab.addEventListener("click", () => showAuditView(index === 0 ? "history" : "queue")));
    byId("qaViewSwitch").addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - viewTabs.indexOf(event.target);
        viewTabs[next].click();
        viewTabs[next].focus();
    });
    const historyFilterToggle = byId("qaHistoryFilterToggle");
    const historyDatePopover = byId("qaHistoryCustomDatePopover");
    const customDateButton = byId("qaHistoryCustomDateBtn");
    const historyPeriodButtons = [...byId("qaHistoryPeriodSelector").querySelectorAll("[data-qa-history-period]")];
    function updateHistoryPeriod() {
        historyDatePopover.hidden = true;
        historyPeriodButtons.forEach(button => {
            const active = !historyRange && Number(button.dataset.qaHistoryPeriod) === historyPeriod;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        customDateButton.classList.toggle("active", Boolean(historyRange));
        customDateButton.setAttribute("aria-expanded", "false");
        renderAuditHistory();
    }

    historyView.addEventListener("change", renderAuditHistory);
    byId("qaAuditHistoryView").querySelectorAll("[data-qa-history-metric]").forEach(metric => metric.addEventListener("click", () => {
        historyView.value = metric.dataset.qaHistoryMetric;
        historyView.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    historyFilterToggle.addEventListener("click", () => {
        const panel = byId("qaHistoryFilterPanel");
        panel.hidden = !panel.hidden;
        historyFilterToggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    byId("qaHistoryClearFilters").addEventListener("click", () => {
        byId("qaHistorySearch").value = "";
        byId("qaHistoryType").value = "";
        byId("qaHistoryType").dispatchEvent(new Event("change", { bubbles: true }));
        historyColumns.forEach(input => { input.value = ""; });
        renderAuditHistory();
    });
    historyColumns.forEach(input => {
        input.addEventListener("input", renderAuditHistory);
        const details = input.closest("details");
        const panel = input.parentElement;
        panel.setAttribute("popover", "manual");
        details.addEventListener("toggle", () => {
            if (!details.open) {
                panel.hidePopover();
                return;
            }
            historyColumns.forEach(other => { if (other !== input) other.closest("details").open = false; });
            const box = details.getBoundingClientRect();
            panel.style.top = `${box.bottom + 6}px`;
            panel.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 248))}px`;
            panel.showPopover();
            input.focus();
        });
        document.addEventListener("click", event => {
            if (details.open && !details.contains(event.target)) details.open = false;
        });
        details.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                details.open = false;
                details.querySelector("summary").focus();
            }
        });
    });
    function closeHistoryPopovers() {
        historyColumns.forEach(input => { input.closest("details").open = false; });
        historyDatePopover.hidden = true;
        customDateButton.setAttribute("aria-expanded", "false");
    }

    document.addEventListener("click", event => {
        if (!customDateButton.contains(event.target) && !historyDatePopover.contains(event.target)) {
            historyDatePopover.hidden = true;
            customDateButton.setAttribute("aria-expanded", "false");
        }
    });
    historyPeriodButtons.forEach(button => button.addEventListener("click", () => {
        historyPeriod = Number(button.dataset.qaHistoryPeriod);
        historyRange = null;
        updateHistoryPeriod();
    }));
    customDateButton.addEventListener("click", () => {
        historyDatePopover.hidden = !historyDatePopover.hidden;
        if (!historyDatePopover.hidden) {
            const box = customDateButton.getBoundingClientRect();
            historyDatePopover.style.top = `${box.bottom + 8}px`;
            historyDatePopover.style.left = `${Math.max(12, box.right - historyDatePopover.offsetWidth)}px`;
        }
        customDateButton.setAttribute("aria-expanded", String(!historyDatePopover.hidden));
        byId("qaHistoryCustomDateStart").value = historyRange?.start || "";
        byId("qaHistoryCustomDateEnd").value = historyRange?.end || "";
        byId("qaHistoryCustomDateError").textContent = "";
    });
    byId("qaHistoryApplyCustomDate").addEventListener("click", () => {
        const start = byId("qaHistoryCustomDateStart").value;
        const end = byId("qaHistoryCustomDateEnd").value;
        if (!start || !end || start > end || end > recordDateInIst(new Date())) {
            byId("qaHistoryCustomDateError").textContent = "Choose a valid date range ending today or earlier.";
            return;
        }
        historyRange = { start, end };
        updateHistoryPeriod();
    });
    byId("qaHistoryClearCustomDate").addEventListener("click", () => {
        historyRange = null;
        updateHistoryPeriod();
    });
    byId("qaHistorySearch").addEventListener("input", renderAuditHistory);
    byId("qaHistoryType").addEventListener("change", renderAuditHistory);
    byId("qaAuditRows").addEventListener("click", event => {
        const row = event.target.closest("tr")?.querySelector("[data-qa-history-key]");
        if (!row) return;
        state.historyKey = row.dataset.qaHistoryKey;
        renderAuditHistory();
        byId("qaHistoryDetailTitle").focus();
    });
    byId("qaHistoryBack").addEventListener("click", () => {
        const key = state.historyKey;
        state.historyKey = null;
        renderAuditHistory();
        const row = [...byId("qaAuditRows").querySelectorAll("button")].find(button => button.dataset.qaHistoryKey === key);
        (row || historyFilterToggle).focus();
    });

    window.NovaraQA = {
        initialize(user) {
            const identity = String(user?.email || user?.id || "").trim().toLowerCase();
            if (!identity) return;
            state.key = `novaradesk_qa_v1:${JSON.stringify([user.workspace_id || "", identity])}`;
            state.reviewer = user.name || user.email || "Reviewer";
            loadCriteriaSettings();
            byId("qaTicketView").innerHTML = standardTicketViews().map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
            if (currentTab === "qa") this.activate();
        },
        activate() {
            showAuditView(state.view);
        },
        deactivate() {
            document.body.classList.remove("qa-open-audits");
            closeHistoryPopovers();
        },
        refresh() {
            if (state.view === "history") return renderAuditHistory();
            if (state.key) return loadCandidates(!state.current);
        }
    };
})();
