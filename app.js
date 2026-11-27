(function () {
  "use strict";

  const QUESTIONS = window.QUESTIONS || [];
  const TOPICS = window.TOPICS || [];
  const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  const STATE_KEY = "dev-prep-state-v1";
  const HISTORY_KEY = "dev-prep-history-v1";
  const HISTORY_MAX = 10;

  let state = null;
  let timerHandle = null;
  let reviewFilter = "all";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    } catch (e) { /* storage unavailable: run in memory only */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function show(screen) {
    ["setup", "exam", "results"].forEach((s) => $(s).classList.toggle("hidden", s !== screen));
    window.scrollTo(0, 0);
  }

  function fmtTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0");
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }

  const isMulti = (q) => q.answer.length > 1;
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const isCorrect = (q, sel) => !!sel && sameSet(sel, q.answer);
  const isAnswered = (id) => (state.answers[id] || []).length > 0;

  // ---------- setup ----------
  function renderSetup() {
    const counts = {};
    QUESTIONS.forEach((q) => (counts[q.topic] = (counts[q.topic] || 0) + 1));
    $("topic-list").innerHTML = TOPICS.map(
      (t) =>
        `<label><input type="checkbox" value="${esc(t)}" checked> ${esc(t)} <span class="count">(${counts[t] || 0})</span></label>`
    ).join("");

    const saved = load(STATE_KEY, null);
    if (saved && !saved.finished && saved.ids && saved.ids.every((id) => BY_ID[id])) {
      const answered = saved.ids.filter((id) => (saved.answers[id] || []).length).length;
      $("resume-detail").textContent = `${answered} of ${saved.ids.length} answered.`;
      $("resume-box").classList.remove("hidden");
    } else {
      $("resume-box").classList.add("hidden");
    }
    renderHistory();
    show("setup");
  }

  const canReview = (h) => !!(h.exam && h.exam.ids && h.exam.ids.every((id) => BY_ID[id]));

  function renderHistory() {
    const hist = load(HISTORY_KEY, []);
    $("history").classList.toggle("hidden", hist.length === 0);
    $("history-body").innerHTML = hist
      .slice(0, HISTORY_MAX)
      .map(
        (h, i) =>
          `<tr><td>${esc(new Date(h.date).toLocaleString())}</td><td>${h.total}</td><td>${h.pct}%</td>` +
          `<td><span class="status ${h.passed ? "ok" : "bad"}">${h.passed ? "Pass" : "Fail"}</span></td>` +
          `<td>${canReview(h) ? `<button class="btn small" data-h="${i}">Review</button>` : `<span class="muted small">—</span>`}</td></tr>`
      )
      .join("");
  }

  // Open a past attempt on the results screen (read-only; nothing is saved).
  function reviewPast(i) {
    const h = load(HISTORY_KEY, [])[i];
    if (!h || !canReview(h)) return;
    state = Object.assign({}, h.exam, { current: 0, finished: true, past: true });
    renderResults(computeResults());
  }

  function selectedTopics() {
    return [...document.querySelectorAll("#topic-list input:checked")].map((i) => i.value);
  }

  function startExam(ids) {
    const minutes = Number($("time").value);
    const passMark = Math.min(100, Math.max(1, Number($("pass").value) || 70));
    const shuffleOpts = $("shuffle-opts").checked;
    const order = {};
    ids.forEach((id) => {
      const idx = BY_ID[id].options.map((_, i) => i);
      // Keep True/False in natural order.
      const tf = BY_ID[id].options.length === 2;
      order[id] = shuffleOpts && !tf ? shuffle(idx) : idx;
    });
    state = {
      ids,
      order,
      answers: {},
      flagged: {},
      assisted: {},
      current: 0,
      startedAt: Date.now(),
      deadline: minutes ? Date.now() + minutes * 60000 : null,
      timeLimitMin: minutes,
      passMark,
      finished: false,
    };
    persist();
    openExam();
  }

  function startFromSetup() {
    const topics = selectedTopics();
    const pool = QUESTIONS.filter((q) => topics.includes(q.topic));
    if (!pool.length) {
      $("setup-error").textContent = "Pick at least one topic.";
      $("setup-error").classList.remove("hidden");
      return;
    }
    $("setup-error").classList.add("hidden");
    const want = $("count").value === "all" ? pool.length : Math.min(Number($("count").value), pool.length);
    startExam(balancedSample(pool, want));
  }

  // Take questions from each topic in proportion to its share of the pool.
  function balancedSample(pool, n) {
    const byTopic = {};
    shuffle(pool).forEach((q) => (byTopic[q.topic] = byTopic[q.topic] || []).push(q.id));
    const picked = [];
    const topics = Object.keys(byTopic);
    let i = 0;
    while (picked.length < n) {
      const list = byTopic[topics[i % topics.length]];
      if (list.length) picked.push(list.shift());
      i++;
    }
    return shuffle(picked);
  }

  function persist() {
    if (state) save(STATE_KEY, state);
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
    if (!state.deadline) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const tick = () => {
      const left = state.deadline - Date.now();
      el.textContent = "⏱ " + fmtTime(left);
      el.classList.toggle("low", left < 5 * 60000);
      if (left <= 0) {
        clearInterval(timerHandle);
        finishExam(true);
      }
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  function renderQuestion() {
    const id = state.ids[state.current];
    const q = BY_ID[id];
    const n = state.ids.length;
    const sel = state.answers[id] || [];
    const revealed = !!state.assisted[id];

    $("q-counter").textContent = `Question ${state.current + 1} of ${n}`;
    $("q-topic").textContent = q.topic;
    $("progress-bar").style.width = `${(state.ids.filter(isAnswered).length / n) * 100}%`;
    $("q-text").textContent = q.q;
    $("q-code").classList.toggle("hidden", !q.code);
    $("q-code").textContent = q.code || "";
    $("q-instruction").textContent = isMulti(q)
      ? `Choose ${q.answer.length}.`
      : "Choose one.";

    const type = isMulti(q) ? "checkbox" : "radio";
    $("options").innerHTML = state.order[id]
      .map((oi, pos) => {
        const checked = sel.includes(oi);
        let cls = "option" + (checked ? " selected" : "");
        let tag = "";
        if (revealed) {
          if (q.answer.includes(oi)) { cls += " correct"; tag = "Correct"; }
          else if (checked) { cls += " incorrect"; tag = "Your pick"; }
        }
        return (
          `<label class="${cls}"><input type="${type}" name="opt" value="${oi}" ${checked ? "checked" : ""}>` +
          `<span><strong>${String.fromCharCode(65 + pos)}.</strong> ${esc(q.options[oi])}</span>` +
          (tag ? `<span class="tag">${tag}</span>` : "") +
          `</label>`
        );
      })
      .join("");

    $("explanation").classList.toggle("hidden", !revealed);
    $("explanation").innerHTML = revealed ? `<strong>Why:</strong> ${esc(q.explain)}` : "";

    $("prev-btn").disabled = state.current === 0;
    $("next-btn").textContent = state.current === n - 1 ? "Review & finish" : "Next →";
    $("flag-btn").classList.toggle("on", !!state.flagged[id]);
    $("flag-btn").textContent = state.flagged[id] ? "⚑ Flagged" : "⚑ Flag";
    $("show-btn").disabled = revealed;
    $("show-btn").textContent = revealed ? "Answer shown" : "Show answer";

    renderNavigator();
  }

  function renderNavigator() {
    $("navigator").innerHTML = state.ids
      .map((id, i) => {
        const cls = ["nav-btn"];
        if (isAnswered(id)) cls.push("answered");
        if (state.flagged[id]) cls.push("flagged");
        if (state.assisted[id]) cls.push("assisted");
        if (i === state.current) cls.push("current");
        return `<button class="${cls.join(" ")}" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`;
      })
      .join("");
  }

  function onOptionChange(e) {
    if (e.target.name !== "opt") return;
    const id = state.ids[state.current];
    const q = BY_ID[id];
    const val = Number(e.target.value);
    let sel = (state.answers[id] || []).slice();
    if (isMulti(q)) {
      sel = e.target.checked ? [...new Set([...sel, val])] : sel.filter((x) => x !== val);
    } else {
      sel = [val];
    }
    state.answers[id] = sel;
    persist();
    renderQuestion();
  }

  function go(i) {
    state.current = Math.max(0, Math.min(state.ids.length - 1, i));
    persist();
    renderQuestion();
    $("exam").scrollIntoView({ block: "start" });
  }

  function confirmFinish() {
    const unanswered = state.ids.filter((id) => !isAnswered(id)).length;
    const flagged = state.ids.filter((id) => state.flagged[id]).length;
    const parts = [];
    if (unanswered) parts.push(`${unanswered} unanswered`);
    if (flagged) parts.push(`${flagged} flagged`);
    $("modal-text").textContent = parts.length
      ? `You have ${parts.join(" and ")} question${unanswered + flagged === 1 ? "" : "s"}. Finish the exam anyway?`
      : "Finish the exam and see your results?";
    $("modal").classList.remove("hidden");
  }

  function finishExam(timedOut) {
    clearInterval(timerHandle);
    $("timer").classList.add("hidden");
    $("modal").classList.add("hidden");
    state.finished = true;
    state.finishedAt = Date.now();
    state.timedOut = !!timedOut;
    persist();

    const r = computeResults();
    const hist = load(HISTORY_KEY, []);
    hist.unshift({
      date: state.finishedAt, total: r.total, pct: r.pct, passed: r.passed,
      // Full attempt so it can be reviewed later from the start screen.
      exam: {
        ids: state.ids, order: state.order, answers: state.answers,
        flagged: state.flagged, assisted: state.assisted, passMark: state.passMark,
        startedAt: state.startedAt, finishedAt: state.finishedAt, timedOut: state.timedOut,
      },
    });
    save(HISTORY_KEY, hist.slice(0, HISTORY_MAX));
    remove(STATE_KEY);
    renderResults(r);
  }

  // ---------- results ----------
  function computeResults() {
    const total = state.ids.length;
    let correct = 0, unanswered = 0, assistedCorrect = 0;
    const topics = {};
    state.ids.forEach((id) => {
      const q = BY_ID[id];
      const ok = isCorrect(q, state.answers[id]);
      if (ok) correct++;
      if (ok && state.assisted[id]) assistedCorrect++;
      if (!isAnswered(id)) unanswered++;
      const t = (topics[q.topic] = topics[q.topic] || { correct: 0, total: 0 });
      t.total++;
      if (ok) t.correct++;
    });
    const pct = Math.round((correct / total) * 100);
    const assisted = state.ids.filter((id) => state.assisted[id]).length;
    const unaidedPct = Math.round(((correct - assistedCorrect) / total) * 100);
    return {
      total, correct, unanswered, assisted, assistedCorrect, pct, unaidedPct,
      passed: pct >= state.passMark,
      topics,
      elapsed: state.finishedAt - state.startedAt,
    };
  }

  function renderResults(r) {
    show("results");
    const badge = $("result-badge");
    badge.className = "badge " + (r.passed ? "pass" : "fail");
    badge.textContent = r.passed ? "PASS" : "NOT YET";
    $("score-big").textContent = `${r.pct}%`;
    $("score-detail").textContent =
      `${r.correct} of ${r.total} correct · pass mark ${state.passMark}%` +
      (state.timedOut ? " · time ran out" : "") +
      (state.past ? ` · taken ${new Date(state.finishedAt).toLocaleString()}` : "");

    const stats = [
      ["Correct", r.correct],
      ["Incorrect", r.total - r.correct - r.unanswered],
      ["Unanswered", r.unanswered],
      ["Answers shown", r.assisted],
      ["Score without help", `${r.unaidedPct}%`],
      ["Time taken", fmtTime(r.elapsed)],
    ];
    $("stats").innerHTML = stats
      .map(([l, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`)
      .join("");

    const rows = TOPICS.filter((t) => r.topics[t]).map((t) => {
      const { correct, total } = r.topics[t];
      const p = Math.round((correct / total) * 100);
      const level = p >= state.passMark ? "good" : p >= state.passMark - 20 ? "mid" : "low";
      return { t, correct, total, p, level };
    });
    $("topic-body").innerHTML = rows
      .map(
        (x) =>
          `<tr><td>${esc(x.t)}</td><td>${x.correct} / ${x.total}</td>` +
          `<td><div class="bar"><div class="track"><div class="fill ${x.level}" style="width:${x.p}%"></div></div><span class="pct">${x.p}%</span></div></td></tr>`
      )
      .join("");
    const weak = rows.filter((x) => x.p < state.passMark).map((x) => x.t);
    $("weak-note").textContent = weak.length
      ? `Focus next on: ${weak.join(", ")}.`
      : "Every topic is at or above your pass mark.";

    $("retry-wrong-btn").disabled = r.correct === r.total;
    reviewFilter = "all";
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === "all"));
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
      $("review-list").innerHTML = `<p class="muted">Nothing to show for this filter.</p>`;
      return;
    }

    $("review-list").innerHTML = items
      .map(({ id, i, q, sel }) => {
        const ok = isCorrect(q, sel);
        const status = !sel.length
          ? `<span class="status skip">Unanswered</span>`
          : ok ? `<span class="status ok">Correct</span>` : `<span class="status bad">Incorrect</span>`;
        const extras =
          (state.assisted[id] ? ` <span class="status help">Answer shown</span>` : "") +
          (state.flagged[id] ? ` <span class="status flag">Flagged</span>` : "");
        const opts = state.order[id]
          .map((oi, pos) => {
            const picked = sel.includes(oi);
            const right = q.answer.includes(oi);
            let cls = "option";
            let tag = "";
            if (right) { cls += " correct"; tag = picked ? "Your pick ✓" : "Correct answer"; }
            else if (picked) { cls += " incorrect"; tag = "Your pick ✗"; }
            return `<div class="${cls}"><span><strong>${String.fromCharCode(65 + pos)}.</strong> ${esc(q.options[oi])}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</div>`;
          })
          .join("");
        return (
          `<div class="review-item"><div class="head"><strong>Q${i + 1}</strong>${status}${extras}<span class="pill">${esc(q.topic)}</span></div>` +
          `<div class="q-text">${esc(q.q)}</div>` +
          (q.code ? `<pre class="code">${esc(q.code)}</pre>` : "") +
          `<div class="options">${opts}</div>` +
          `<div class="explanation"><strong>Why:</strong> ${esc(q.explain)}</div></div>`
        );
      })
      .join("");
  }

  // ---------- wiring ----------
  function bind() {
    $("start-btn").addEventListener("click", startFromSetup);
    $("all-topics").addEventListener("click", () =>
      document.querySelectorAll("#topic-list input").forEach((i) => (i.checked = true)));
    $("no-topics").addEventListener("click", () =>
      document.querySelectorAll("#topic-list input").forEach((i) => (i.checked = false)));

    $("resume-btn").addEventListener("click", () => {
      state = load(STATE_KEY, null);
      if (!state) return renderSetup();
      if (state.deadline && state.deadline <= Date.now()) return finishExam(true);
      openExam();
    });
    $("discard-btn").addEventListener("click", () => {
      remove(STATE_KEY);
      renderSetup();
    });

    $("options").addEventListener("change", onOptionChange);
    $("prev-btn").addEventListener("click", () => go(state.current - 1));
    $("next-btn").addEventListener("click", () => {
      if (state.current === state.ids.length - 1) confirmFinish();
      else go(state.current + 1);
    });
    $("flag-btn").addEventListener("click", () => {
      const id = state.ids[state.current];
      state.flagged[id] = !state.flagged[id];
      persist();
      renderQuestion();
    });
    $("show-btn").addEventListener("click", () => {
      state.assisted[state.ids[state.current]] = true;
      persist();
      renderQuestion();
    });
    $("navigator").addEventListener("click", (e) => {
      const b = e.target.closest(".nav-btn");
      if (b) go(Number(b.dataset.i));
    });
    $("finish-btn").addEventListener("click", confirmFinish);
    $("modal-cancel").addEventListener("click", () => $("modal").classList.add("hidden"));
    $("modal-ok").addEventListener("click", () => finishExam(false));

    document.querySelector(".filters").addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (!c) return;
      reviewFilter = c.dataset.filter;
      document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
      renderReview();
    });
    $("retry-wrong-btn").addEventListener("click", () => {
      const ids = state.ids.filter((id) => !isCorrect(BY_ID[id], state.answers[id]));
      if (ids.length) startExam(shuffle(ids));
    });
    $("new-btn").addEventListener("click", renderSetup);
    $("history-body").addEventListener("click", (e) => {
      const b = e.target.closest("[data-h]");
      if (b) reviewPast(Number(b.dataset.h));
    });

    // Keyboard: arrows to move, 1-9 to pick an option.
    document.addEventListener("keydown", (e) => {
      if ($("exam").classList.contains("hidden") || !$("modal").classList.contains("hidden")) return;
      if (e.target.tagName === "INPUT" && e.target.type === "number") return;
      if (e.key === "ArrowRight") go(state.current + 1);
      else if (e.key === "ArrowLeft") go(state.current - 1);
      else if (/^[1-9]$/.test(e.key)) {
        const input = document.querySelectorAll("#options input")[Number(e.key) - 1];
        if (input) input.click();
      }
    });
  }

  bind();
  renderSetup();
})();
