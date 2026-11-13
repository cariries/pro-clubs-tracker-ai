// Shared renderer. Each page sets <html data-lang="en|zh"> and provides #app.
(function () {
  const lang = document.documentElement.dataset.lang === "zh" ? "zh" : "en";
  const T = {
    en: {
      title: "FC 2X Pro Club Statistic Tracker", sub: "Project progress",
      updated: "Last updated", overall: "Overall progress", items: "items",
      done: "Done", progress: "In progress", todo: "Not started", blocked: "Blocked",
      milestones: "Milestones", risks: "Key risks", log: "Activity log",
      switchLabel: "粵語版", switchHref: "progress.zh-HK.html"
    },
    zh: {
      title: "FC 2X Pro Club 數據追蹤器", sub: "項目進度",
      updated: "最後更新", overall: "整體進度", items: "項",
      done: "完成", progress: "進行中", todo: "未開始", blocked: "受阻",
      milestones: "里程碑", risks: "主要風險", log: "活動記錄",
      switchLabel: "English", switchHref: "progress.en.html"
    }
  }[lang];

  const P = window.PROGRESS;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const chip = s => `<span class="chip s-${s}">${esc(T[s])}</span>`;
  const pct = items => items.length ? Math.round(100 * items.filter(i => i.status === "done").length / items.length) : 0;

  const all = P.milestones.flatMap(m => m.items);
  const count = s => all.filter(i => i.status === s).length;

  const msHtml = P.milestones.map(m => {
    const p = pct(m.items);
    return `<section class="card">
      <div class="ms-head"><h3>${esc(m.id)} · ${esc(m.title[lang])}</h3><span class="meta">${p}%</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>
      <ul>${m.items.map(i => `<li><span>${esc(i.title[lang])}</span>${chip(i.status)}</li>`).join("")}</ul>
    </section>`;
  }).join("");

  const total = pct(all);
  document.title = `${T.title} – ${T.sub}`;
  document.getElementById("app").innerHTML = `
    <header>
      <div><h1>${esc(T.title)}</h1><p class="sub">${esc(T.sub)} · ${esc(T.updated)}: ${esc(P.updated)}</p></div>
      <nav class="lang"><a href="${T.switchHref}">${esc(T.switchLabel)}</a></nav>
    </header>
    <section class="card overall" style="margin-top:20px">
      <div class="overall-top"><span>${esc(T.overall)}</span><span class="pct">${total}%</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${total}" aria-valuemin="0" aria-valuemax="100"><span style="width:${total}%"></span></div>
      <div class="counts">${["done", "progress", "todo", "blocked"].map(s => `${chip(s)}<span class="meta" style="margin-right:8px">${count(s)}</span>`).join("")}</div>
    </section>
    <h2>${esc(T.milestones)}</h2>${msHtml}
    <h2>${esc(T.risks)}</h2>
    <section class="card risks"><ul style="margin:0">${P.risks.map(r => `<li>${esc(r[lang])}</li>`).join("")}</ul></section>
    <h2>${esc(T.log)}</h2>
    <section class="card log"><ul style="margin:0">${P.log.map(l => `<li><span class="date">${esc(l.date)}</span>${esc(l[lang])}</li>`).join("")}</ul></section>`;
})();
