const state = {
  district: "",
  special: "",
  search: "",
  selectedId: null,
  filtersLoaded: false,
  cinemaRequestId: 0,
  detailRequestId: 0,
};

const SPECIAL_GROUPS = {
  IMAX: ["IMAX", "IMAX激光"],
  杜比: ["杜比影院", "杜比巨幕", "杜比全景声"],
  CINITY: ["CINITY"],
  激光巨幕: ["激光巨幕", "中国巨幕", "杜比巨幕"],
};

const els = {
  meta: document.querySelector("#meta"),
  totalCinemas: document.querySelector("#totalCinemas"),
  totalHalls: document.querySelector("#totalHalls"),
  totalDistricts: document.querySelector("#totalDistricts"),
  quickFilters: document.querySelector("#quickFilters"),
  districts: document.querySelector("#districts"),
  specialTypes: document.querySelector("#specialTypes"),
  summary: document.querySelector("#summary"),
  search: document.querySelector("#search"),
  reset: document.querySelector("#reset"),
  count: document.querySelector("#count"),
  cinemas: document.querySelector("#cinemas"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  detailName: document.querySelector("#detailName"),
  detailAddress: document.querySelector("#detailAddress"),
  detailSource: document.querySelector("#detailSource"),
  halls: document.querySelector("#halls"),
  modeCinemas: document.querySelector("#modeCinemas"),
  modeMovies: document.querySelector("#modeMovies"),
  cinemaView: document.querySelector("#cinemaView"),
  movieView: document.querySelector("#movieView"),
  overviewBar: document.querySelector("#overviewBar"),
  movieChips: document.querySelector("#movieChips"),
  dateChips: document.querySelector("#dateChips"),
  movieCount: document.querySelector("#movieCount"),
  movieCinemas: document.querySelector("#movieCinemas"),
  specialOnly: document.querySelector("#specialOnly"),
};

function chip(label, value, active, onClick) {
  const button = document.createElement("button");
  button.className = `chip${active ? " active" : ""}`;
  button.textContent = label;
  button.type = "button";
  button.dataset.value = value;
  button.addEventListener("click", () => onClick(value));
  return button;
}

function specialClassName(text) {
  const lower = String(text).toLowerCase();
  if (lower.includes("seed")) return "seed";
  if (lower.includes("imax")) return "imax";
  if (text.includes("杜比")) return "dolby";
  if (lower.includes("cinity")) return "cinity";
  if (text.includes("激光") || text.includes("中国巨幕")) return "laser";
  return "";
}

function badge(text) {
  const span = document.createElement("span");
  const typeClass = specialClassName(text);
  span.className = `badge${typeClass ? ` ${typeClass}` : ""}`;
  span.textContent = text;
  return span;
}

function specialMatches(specialTypes, selected) {
  if (!selected) return true;
  const types = (specialTypes || "").split(",").filter(Boolean);
  const group = SPECIAL_GROUPS[selected];
  if (group) return group.some((type) => types.includes(type));
  return types.includes(selected);
}

function setSpecial(value) {
  state.special = state.special === value ? "" : value;
  refresh().catch(handleError);
}

function showEmptyDetail(message = "选择一家影院查看逐厅配置") {
  state.detailRequestId += 1;
  els.detailContent.hidden = true;
  els.detailEmpty.hidden = false;
  els.detailEmpty.textContent = message;
}

function handleError(error) {
  els.meta.textContent = `加载失败：${error.message}`;
}

async function loadFilters() {
  const [districts, specialTypes, summary] = await Promise.all([
    getJson("/api/districts"),
    getJson("/api/special-types"),
    getJson("/api/summary"),
  ]);

  const totalCinemas = districts.reduce((sum, item) => sum + item.cinema_count, 0);
  const totalHalls = specialTypes.reduce((sum, item) => sum + item.hall_count, 0);
  els.totalCinemas.textContent = totalCinemas;
  els.totalHalls.textContent = totalHalls;
  els.totalDistricts.textContent = districts.length;

  const quickButtons = Object.keys(SPECIAL_GROUPS).map((name) => {
    const button = document.createElement("button");
    const active = state.special === name;
    const items = summary[name] || [];
    const cinemaCount = new Set(items.map((item) => item.name)).size;
    const typeClass = specialClassName(name);
    button.type = "button";
    button.className = `quick-filter${active ? " active" : ""}${typeClass ? ` ${typeClass}` : ""}`;
    button.textContent = `${name} ${cinemaCount}`;
    button.addEventListener("click", () => setSpecial(name));
    return button;
  });
  els.quickFilters.replaceChildren(...quickButtons);

  els.districts.replaceChildren(
    chip("全部", "", !state.district, (value) => {
      state.district = value;
      refresh().catch(handleError);
    }),
    ...districts.map((item) => chip(`${item.district} ${item.cinema_count}`, item.district, state.district === item.district, (value) => {
      state.district = value;
      refresh().catch(handleError);
    })),
  );

  els.specialTypes.replaceChildren(
    chip("全部", "", !state.special, (value) => {
      setSpecial(value);
    }),
    ...specialTypes.map((item) => chip(`${item.special_type} ${item.hall_count}`, item.special_type, state.special === item.special_type, (value) => {
      setSpecial(value);
    })),
  );

  const rows = Object.entries(summary).map(([name, items]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    const cinemas = new Set(items.map((item) => item.name));
    row.innerHTML = `<strong>${name}: ${cinemas.size} 家</strong><span>${items.slice(0, 4).map((item) => item.name).join("、")}${items.length > 4 ? "..." : ""}</span>`;
    return row;
  });
  els.summary.replaceChildren(...rows);
  state.filtersLoaded = true;
}

async function loadCinemas() {
  const requestId = ++state.cinemaRequestId;
  const params = new URLSearchParams();
  if (state.district) params.set("district", state.district);
  if (state.special && !SPECIAL_GROUPS[state.special]) params.set("special", state.special);
  if (state.search) params.set("q", state.search);
  let cinemas = await getJson(`/api/cinemas?${params.toString()}`);
  if (requestId !== state.cinemaRequestId) return;
  if (SPECIAL_GROUPS[state.special]) {
    cinemas = cinemas.filter((item) => specialMatches(item.special_types, state.special));
  }

  els.count.textContent = `${cinemas.length} 家影院`;
  const visibleDistricts = new Set(cinemas.map((item) => item.district)).size;
  els.meta.textContent = cinemas.length
    ? `当前结果覆盖 ${visibleDistricts} 个区县；点击影院查看逐厅幕布、音效和座位信息`
    : "当前筛选没有匹配影院，请调整区县、特殊厅或搜索词";

  const cards = cinemas.map((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `cinema${state.selectedId === item.id ? " active" : ""}`;
    const types = [...new Set((item.special_types || "").split(",").filter(Boolean))]
      .filter((type) => type !== "标准厅")
      .slice(0, 5);
    card.innerHTML = `
      <h3>${item.name}</h3>
      <div class="meta">${item.district} · ${item.address}</div>
      <div class="meta">${item.hall_count} 个影厅 · 来源 ${item.source}</div>
    `;
    const badges = document.createElement("div");
    badges.className = "badges";
    if (item.seed_halls > 0) badges.appendChild(badge("精编 seed"));
    types.forEach((type) => badges.appendChild(badge(type)));
    card.appendChild(badges);
    card.addEventListener("click", () => {
      state.selectedId = item.id;
      loadDetail(item.id, { scrollIntoView: true }).catch(handleError);
      document.querySelectorAll(".cinema").forEach((node) => node.classList.remove("active"));
      card.classList.add("active");
    });
    return card;
  });

  if (!cinemas.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "没有找到匹配的影院";
    els.cinemas.replaceChildren(empty);
    state.selectedId = null;
    showEmptyDetail("调整筛选后选择一家影院查看逐厅配置");
    return;
  }

  els.cinemas.replaceChildren(...cards);
  if (!cinemas.some((item) => item.id === state.selectedId)) {
    state.selectedId = cinemas[0].id;
    loadDetail(cinemas[0].id).catch(handleError);
  }
}

function hallNameMatches(hallName, target) {
  if (!target) return false;
  if (hallName === target) return true;
  const a = (hallName || "").replace(/\s+/g, "");
  const b = (target || "").replace(/\s+/g, "");
  if (a && b && (a.includes(b) || b.includes(a))) return true;
  return false;
}

async function loadDetail(id, options = {}) {
  const requestId = ++state.detailRequestId;
  const payload = await getJson(`/api/cinemas/${id}`);
  if (requestId !== state.detailRequestId || state.selectedId !== id) return;
  els.detailEmpty.hidden = true;
  els.detailContent.hidden = false;
  els.detailName.textContent = payload.cinema.name;
  els.detailAddress.textContent = `${payload.cinema.district} · ${payload.cinema.address}`;
  els.detailSource.textContent = payload.cinema.source;
  const halls = payload.halls.map((hall) => {
    const node = document.createElement("article");
    node.className = "hall";
    const size = hall.screen_width_m && hall.screen_height_m ? `${hall.screen_width_m} × ${hall.screen_height_m} m` : "待核验";
    const hallBadgeText = hall.source === "special_seed" ? "精编 seed" : hall.special_type;
    const hallBadgeClass = specialClassName(hallBadgeText);
    node.innerHTML = `
      <div class="hall-title">
        <strong>${hall.hall_name}</strong>
        <span class="badge ${hallBadgeClass}">${hallBadgeText}</span>
      </div>
      <div class="spec-grid">
        <div><span>类型</span><strong>${hall.special_type}</strong></div>
        <div><span>银幕</span><strong>${hall.screen_type}</strong></div>
        <div><span>尺寸</span><strong>${size}</strong></div>
        <div><span>音效</span><strong>${hall.sound || "待核验"}</strong></div>
        <div><span>座位</span><strong>${hall.seats || "待核验"}</strong></div>
        <div><span>能力</span><strong>${hall.features || "待核验"}</strong></div>
      </div>
      <p class="meta">来源：${hall.source_detail}</p>
    `;
    if (options.highlightHall && hallNameMatches(hall.hall_name, options.highlightHall)) {
      node.classList.add("hall-highlight");
    }
    return node;
  });
  els.halls.replaceChildren(...halls);
  if (options.highlightHall) {
    const target = els.halls.querySelector(".hall-highlight");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (options.scrollIntoView && window.matchMedia("(max-width: 720px)").matches) {
    els.detailContent.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function refresh() {
  state.selectedId = null;
  await Promise.all([loadFilters(), loadCinemas()]);
}

/* ===== 电影选场 ===== */
const movieState = {
  movies: [],
  movieId: "",
  date: "",
  data: null,
  specialOnly: false,
  loaded: false,
  requestId: 0,
};

function dateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (dateStr === todayStr) return `今天 ${md}`;
  const tomorrow = new Date(today.getTime() + 86400000);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  if (dateStr === tomorrowStr) return `明天 ${md}`;
  return `${week} ${md}`;
}

function sessionChip(session, hallSpec, cinemaName) {
  const [tm, hall, tp, lang, price] = session;
  const spec = hallSpec[hall] || "";
  const specClass = specialClassName(spec);
  const span = document.createElement("span");
  span.className = `session${specClass ? ` ${specClass}` : ""}`;
  span.title = `${hall} · ${tp}${lang ? " " + lang : ""}${price ? " · ¥" + price : ""}${spec ? " · " + spec : ""}（点击查看该影厅数据）`;
  span.innerHTML = `<strong>${tm}</strong>${hall}${price ? `<b>¥${price}</b>` : ""}`;
  span.addEventListener("click", () => jumpToCinema(cinemaName, hall));
  return span;
}

function renderDateChips() {
  const dates = movieState.data ? movieState.data.dates : [];
  els.dateChips.replaceChildren(
    ...dates.map((d) =>
      chip(dateLabel(d), d, movieState.date === d, (value) => {
        movieState.date = value;
        renderMovieCinemas();
      })
    )
  );
}

function renderMovieCinemas() {
  const data = movieState.data;
  if (!data || !movieState.date) return;
  let rows = data.cinemas.filter((c) => c.s[movieState.date]);
  const totalRows = rows.length;
  if (movieState.specialOnly) {
    rows = rows.filter((c) => c.r <= 9);
  }
  els.movieCount.textContent = `${rows.length} 家影院${movieState.specialOnly ? "（仅特殊厅）" : ""} · ${dateLabel(movieState.date)}`;

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "该日期暂无排片";
    els.movieCinemas.replaceChildren(empty);
    return;
  }

  const cards = rows.map((c) => {
    const card = document.createElement("article");
    card.className = "movie-cinema";
    const sessions = c.s[movieState.date].slice().sort((a, b) => (a[0] || "").localeCompare(b[0] || ""));
    const badges = [];
    if (c.r <= 9 && c.bt) badges.push(`<span class="badge ${specialClassName(c.bt)}">${c.bt}</span>`);
    card.innerHTML = `
      <h3>${c.n}</h3>
      <div class="meta">${c.d || "杭州"}</div>
      <div class="badges">${badges.join("")}</div>
    `;
    const sessionRow = document.createElement("div");
    sessionRow.className = "sessions";
    sessions.forEach((s) => sessionRow.appendChild(sessionChip(s, c.hs || {}, c.n)));
    card.appendChild(sessionRow);
    return card;
  });
  els.movieCinemas.replaceChildren(...cards);
  void totalRows;
}

async function jumpToCinema(cinemaName, hallName) {
  const list = await getJson(`/api/cinemas?q=${encodeURIComponent(cinemaName)}`);
  const cinema = list.find((c) => c.name === cinemaName) || list[0];
  if (!cinema) return;
  setMode("cinemas");
  state.district = "";
  state.special = "";
  state.search = "";
  els.search.value = "";
  state.selectedId = cinema.id;
  await Promise.all([loadFilters(), loadCinemas()]);
  await loadDetail(cinema.id, { highlightHall: hallName });
}

async function selectMovie(movieId) {
  const requestId = ++movieState.requestId;
  movieState.movieId = movieId;
  els.movieChips.querySelectorAll(".chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === movieId);
  });
  const data = await getJson(`/api/showtimes?movie=${movieId}`);
  if (requestId !== movieState.requestId) return;
  movieState.data = data;
  const todayStr = new Date().toISOString().slice(0, 10);
  movieState.date = (data.dates || []).find((d) => d >= todayStr) || (data.dates || [])[data.dates.length - 1] || "";
  renderDateChips();
  renderMovieCinemas();
}

async function loadMovies() {
  if (movieState.loaded) return;
  movieState.loaded = true;
  movieState.movies = await getJson("/api/movies");
  els.movieChips.replaceChildren(
    ...movieState.movies.map((m) =>
      chip(`${m.nm} ${m.cc}`, m.id, movieState.movieId === m.id, (value) => {
        selectMovie(value).catch(handleError);
      })
    )
  );
  if (movieState.movies.length) {
    selectMovie(movieState.movies[0].id).catch(handleError);
  }
}

function setMode(mode) {
  const movies = mode === "movies";
  els.cinemaView.hidden = movies;
  els.movieView.hidden = !movies;
  els.overviewBar.hidden = movies;
  els.modeCinemas.classList.toggle("active", !movies);
  els.modeMovies.classList.toggle("active", movies);
  if (movies) {
    loadMovies().catch(handleError);
  }
}

els.modeCinemas.addEventListener("click", () => setMode("cinemas"));
els.modeMovies.addEventListener("click", () => setMode("movies"));
els.specialOnly.addEventListener("click", () => {
  movieState.specialOnly = !movieState.specialOnly;
  els.specialOnly.classList.toggle("active", movieState.specialOnly);
  renderMovieCinemas();
});

els.search.addEventListener("input", () => {
  state.search = els.search.value.trim();
  loadCinemas().catch(handleError);
});

els.reset.addEventListener("click", () => {
  state.district = "";
  state.special = "";
  state.search = "";
  els.search.value = "";
  refresh().catch(handleError);
});

refresh().catch(handleError);
