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
    const state = { key: "", candidates: [], sourceRequest: 0, reviewRequest: 0, current: null, messages: [], evidence: null };
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
        byId("qaCriteria").innerHTML = criteria.map((name, index) => `<div class="qa-criterion">
            <label for="qaCriterion${index}">${esc(name)}</label><select id="qaCriterion${index}" data-native-select>${options}</select></div>`).join("");
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
            if (sequence === state.sourceRequest) byId("qaCandidatesInfo").textContent = "Could not load cases. Change the agent type to retry.";
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
        byId("qaAssigneeAvatar").textContent = details.agent.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
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
        const saved = persist({ ...state.current, ratings, score, critical, action, status, evidence: state.evidence, notes: byId("qaNotes").value.trim(), updated: new Date().toISOString() });
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
        if (persist({ ...state.current, status: "complete", updated: new Date().toISOString(), action: { ...state.current.action, outcome } })) {
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
            if (state.key && byId("qaPicker").hidden) showPicker();
        },
        fromTicket(ticket) {
            if (!state.key || !ticket?.id) return;
            showWorkspace("qa");
            byId("qaType").value = "human";
            byId("qaTicketView").value = "all";
            showPicker(false);
            startAudit({ type: "human", sourceId: String(ticket.id), title: ticket.ticket_number || `NX-${String(ticket.id).padStart(4, "0")}`, topic: readable(ticket.subject || ticket.intent) });
        }
    };
})();
