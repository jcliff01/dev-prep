(function () {
  "use strict";

  const QUESTIONS = window.QUESTIONS || [];
  const TOPICS = window.TOPICS || [];
  const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

  const APP = "dev-prep"; // names this simulator's saved data and export files
  const STATE_KEY = `${APP}-state-v1`;
  const HISTORY_KEY = `${APP}-history-v1`;
  const SETTINGS_KEY = `${APP}-settings-v1`;
  const HISTORY_MAX = 50; // attempts kept in the browser
  const RECENT_MAX = 5;   // attempts listed on the start screen
  const TREND_MAX = 20;   // bars in the score trend
  const MISSED_MAX = 8;   // rows in "questions you miss most"
  const DEFAULT_PASS = 70;
  const SCREENS = ["setup", "exam", "results", "history"];
  const KIND_LABEL = { full: "Exam", retake: "Retake", missed: "Weak spots" };

  let state = null;        // the exam on screen (in progress, just finished, or a past one)
  let attempts = [];       // finished attempts, newest first
  let timerHandle = null;
  let reviewFilter = "all";
  let missedIds = [];
  let dialogAction = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);
  const percent = (part, whole) => (whole ? Math.floor((part * 100) / whole) : 0);
  const letter = (pos) => String.fromCharCode(65 + pos);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // storage unavailable or full: carry on in memory
    }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function fmtTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0");
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }
  function fmtDate(ms, short) {
    const opts = short ? { day: "numeric", month: "short" } : { dateStyle: "medium", timeStyle: "short" };
    return new Date(ms).toLocaleString(undefined, opts);
  }

  function show(screen) {
    SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== screen));
    $("nav").classList.toggle("hidden", screen === "exam");
    const section = screen === "history" || (screen === "results" && state && state.past) ? "history" : "setup";
    document.querySelectorAll(".nav-link").forEach((b) => {
      if (b.dataset.view === section) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }

  // One confirm dialog for every "are you sure" in the app.
  function ask({ text, ok, cancel = "Cancel", danger = false, action }) {
    const d = $("dialog");
    $("dialog-text").textContent = text;
    $("dialog-ok").textContent = ok;
    $("dialog-ok").className = "btn " + (danger ? "danger" : "primary");
    $("dialog-cancel").textContent = cancel;
    if (!d.open) d.showModal();
    dialogAction = action;
  }

  // ---------- exam data ----------
  const isMulti = (q) => q.answer.length > 1;
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const isCorrect = (q, sel) => !!sel && sameSet(sel, q.answer);
  const isAnswered = (exam, id) => (exam.answers[id] || []).length > 0;
  const knownIds = (exam) => exam.ids.every((id) => BY_ID[id]);

  // Rebuild an exam from stored or imported data, keeping only what the app understands.
  function cleanExam(e) {
    if (!e || typeof e !== "object" || !Array.isArray(e.ids) || !e.ids.length) return null;
    const get = (obj, id) => (obj && typeof obj === "object" ? obj[id] : undefined);
    const out = { ids: [...new Set(e.ids.map(String))], order: {}, answers: {}, flagged: {}, assisted: {} };
    out.ids.forEach((id) => {
      const q = BY_ID[id];
      const indexes = (v) =>
        Array.isArray(v)
          ? [...new Set(v.map(Number))].filter((x) => Number.isInteger(x) && x >= 0 && (!q || x < q.options.length))
          : [];
      const order = indexes(get(e.order, id));
      out.order[id] = q && order.length !== q.options.length ? q.options.map((_, i) => i) : order;
      const answer = indexes(get(e.answers, id));
      if (answer.length) out.answers[id] = answer;
      if (get(e.flagged, id)) out.flagged[id] = true;
      if (get(e.assisted, id)) out.assisted[id] = true;
    });
    out.passMark = clamp(int(e.passMark, DEFAULT_PASS), 1, 100);
    out.startedAt = int(e.startedAt, Date.now());
    out.finishedAt = e.finishedAt ? int(e.finishedAt, null) : null;
    out.timedOut = !!e.timedOut;
    out.kind = KIND_LABEL[e.kind] ? e.kind : "full";
    return out;
  }

  // The saved in-progress exam, or null if there isn't a usable one.
  function loadInProgress() {
    const raw = load(STATE_KEY, null);
    const exam = cleanExam(raw);
    if (!exam || raw.finished || !knownIds(exam)) return null;
    exam.current = clamp(int(raw.current), 0, exam.ids.length - 1);
    exam.deadline = raw.deadline ? int(raw.deadline, null) : null;
    exam.timeLimitMin = int(raw.timeLimitMin);
    exam.finished = false;
    return exam;
  }

  function computeResults(exam) {
    const total = exam.ids.length;
    let correct = 0, unanswered = 0, assisted = 0, assistedCorrect = 0;
    const topics = {};
    exam.ids.forEach((id) => {
      const q = BY_ID[id];
      const ok = isCorrect(q, exam.answers[id]);
      if (ok) correct++;
      if (exam.assisted[id]) assisted++;
      if (ok && exam.assisted[id]) assistedCorrect++;
      if (!isAnswered(exam, id)) unanswered++;
      const t = (topics[q.topic] = topics[q.topic] || { correct: 0, total: 0 });
      t.total++;
      if (ok) t.correct++;
    });
    return {
      total, correct, unanswered, assisted, topics,
      pct: percent(correct, total),
      unaidedPct: percent(correct - assistedCorrect, total),
      passed: correct * 100 >= exam.passMark * total,
      elapsed: Math.max(0, (exam.finishedAt || Date.now()) - exam.startedAt),
    };
  }

  // ---------- history store ----------
  // An attempt keeps the whole exam (for review) plus a snapshot of its score, which is what
  // gets shown if a question it used is later removed from the bank.
  function normalizeAttempt(h) {
    if (!h || typeof h !== "object" || !Number.isFinite(Number(h.date))) return null;
    const date = Number(h.date);
    const exam = cleanExam(h.exam);
    const a = { id: String(h.id || "a" + date), date, exam, reviewable: !!exam && knownIds(exam) };
    if (a.reviewable) {
      if (!exam.finishedAt) exam.finishedAt = date;
      const r = computeResults(exam);
      return Object.assign(a, {
        kind: exam.kind, passMark: exam.passMark, total: r.total, correct: r.correct, pct: r.pct,
        unaidedPct: r.unaidedPct, passed: r.passed, elapsed: r.elapsed, topics: r.topics,
      });
    }
    const total = Math.max(1, int(h.total, 1));
    const pct = clamp(int(h.pct), 0, 100);
    const topics = {};
    if (h.topics && typeof h.topics === "object") {
      Object.keys(h.topics).forEach((t) => {
        const v = h.topics[t] || {};
        topics[t] = { correct: Math.max(0, int(v.correct)), total: Math.max(0, int(v.total)) };
      });
    }
    return Object.assign(a, {
      kind: KIND_LABEL[h.kind] ? h.kind : "full",
      passMark: h.passMark ? clamp(int(h.passMark, DEFAULT_PASS), 1, 100) : null,
      total, pct, topics,
      correct: h.correct == null ? Math.round((pct * total) / 100) : clamp(int(h.correct), 0, total),
      unaidedPct: h.unaidedPct == null ? null : clamp(int(h.unaidedPct), 0, 100),
      passed: !!h.passed,
      elapsed: h.elapsed == null ? null : Math.max(0, int(h.elapsed)),
    });
  }

  function tidyAttempts(list) {
    const seen = new Set();
    return list
      .map(normalizeAttempt)
      .filter((a) => a && !seen.has(a.id) && seen.add(a.id))
      .sort((a, b) => b.date - a.date)
      .slice(0, HISTORY_MAX);
  }
  function loadAttempts() {
    const raw = load(HISTORY_KEY, []);
    attempts = tidyAttempts(Array.isArray(raw) ? raw : []);
  }
  const saveAttempts = () => save(HISTORY_KEY, attempts.map(({ reviewable, ...rest }) => rest));

  // ---------- setup ----------
  function renderSetup() {
    const counts = {};
    QUESTIONS.forEach((q) => (counts[q.topic] = (counts[q.topic] || 0) + 1));
    const chosen = new Set(selectedTopics());
    const first = !$("topic-list").children.length;
    $("topic-list").innerHTML = TOPICS.map(
      (t) =>
        `<label><input type="checkbox" value="${esc(t)}" ${first || chosen.has(t) ? "checked" : ""}> ${esc(t)} ` +
        `<span class="count">${counts[t] || 0}</span></label>`
    ).join("");

    const saved = loadInProgress();
    if (saved) {
      const answered = saved.ids.filter((id) => isAnswered(saved, id)).length;
      const left = saved.deadline ? saved.deadline - Date.now() : null;
      $("resume-detail").textContent =
        `${answered} of ${saved.ids.length} answered` +
        (left === null ? "." : left > 0 ? `, ${fmtTime(left)} left. The clock is still running.` : ". Time has run out.");
    }
    $("resume-box").classList.toggle("hidden", !saved);

    loadAttempts();
    $("recent").classList.toggle("hidden", !attempts.length);
    $("recent-body").innerHTML = attempts.slice(0, RECENT_MAX).map((a) => attemptRow(a, false)).join("");
    $("setup-error").classList.add("hidden");
    state = null;
    show("setup");
  }

  function attemptRow(a, full) {
    const actions =
      (a.reviewable ? `<button type="button" class="btn small" data-review="${esc(a.id)}">Review</button>` : "") +
      (full ? `<button type="button" class="btn small quiet" data-delete="${esc(a.id)}">Delete</button>` : "");
    return (
      `<tr><td>${esc(fmtDate(a.date))}</td><td>${KIND_LABEL[a.kind]}</td>` +
      `<td class="num">${a.correct}/${a.total} <span class="muted">(${a.pct}%)</span></td>` +
      (full
        ? `<td class="num">${a.unaidedPct === null ? "–" : a.unaidedPct + "%"}</td>` +
          `<td class="num">${a.elapsed === null ? "–" : fmtTime(a.elapsed)}</td>`
        : "") +
      `<td><span class="status ${a.passed ? "ok" : "bad"}">${a.passed ? "Pass" : "Fail"}</span></td>` +
      `<td class="actions">${actions}</td></tr>`
    );
  }

  function selectedTopics() {
    return [...document.querySelectorAll("#topic-list input:checked")].map((i) => i.value);
  }

  function readSettings() {
    const passMark = clamp(int($("pass").value, DEFAULT_PASS) || DEFAULT_PASS, 1, 100);
    $("pass").value = passMark;
    const s = { count: $("count").value, minutes: Number($("time").value), passMark, shuffleOpts: $("shuffle-opts").checked };
    save(SETTINGS_KEY, s);
    return s;
  }
  function restoreSettings() {
    const s = load(SETTINGS_KEY, null);
    if (!s || typeof s !== "object") return;
    const pick = (el, v) => { if ([...el.options].some((o) => o.value === String(v))) el.value = String(v); };
    pick($("count"), s.count);
    pick($("time"), s.minutes);
    $("pass").value = clamp(int(s.passMark, DEFAULT_PASS), 1, 100);
    $("shuffle-opts").checked = s.shuffleOpts !== false;
  }

  function startExam(ids, { minutes, passMark, shuffleOpts, kind }) {
    const order = {};
    ids.forEach((id) => {
      const idx = BY_ID[id].options.map((_, i) => i);
      const trueFalse = idx.length === 2; // keep True/False in natural order
      order[id] = shuffleOpts && !trueFalse ? shuffle(idx) : idx;
    });
    state = {
      ids, order, kind, passMark,
      answers: {}, flagged: {}, assisted: {},
      current: 0,
      startedAt: Date.now(),
      deadline: minutes ? Date.now() + minutes * 60000 : null,
      timeLimitMin: minutes,
      finished: false,
    };
    persist();
    openExam();
  }

  function startFromSetup() {
    const pool = QUESTIONS.filter((q) => selectedTopics().includes(q.topic));
    if (!pool.length) {
      $("setup-error").textContent = "Pick at least one topic.";
      $("setup-error").classList.remove("hidden");
      return;
    }
    $("setup-error").classList.add("hidden");
    const settings = readSettings();
    const want = settings.count === "all" ? pool.length : Math.min(Number(settings.count), pool.length);
    const begin = () => startExam(balancedSample(pool, want), { ...settings, kind: "full" });
    if (loadInProgress()) {
      ask({ text: "Starting a new exam discards the one in progress.", ok: "Start new exam", danger: true, action: begin });
    } else {
      begin();
    }
  }

  // Deal questions out one topic at a time so every selected topic is represented.
  function balancedSample(pool, n) {
    const byTopic = {};
    shuffle(pool).forEach((q) => (byTopic[q.topic] = byTopic[q.topic] || []).push(q.id));
    const lists = Object.values(byTopic);
    const picked = [];
    for (let i = 0; picked.length < n; i++) {
      const list = lists[i % lists.length];
      if (list.length) picked.push(list.shift());
    }
    return shuffle(picked);
  }

  function persist() {
    if (state && !state.finished) save(STATE_KEY, state);
  }

  // ---------- exam ----------
  function openExam() {
    show("exam");
    startTimer();
    renderQuestion();
  }

  function startTimer() {
    clearInterval(timerHandle);
    const el = $("timer");
    el.classList.toggle("hidden", !state.deadline);
    if (!state.deadline) return;
    const tick = () => {
      const left = state.deadline - Date.now();
      el.textContent = fmtTime(left);
      el.classList.toggle("low", left < 5 * 60000);
      if (left <= 0) finishExam(true);
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }
  function stopTimer() {
    clearInterval(timerHandle);
    $("timer").classList.add("hidden");
  }

  function optionHtml(q, oi, pos, { picked, cls, tag, input }) {
    return (
      `<${input ? "label" : "div"} class="option${isMulti(q) ? " multi" : ""}${picked ? " selected" : ""}${cls}">` +
      (input ? `<input type="${isMulti(q) ? "checkbox" : "radio"}" name="opt" value="${oi}"${picked ? " checked" : ""}>` : "") +
      `<span class="bubble" aria-hidden="true">${letter(pos)}</span>` +
      `<span class="opt-text">${esc(q.options[oi])}</span>` +
      (tag ? `<span class="tag">${tag}</span>` : "") +
      `</${input ? "label" : "div"}>`
    );
  }

  function renderQuestion() {
    const id = state.ids[state.current];
    const q = BY_ID[id];
    const n = state.ids.length;
    const sel = state.answers[id] || [];
    const revealed = !!state.assisted[id];
    const flagged = !!state.flagged[id];

    $("q-counter").textContent = `Question ${state.current + 1} of ${n}`;
    $("q-topic").textContent = q.topic;
    $("progress-bar").style.width = `${(state.ids.filter((x) => isAnswered(state, x)).length / n) * 100}%`;
    $("q-text").textContent = q.q;
    $("q-code").classList.toggle("hidden", !q.code);
    $("q-code").textContent = q.code || "";
    $("q-instruction").textContent = isMulti(q) ? `Choose ${q.answer.length}.` : "Choose one.";

    $("options").innerHTML = state.order[id]
      .map((oi, pos) => {
        const picked = sel.includes(oi);
        let cls = "", tag = "";
        if (revealed && q.answer.includes(oi)) { cls = " correct"; tag = "Correct"; }
        else if (revealed && picked) { cls = " incorrect"; tag = "Your pick"; }
        return optionHtml(q, oi, pos, { picked, cls, tag, input: true });
      })
      .join("");

    $("explanation").classList.toggle("hidden", !revealed);
    $("explanation").innerHTML = revealed ? `<strong>Why:</strong> ${esc(q.explain)}` : "";

    $("prev-btn").disabled = state.current === 0;
    $("next-btn").textContent = state.current === n - 1 ? "Review and finish" : "Next";
    $("flag-btn").classList.toggle("on", flagged);
    $("flag-btn").setAttribute("aria-pressed", String(flagged));
    $("flag-btn").textContent = flagged ? "Flagged" : "Flag";
    $("show-btn").disabled = revealed;
    $("show-btn").textContent = revealed ? "Answer shown" : "Show answer";

    renderNavigator();
  }

  function renderNavigator() {
    $("navigator").innerHTML = state.ids
      .map((id, i) => {
        const cls = ["nav-btn"];
        const label = [`Question ${i + 1}`];
        if (isAnswered(state, id)) { cls.push("answered"); label.push("answered"); }
        if (state.flagged[id]) { cls.push("flagged"); label.push("flagged"); }
        if (state.assisted[id]) { cls.push("assisted"); label.push("answer shown"); }
        const current = i === state.current;
        return `<button type="button" class="${cls.join(" ")}" data-i="${i}" aria-label="${label.join(", ")}"${current ? ' aria-current="true"' : ""}>${i + 1}</button>`;
      })
      .join("");
  }

  function onOptionChange(e) {
    if (e.target.name !== "opt") return;
    const id = state.ids[state.current];
    const val = Number(e.target.value);
    const sel = state.answers[id] || [];
    if (!isMulti(BY_ID[id])) state.answers[id] = [val];
    else state.answers[id] = e.target.checked ? [...new Set([...sel, val])] : sel.filter((x) => x !== val);
    persist();
    renderQuestion();
    // Re-rendering replaced the input, so put keyboard focus back where it was.
    const again = $("options").querySelector(`input[value="${val}"]`);
    if (again) again.focus({ preventScroll: true });
  }

  function go(i) {
    const next = clamp(i, 0, state.ids.length - 1);
    if (next === state.current) return;
    state.current = next;
    persist();
    renderQuestion();
    $("exam").scrollIntoView({ block: "start" });
    $("q-text").focus({ preventScroll: true });
  }

  function toggleFlag() {
    const id = state.ids[state.current];
    if (state.flagged[id]) delete state.flagged[id];
    else state.flagged[id] = true;
    persist();
    renderQuestion();
  }

  function confirmFinish() {
    const unanswered = state.ids.filter((id) => !isAnswered(state, id)).length;
    const flagged = state.ids.filter((id) => state.flagged[id]).length;
    const parts = [];
    if (unanswered) parts.push(`${unanswered} unanswered`);
    if (flagged) parts.push(`${flagged} flagged`);
    ask({
      text: parts.length
        ? `You have ${parts.join(" and ")} question${unanswered + flagged === 1 ? "" : "s"}. Finish the exam anyway?`
        : "Finish the exam and see your results?",
      ok: "Finish exam",
      cancel: "Keep going",
      action: () => finishExam(false),
    });
  }

  function finishExam(timedOut) {
    stopTimer();
    if ($("dialog").open) $("dialog").close();
    state.finished = true;
    state.timedOut = !!timedOut;
    // If the clock ran out while the tab was closed, the exam ended at the deadline, not now.
    state.finishedAt = timedOut && state.deadline ? Math.min(Date.now(), state.deadline) : Date.now();

    loadAttempts();
    attempts = tidyAttempts([
      { id: `${state.finishedAt}-${Math.random().toString(36).slice(2, 8)}`, date: state.finishedAt, exam: state },
      ...attempts,
    ]);
    saveAttempts();
    remove(STATE_KEY);
    renderResults();
  }

  // ---------- results ----------
  function renderResults() {
    const r = computeResults(state);
    show("results");
    $("result-verdict").textContent = r.passed ? "Passed" : "Not yet";
    $("result-verdict").className = "verdict " + (r.passed ? "pass" : "fail");
    $("score-big").textContent = `${r.pct}%`;
    $("score-detail").textContent =
      `${r.correct} of ${r.total} correct. Pass mark ${state.passMark}%.` +
      (state.timedOut ? " Time ran out." : "") +
      (state.past ? ` Taken ${fmtDate(state.finishedAt)}.` : "");
    $("meter-fill").style.width = `${(r.correct / r.total) * 100}%`;
    $("meter-fill").className = "meter-fill " + (r.passed ? "pass" : "fail");
    $("meter-mark").style.left = `${state.passMark}%`;
    $("meter-mark").classList.toggle("flip", state.passMark > 80);
    $("meter-label").textContent = `Pass mark ${state.passMark}%`;

    $("stats").innerHTML = statTiles([
      ["Correct", r.correct],
      ["Incorrect", r.total - r.correct - r.unanswered],
      ["Unanswered", r.unanswered],
      ["Answers shown", r.assisted],
      ["Score without help", `${r.unaidedPct}%`],
      ["Time taken", fmtTime(r.elapsed)],
    ]);

    const rows = topicRows(r.topics, state.passMark);
    $("topic-body").innerHTML = rows.map(topicRowHtml).join("");
    const weak = rows.filter((x) => x.level !== "good").map((x) => x.t);
    $("weak-note").textContent = weak.length
      ? `Focus next on: ${weak.join(", ")}.`
      : "Every topic is at or above your pass mark.";

    $("retry-wrong-btn").disabled = r.correct === r.total;
    $("back-history-btn").classList.toggle("hidden", !state.past);
    setFilter("all");
    $("result-verdict").focus({ preventScroll: true });
  }

  const statTiles = (stats) =>
    stats.map(([l, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");

  function topicRows(topics, passMark) {
    const known = TOPICS.filter((t) => topics[t]);
    const others = Object.keys(topics).filter((t) => !TOPICS.includes(t));
    return [...known, ...others]
      .filter((t) => topics[t].total > 0)
      .map((t) => {
        const { correct, total } = topics[t];
        const meets = correct * 100 >= passMark * total;
        const level = meets ? "good" : correct * 100 >= (passMark - 20) * total ? "mid" : "low";
        return { t, correct, total, p: percent(correct, total), level };
      });
  }
  const topicRowHtml = (x) =>
    `<tr><td>${esc(x.t)}</td><td class="num">${x.correct} / ${x.total}</td>` +
    `<td><div class="bar"><div class="track"><div class="fill ${x.level}" style="width:${x.p}%"></div></div><span class="pct">${x.p}%</span></div></td></tr>`;

  function setFilter(filter) {
    reviewFilter = filter;
    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === filter)));
    renderReview();
  }

  function renderReview() {
    const items = state.ids
      .map((id, i) => ({ id, i, q: BY_ID[id], sel: state.answers[id] || [] }))
      .filter(({ id, q, sel }) => {
        if (reviewFilter === "wrong") return !isCorrect(q, sel);
        if (reviewFilter === "assisted") return !!state.assisted[id];
        if (reviewFilter === "flagged") return !!state.flagged[id];
        return true;
      });

    if (!items.length) {
      $("review-list").innerHTML = `<p class="muted">No questions match this filter.</p>`;
      return;
    }

    $("review-list").innerHTML = items
      .map(({ id, i, q, sel }) => {
        const status = !sel.length
          ? `<span class="status skip">Unanswered</span>`
          : isCorrect(q, sel) ? `<span class="status ok">Correct</span>` : `<span class="status bad">Incorrect</span>`;
        const extras =
          (state.assisted[id] ? `<span class="status help">Answer shown</span>` : "") +
          (state.flagged[id] ? `<span class="status flag">Flagged</span>` : "");
        const opts = state.order[id]
          .map((oi, pos) => {
            const picked = sel.includes(oi);
            let cls = "", tag = "";
            if (q.answer.includes(oi)) { cls = " correct"; tag = picked ? "Your pick, correct" : "Correct answer"; }
            else if (picked) { cls = " incorrect"; tag = "Your pick"; }
            return optionHtml(q, oi, pos, { picked, cls, tag, input: false });
          })
          .join("");
        return (
          `<div class="review-item"><div class="head"><strong>Question ${i + 1}</strong>${status}${extras}<span class="pill">${esc(q.topic)}</span></div>` +
          `<p class="q-text">${esc(q.q)}</p>` +
          (q.code ? `<pre class="code">${esc(q.code)}</pre>` : "") +
          `<div class="options">${opts}</div>` +
          `<div class="explanation"><strong>Why:</strong> ${esc(q.explain)}</div></div>`
        );
      })
      .join("");
  }

  // Open a past attempt on the results screen. Nothing is saved.
  function reviewPast(id) {
    const a = attempts.find((x) => x.id === id);
    if (!a || !a.reviewable) return;
    state = Object.assign({}, a.exam, { current: 0, finished: true, past: true });
    renderResults();
  }

  // ---------- history ----------
  function renderHistory(message) {
    loadAttempts();
    state = null;
    const exams = attempts.filter((a) => a.kind === "full");

    $("history-msg").textContent = message || "";
    $("history-msg").classList.toggle("hidden", !message);
    $("history-empty").classList.toggle("hidden", attempts.length > 0);
    $("history-content").classList.toggle("hidden", !attempts.length);
    $("export-btn").disabled = $("clear-btn").disabled = !attempts.length;

    const avg = exams.length ? Math.round(exams.reduce((s, a) => s + a.pct, 0) / exams.length) + "%" : "–";
    const best = exams.length ? Math.max(...exams.map((a) => a.pct)) + "%" : "–";
    $("history-stats").innerHTML = statTiles([
      ["Exams taken", exams.length],
      ["Average score", avg],
      ["Best score", best],
      ["Exams passed", exams.length ? `${exams.filter((a) => a.passed).length} of ${exams.length}` : "–"],
    ]);

    renderTrend(exams);

    // Accuracy by topic, added up over every full exam.
    const topics = {};
    exams.forEach((a) =>
      Object.keys(a.topics).forEach((t) => {
        const sum = (topics[t] = topics[t] || { correct: 0, total: 0 });
        sum.correct += a.topics[t].correct;
        sum.total += a.topics[t].total;
      })
    );
    const rows = topicRows(topics, (exams[0] && exams[0].passMark) || DEFAULT_PASS);
    $("history-topics-card").classList.toggle("hidden", !rows.length);
    $("history-topic-body").innerHTML = rows.map(topicRowHtml).join("");

    renderMissed();

    $("history-body").innerHTML = attempts.map((a) => attemptRow(a, true)).join("");
    $("history-note").textContent =
      `The last ${HISTORY_MAX} attempts are kept in this browser. The numbers at the top count full exams only, ` +
      `not retakes or weak-spot practice.`;
    show("history");
  }

  // One bar per full exam, oldest on the left. Solid bars passed, hollow bars did not.
  function renderTrend(exams) {
    const shown = exams.slice(0, TREND_MAX).reverse();
    $("trend-card").classList.toggle("hidden", shown.length < 2);
    if (shown.length < 2) return;
    const marks = [...new Set(shown.map((a) => a.passMark).filter(Boolean))];
    const line = marks.length === 1 ? `<div class="trend-line" style="bottom:${marks[0]}%"></div>` : "";
    $("trend").innerHTML =
      `<div class="trend-plot">${line}` +
      shown
        .map((a) => {
          const label = `${fmtDate(a.date)}, ${a.pct}%, ${a.passed ? "passed" : "not passed"}`;
          const tag = a.reviewable ? "button" : "div";
          return (
            `<${tag}${a.reviewable ? ` type="button" data-review="${esc(a.id)}"` : ""} class="trend-bar ${a.passed ? "pass" : "fail"}" ` +
            `style="height:${Math.max(a.pct, 2)}%" title="${esc(label)}" aria-label="${esc(label)}"><span>${a.pct}</span></${tag}>`
          );
        })
        .join("") +
      `</div><div class="trend-axis">${esc(fmtDate(shown[0].date, true))} to ${esc(fmtDate(shown[shown.length - 1].date, true))}</div>`;
    $("trend-note").textContent =
      "Score in % for each full exam, oldest first. Solid bars passed and hollow bars did not." +
      (line ? ` The dashed line is the ${marks[0]}% pass mark.` : "") +
      " Select a bar to review that exam.";
  }

  function renderMissed() {
    const tally = {};
    attempts.filter((a) => a.reviewable).forEach((a) =>
      a.exam.ids.forEach((id) => {
        const t = (tally[id] = tally[id] || { id, seen: 0, missed: 0 });
        t.seen++;
        if (!isCorrect(BY_ID[id], a.exam.answers[id])) t.missed++;
      })
    );
    const worst = Object.values(tally)
      .filter((t) => t.missed > 0)
      .sort((a, b) => b.missed - a.missed || b.missed / b.seen - a.missed / a.seen)
      .slice(0, MISSED_MAX);
    missedIds = worst.map((t) => t.id);
    $("missed-card").classList.toggle("hidden", !worst.length);
    $("missed-list").innerHTML = worst
      .map(
        (t) =>
          `<li><span class="missed-q">${esc(BY_ID[t.id].q)}</span>` +
          `<span class="muted small">${esc(BY_ID[t.id].topic)}, missed ${t.missed} of ${plural(t.seen, "time")}</span></li>`
      )
      .join("");
  }

  function exportHistory() {
    const data = { app: APP, version: 1, exported: new Date().toISOString(), attempts: attempts.map(({ reviewable, ...rest }) => rest) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP}-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importHistory(file) {
    const reader = new FileReader();
    reader.onerror = () => renderHistory("That file could not be read.");
    reader.onload = () => {
      let list;
      try {
        const data = JSON.parse(reader.result);
        const foreign = data && data.app && data.app !== APP; // an export from a different simulator
        list = Array.isArray(data) ? data : !foreign && data && data.attempts;
      } catch (e) { /* handled below */ }
      if (!Array.isArray(list)) return renderHistory(`That file is not a ${APP} history export.`);
      loadAttempts();
      const before = new Set(attempts.map((a) => a.id));
      attempts = tidyAttempts([...attempts, ...list]);
      const added = attempts.filter((a) => !before.has(a.id)).length;
      const saved = saveAttempts();
      renderHistory(
        saved
          ? `Imported ${plural(added, "new attempt")}.` +
            (added < list.length ? ` ${list.length - added} in the file were already here or could not be used.` : "")
          : "The import could not be saved because browser storage is full or turned off."
      );
    };
    reader.readAsText(file);
  }

  // ---------- wiring ----------
  function navigate(view) {
    if (!$("exam").classList.contains("hidden")) return; // leave an exam with "Save and exit"
    if (view === "history") renderHistory();
    else renderSetup();
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const view = e.target.closest("[data-view]");
      if (view) return navigate(view.dataset.view);
      const review = e.target.closest("[data-review]");
      if (review) return reviewPast(review.dataset.review);
      const del = e.target.closest("[data-delete]");
      if (del) {
        const a = attempts.find((x) => x.id === del.dataset.delete);
        if (!a) return;
        ask({
          text: `Delete the attempt from ${fmtDate(a.date)}? This cannot be undone.`,
          ok: "Delete attempt",
          danger: true,
          action: () => {
            attempts = attempts.filter((x) => x !== a);
            saveAttempts();
            renderHistory("Attempt deleted.");
          },
        });
      }
    });
    $("brand").addEventListener("click", () => navigate("setup"));

    $("dialog-ok").addEventListener("click", () => {
      const action = dialogAction;
      $("dialog").close();
      if (action) action();
    });
    $("dialog-cancel").addEventListener("click", () => $("dialog").close());
    $("dialog").addEventListener("close", () => { dialogAction = null; });

    $("start-btn").addEventListener("click", startFromSetup);
    const setTopics = (on) => document.querySelectorAll("#topic-list input").forEach((i) => (i.checked = on));
    $("all-topics").addEventListener("click", () => setTopics(true));
    $("no-topics").addEventListener("click", () => setTopics(false));

    $("resume-btn").addEventListener("click", () => {
      state = loadInProgress();
      if (!state) return renderSetup();
      if (state.deadline && state.deadline <= Date.now()) return finishExam(true);
      openExam();
    });
    $("discard-btn").addEventListener("click", () =>
      ask({
        text: "Discard the exam in progress? Your answers so far will be lost.",
        ok: "Discard exam",
        danger: true,
        action: () => { remove(STATE_KEY); renderSetup(); },
      })
    );

    $("options").addEventListener("change", onOptionChange);
    $("prev-btn").addEventListener("click", () => go(state.current - 1));
    $("next-btn").addEventListener("click", () => {
      if (state.current === state.ids.length - 1) confirmFinish();
      else go(state.current + 1);
    });
    $("flag-btn").addEventListener("click", toggleFlag);
    $("show-btn").addEventListener("click", () => {
      state.assisted[state.ids[state.current]] = true;
      persist();
      renderQuestion();
      $("explanation").scrollIntoView({ block: "nearest" });
    });
    $("navigator").addEventListener("click", (e) => {
      const b = e.target.closest(".nav-btn");
      if (b) go(Number(b.dataset.i));
    });
    $("finish-btn").addEventListener("click", confirmFinish);
    $("exit-btn").addEventListener("click", () => {
      persist();
      stopTimer();
      renderSetup();
    });

    document.querySelector(".filters").addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (c) setFilter(c.dataset.filter);
    });
    $("retry-wrong-btn").addEventListener("click", () => {
      const ids = state.ids.filter((id) => !isCorrect(BY_ID[id], state.answers[id]));
      if (ids.length) startExam(shuffle(ids), { ...readSettings(), passMark: state.passMark, kind: "retake" });
    });

    $("missed-btn").addEventListener("click", () => {
      if (missedIds.length) startExam(shuffle(missedIds), { ...readSettings(), minutes: 0, kind: "missed" });
    });
    $("export-btn").addEventListener("click", exportHistory);
    $("import-btn").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importHistory(e.target.files[0]);
      e.target.value = "";
    });
    $("clear-btn").addEventListener("click", () =>
      ask({
        text: `Delete all ${plural(attempts.length, "attempt")}? This cannot be undone. Export first if you want a copy.`,
        ok: "Delete all",
        danger: true,
        action: () => { attempts = []; saveAttempts(); renderHistory("History cleared."); },
      })
    );

    // Keyboard: arrows move, 1-9 pick an option, F flags.
    document.addEventListener("keydown", (e) => {
      if ($("exam").classList.contains("hidden") || $("dialog").open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      if (t.tagName === "INPUT" && t.type !== "radio" && t.type !== "checkbox") return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault(); // otherwise a focused radio group would also change the answer
        go(state.current + (e.key === "ArrowRight" ? 1 : -1));
      } else if (/^[1-9]$/.test(e.key)) {
        const input = document.querySelectorAll("#options input")[Number(e.key) - 1];
        if (input) input.click();
      } else if (e.key === "f" || e.key === "F") {
        toggleFlag();
      }
    });
  }

  bind();
  restoreSettings();
  renderSetup();
})();
