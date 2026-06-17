/* ================================================================
   LUDENDO DISCERE – script.js
   Admin: Benutzername "magister" / Passwort "latein2024"
   ================================================================ */

const ADMIN_USERNAME   = "magister";
const ADMIN_PASSWORD   = "latein2024"; // sichtbar im Quelltext – nur für lokalen Einsatz
const STORAGE_VOCAB    = "ll_vocab";
const STORAGE_RESULTS  = "ll_results";
const STORAGE_CLASSES  = "ll_classes";
const STORAGE_STUDENTS = "ll_students";
const STORAGE_LESSONS  = "ll_lessons";
const STORAGE_LEVELS   = "ll_levels";

// ──────────────────────────────────────────────
// FIREBASE / FIRESTORE
// ──────────────────────────────────────────────

const FB_CONFIG = {
  apiKey:            "AIzaSyA1C6DpD10o8j5gZ0mhystaw9PQHqk1Qgg",
  authDomain:        "ludendo-discere.firebaseapp.com",
  projectId:         "ludendo-discere",
  storageBucket:     "ludendo-discere.firebasestorage.app",
  messagingSenderId: "701767395131",
  appId:             "1:701767395131:web:41a0486de132504188791e"
};

let _db = null;

function initFirebase() {
  try {
    firebase.initializeApp(FB_CONFIG);
    _db = firebase.firestore();
  } catch(e) { console.warn("Firebase init:", e); }
}

// Generische Helfer (fire-and-forget, kein await nötig)
function fbSet(col, docId, data) {
  if (_db) _db.collection(col).doc(docId).set(data).catch(() => {});
}
function fbDel(col, docId) {
  if (_db) _db.collection(col).doc(docId).delete().catch(() => {});
}
function fbAdd(col, data) {
  if (_db) _db.collection(col).add(data).catch(() => {});
}
async function fbGetAll(col) {
  if (!_db) return null;
  try {
    const snap = await _db.collection(col).get();
    return snap.docs.map(d => d.data());
  } catch { return null; }
}

// Schüler-Ergebnisse aus Firestore in localStorage einlesen (beim Start)
async function fbSyncStudentData(studentName) {
  if (!_db || !studentName) return;
  try {
    // Ergebnisse
    const snap = await _db.collection("results")
      .where("studentName", "==", studentName).get();
    if (!snap.empty) {
      const fbResults = snap.docs.map(d => d.data());
      const local     = loadResults();
      const existing  = new Set(local.map(r => r.answeredAt + "|" + r.vocabId));
      const newOnes   = fbResults.filter(r => !existing.has(r.answeredAt + "|" + r.vocabId));
      if (newOnes.length) saveResults([...local, ...newOnes]);
    }
    // Level
    const docId  = studentName.replace(/[/.#$[\]]/g, "_");
    const levDoc = await _db.collection("levels").doc(docId).get();
    if (levDoc.exists) {
      const d = levDoc.data();
      const snaps = loadLevelSnapshots();
      snaps[studentName] = { overall: d.overall || null, lessons: d.lessons || {} };
      localStorage.setItem(STORAGE_LEVELS, JSON.stringify(snaps));
    }
  } catch(e) { console.warn("fbSyncStudentData:", e); }
}

// Alle Ergebnisse aus Firestore laden (für Admin-Statistiken)
async function fbLoadAllResults() {
  return (await fbGetAll("results")) ?? loadResults();
}

// ──────────────────────────────────────────────
// DATENVERWALTUNG
// ──────────────────────────────────────────────

function loadVocab()    { try { return JSON.parse(localStorage.getItem(STORAGE_VOCAB))    || []; } catch { return []; } }
function saveVocab(l)   { localStorage.setItem(STORAGE_VOCAB,    JSON.stringify(l)); }
function loadResults()  { try { return JSON.parse(localStorage.getItem(STORAGE_RESULTS))  || []; } catch { return []; } }
function saveResults(l) { localStorage.setItem(STORAGE_RESULTS,  JSON.stringify(l)); }
function loadClasses()  { try { return JSON.parse(localStorage.getItem(STORAGE_CLASSES))  || []; } catch { return []; } }
function saveClasses(l) { localStorage.setItem(STORAGE_CLASSES,  JSON.stringify(l)); }
function loadStudents() { try { return JSON.parse(localStorage.getItem(STORAGE_STUDENTS)) || []; } catch { return []; } }
function saveStudents(l){ localStorage.setItem(STORAGE_STUDENTS, JSON.stringify(l)); }
function loadLessons()       { try { return JSON.parse(localStorage.getItem(STORAGE_LESSONS))  || []; } catch { return []; } }
function saveLessons(l)      { localStorage.setItem(STORAGE_LESSONS,  JSON.stringify(l)); }
function loadLevelSnapshots(){ try { return JSON.parse(localStorage.getItem(STORAGE_LEVELS))   || {}; } catch { return {}; } }
function saveLevelSnapshots(d){
  localStorage.setItem(STORAGE_LEVELS, JSON.stringify(d));
  Object.entries(d).forEach(([name, levels]) => {
    const docId = name.replace(/[/.#$[\]]/g, "_");
    fbSet("levels", docId, { studentName: name, ...levels });
  });
}

// Eindeutige Ganzzahl-IDs (Float-IDs verlieren bei großen Timestamps Nachkommastellen)
let _idSeq = 0;
function nextId() {
  if (_idSeq === 0) {
    const maxV = loadVocab().reduce((m, v) => Math.max(m, Math.floor(v.id || 0)), 0);
    _idSeq = Math.max(Date.now(), maxV + 1);
  }
  return _idSeq++;
}

// Legacy-Float-IDs einmalig auf Ganzzahlen normalisieren
function normalizeVocabIds() {
  const vocab = loadVocab();
  if (!vocab.length) return;
  const seen = new Set();
  let changed = false;
  const fixed = vocab.map(v => {
    let id = Number.isInteger(v.id) ? v.id : Math.round(v.id);
    while (seen.has(id)) { id++; changed = true; }
    seen.add(id);
    if (id !== v.id) changed = true;
    return id !== v.id ? { ...v, id } : v;
  });
  if (changed) saveVocab(fixed);
}

// ── Vokabeln ──
function addVocab(latin, meanings, lessonId) {
  const clean = meanings.map(m => m.trim()).filter(m => m.length > 0).slice(0, 3);
  if (!latin.trim() || !clean.length) return null;
  const list  = loadVocab();
  const entry = { id: nextId(), latin: latin.trim(), meanings: clean, lessonId: lessonId || null, createdAt: new Date().toISOString() };
  list.push(entry);
  saveVocab(list);
  fbSet("vocab", String(entry.id), entry);
  return entry;
}
function deleteVocab(id) {
  saveVocab(loadVocab().filter(v => v.id !== id));
  fbDel("vocab", String(id));
}

// ── Klassen / Schüler ──
function addClassEntry(name) {
  const t = name.trim(); if (!t) return null;
  const list = loadClasses();
  const e = { id: nextId(), name: t, createdAt: new Date().toISOString() };
  list.push(e); saveClasses(list);
  fbSet("classes", String(e.id), e);
  return e;
}
function deleteClassEntry(id) {
  const toRemove = loadStudents().filter(s => s.classId === id);
  saveClasses(loadClasses().filter(c => c.id !== id));
  saveStudents(loadStudents().filter(s => s.classId !== id));
  fbDel("classes", String(id));
  toRemove.forEach(s => fbDel("students", String(s.id)));
}
function addStudentEntry(name, classId) {
  const t = name.trim(); if (!t) return null;
  const list = loadStudents();
  const e = { id: nextId(), name: t, classId, createdAt: new Date().toISOString() };
  list.push(e); saveStudents(list);
  fbSet("students", String(e.id), e);
  return e;
}
function deleteStudentEntry(id) {
  saveStudents(loadStudents().filter(s => s.id !== id));
  fbDel("students", String(id));
}
function getStudentsInClass(cid) {
  return loadStudents().filter(s => s.classId === cid).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// ── Lektionen ──
function addLesson(name) {
  const t = name.trim(); if (!t) return null;
  const list = loadLessons();
  const e = { id: nextId(), name: t, createdAt: new Date().toISOString() };
  list.push(e); saveLessons(list);
  fbSet("lessons", String(e.id), e);
  return e;
}
function deleteLesson(id) {
  const affectedIds = new Set(loadVocab().filter(v => v.lessonId === id).map(v => v.id));
  saveLessons(loadLessons().filter(l => l.id !== id));
  const updated = loadVocab().map(v => v.lessonId === id ? { ...v, lessonId: null } : v);
  saveVocab(updated);
  fbDel("lessons", String(id));
  updated.filter(v => affectedIds.has(v.id)).forEach(v => fbSet("vocab", String(v.id), v));
}
function deleteVocabByLesson(id) {
  const toDelete = loadVocab().filter(v => v.lessonId === id);
  saveVocab(loadVocab().filter(v => v.lessonId !== id));
  toDelete.forEach(v => fbDel("vocab", String(v.id)));
}

// ── Ergebnisse ──
function addResult(studentName, classId, lessonId, vocabId, latin, meanings, format, correct) {
  const r = { id: nextId(), studentName, classId: classId||null, lessonId: lessonId||null, vocabId, latin, meanings, format, correct, answeredAt: new Date().toISOString() };
  const list = loadResults();
  list.push(r);
  saveResults(list);
  fbAdd("results", r);
}

// Startvokabeln
function seedIfEmpty() {
  if (loadVocab().length) return;
  [
    { latin:"aqua",    meanings:["das Wasser"] },
    { latin:"terra",   meanings:["die Erde","das Land"] },
    { latin:"via",     meanings:["der Weg","die Straße"] },
    { latin:"silva",   meanings:["der Wald"] },
    { latin:"puer",    meanings:["der Junge","das Kind"] },
    { latin:"puella",  meanings:["das Mädchen"] },
    { latin:"amicus",  meanings:["der Freund"] },
    { latin:"dominus", meanings:["der Herr"] },
    { latin:"Roma",    meanings:["Rom"] },
    { latin:"miles",   meanings:["der Soldat"] },
    { latin:"amare",   meanings:["lieben"] },
    { latin:"videre",  meanings:["sehen"] },
    { latin:"venire",  meanings:["kommen"] },
    { latin:"esse",    meanings:["sein"] },
    { latin:"dicere",  meanings:["sagen","sprechen"] },
    { latin:"magnus",  meanings:["groß"] },
    { latin:"bonus",   meanings:["gut"] },
    { latin:"multus",  meanings:["viel"] },
    { latin:"et",      meanings:["und"] },
    { latin:"sed",     meanings:["aber"] },
  ].forEach(v => addVocab(v.latin, v.meanings, null));
}

// ──────────────────────────────────────────────
// XP-SYSTEM
// ──────────────────────────────────────────────

const XP_CORRECT = 10;
const XP_ATTEMPT = 1;

// Gesamt-Level: feste Schwellen, unabhängig von Vokabelanzahl.
// Bei ~3 Übungen/Woche à 15 Vokabeln: Level VI nach ~1 Monat, Level XII nach >2 Schuljahren.
function getXPLevels() {
  return [
    { min: 0,      roman: "I",    title: "Tiro"        },
    { min: 150,    roman: "II",   title: "Discipulus"  },
    { min: 500,    roman: "III",  title: "Studiosus"   },
    { min: 1100,   roman: "IV",   title: "Litteratus"  },
    { min: 2200,   roman: "V",    title: "Grammaticus" },
    { min: 4000,   roman: "VI",   title: "Rhetor"      },
    { min: 7000,   roman: "VII",  title: "Orator"      },
    { min: 11500,  roman: "VIII", title: "Philosophus" },
    { min: 18000,  roman: "IX",   title: "Doctus"      },
    { min: 27000,  roman: "X",    title: "Senator"     },
    { min: 38000,  roman: "XI",   title: "Consul"      },
    { min: 52000,  roman: "XII",  title: "Magister"    },
  ];
}

function getStudentXP(name) {
  if (!name) return 0;
  return loadResults()
    .filter(r => r.studentName === name)
    .reduce((xp, r) => xp + (r.correct ? XP_CORRECT : XP_ATTEMPT), 0);
}

function getCurrentLevel(xp, levels) {
  const lvls = levels || getXPLevels();
  let level = lvls[0];
  for (const l of lvls) { if (xp >= l.min) level = l; else break; }
  return level;
}

// XP für eine einzelne Lektion
function getStudentXPForLesson(studentName, lessonId) {
  return loadResults()
    .filter(r => r.studentName === studentName && r.lessonId === lessonId)
    .reduce((xp, r) => xp + (r.correct ? XP_CORRECT : XP_ATTEMPT), 0);
}

// Lektions-Level: skaliert mit Lektionsvokabeln; Magister = alle 5× richtig (schwerer als zuvor)
function getLessonXPLevels(lessonId) {
  const n = Math.max(loadVocab().filter(v => v.lessonId === lessonId).length, 1);
  const c = XP_CORRECT;
  return [
    { min: 0,                        roman: "I",    title: "Tiro"        },
    { min: Math.round(n * 0.15 * c), roman: "II",   title: "Discipulus"  },
    { min: Math.round(n * 0.40 * c), roman: "III",  title: "Studiosus"   },
    { min: Math.round(n * 0.80 * c), roman: "IV",   title: "Litteratus"  },
    { min: n * c,                    roman: "V",    title: "Grammaticus" },
    { min: Math.round(n * 2.0 * c),  roman: "VI",   title: "Rhetor"      },
    { min: Math.round(n * 3.5 * c),  roman: "VII",  title: "Doctus"      },
    { min: n * 5 * c,                roman: "VIII", title: "Magister"    },
  ];
}

function renderProfile(studentName) {
  const lessons   = loadLessons();
  const totalXP   = getStudentXP(studentName);
  const overall   = getCurrentLevel(totalXP);

  document.getElementById("profile-name").textContent     = studentName;
  document.getElementById("profile-badge").textContent    = overall.roman;
  document.getElementById("profile-rank").textContent     = overall.title;
  document.getElementById("profile-xp-total").textContent = `${totalXP} XP gesamt`;

  const wrap = document.getElementById("profile-lessons");

  if (!lessons.length) {
    wrap.innerHTML = `<div class="empty-state">Noch keine Lektionen angelegt.</div>`;
    return;
  }

  let html = "";
  lessons.forEach(l => {
    const xp       = getStudentXPForLesson(studentName, l.id);
    const levels   = getLessonXPLevels(l.id);
    const level    = getCurrentLevel(xp, levels);
    const lvlIdx   = levels.indexOf(level);
    const nextLvl  = levels[lvlIdx + 1];
    const pct      = nextLvl
      ? Math.min(100, Math.round((xp - level.min) / (nextLvl.min - level.min) * 100))
      : 100;
    const vocabN   = loadVocab().filter(v => v.lessonId === l.id).length;
    const goal     = vocabN * 5 * XP_CORRECT;
    const isMagister = level.title === "Magister";

    html += `
    <div class="plc ${isMagister ? "plc-magister" : ""}">
      <div class="plc-top">
        <span class="plc-lesson-name">${escapeHTML(l.name)}</span>
        <span class="plc-rank-badge">${level.roman}</span>
        <span class="plc-rank-title">${level.title}</span>
      </div>
      <div class="plc-track">
        <div class="plc-fill" style="width:${pct}%"></div>
      </div>
      <div class="plc-meta">${xp} / ${goal} XP${isMagister ? " · ✓ gemeistert" : ` · nächste Stufe: ${level.title === "Doctus" ? "Magister" : (nextLvl?.title || "–")}`}</div>
    </div>`;
  });

  wrap.innerHTML = html;
}

function updateXPBar(name) {
  const levels  = getXPLevels();
  const xp      = getStudentXP(name);
  const level   = getCurrentLevel(xp);
  const lvlIdx  = levels.indexOf(level);
  const nextLvl = levels[lvlIdx + 1];
  const pct     = nextLvl
    ? Math.min(100, Math.round((xp - level.min) / (nextLvl.min - level.min) * 100))
    : 100;

  document.getElementById("xp-fill").style.width   = pct + "%";
  document.getElementById("xp-points").textContent = xp + " XP";
  document.getElementById("xp-level").textContent  = level.roman;
  document.getElementById("xp-title").textContent  = level.title;
}

// ──────────────────────────────────────────────
// LEVEL-UP-BENACHRICHTIGUNG
// ──────────────────────────────────────────────

let _levelUpQueue = [];

// Prüft ob sich Gesamt- oder Lektionslevel verbessert hat, speichert den Stand
// und gibt eine Liste der neuen Level zurück.
function checkLevelUps(studentName, lessonId) {
  const stored = loadLevelSnapshots();
  if (!stored[studentName]) stored[studentName] = { overall: null, lessons: {} };
  const snap     = stored[studentName];
  const levelUps = [];

  // Gesamtlevel
  const overallLvls  = getXPLevels();
  const overallXP    = getStudentXP(studentName);
  const overallLevel = getCurrentLevel(overallXP, overallLvls);
  const prevOIdx     = snap.overall ? overallLvls.findIndex(l => l.title === snap.overall) : -1;
  const currOIdx     = overallLvls.findIndex(l => l.title === overallLevel.title);
  if (currOIdx > prevOIdx) {
    levelUps.push({ roman: overallLevel.roman, title: overallLevel.title, subtitle: "Dein Gesamtniveau ist gestiegen!" });
  }
  snap.overall = overallLevel.title;

  // Lektionslevel
  if (lessonId) {
    const lessonLvls  = getLessonXPLevels(lessonId);
    const lessonXP    = getStudentXPForLesson(studentName, lessonId);
    const lessonLevel = getCurrentLevel(lessonXP, lessonLvls);
    const prevLIdx    = snap.lessons[lessonId] ? lessonLvls.findIndex(l => l.title === snap.lessons[lessonId]) : -1;
    const currLIdx    = lessonLvls.findIndex(l => l.title === lessonLevel.title);
    if (currLIdx > prevLIdx) {
      const les = loadLessons().find(l => l.id === lessonId);
      levelUps.push({ roman: lessonLevel.roman, title: lessonLevel.title, subtitle: les ? `Lektion: ${les.name}` : "Neues Lektionslevel" });
    }
    snap.lessons[lessonId] = lessonLevel.title;
  }

  stored[studentName] = snap;
  saveLevelSnapshots(stored);
  return levelUps;
}

function showNextLevelUp() {
  if (!_levelUpQueue.length) {
    document.getElementById("screen-result").style.display = "flex";
    return;
  }
  const { roman, title, subtitle } = _levelUpQueue.shift();
  document.getElementById("lu-roman").textContent = roman;
  document.getElementById("lu-title").textContent = title;
  document.getElementById("lu-sub").textContent   = subtitle;
  document.getElementById("level-up-overlay").style.display = "flex";
}

// ──────────────────────────────────────────────
// HILFSFUNKTIONEN
// ──────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr, n) { return shuffle(arr).slice(0, n); }

function normalize(str) {
  return str.trim().toLowerCase()
    .replace(/[äÄ]/g,"a").replace(/[öÖ]/g,"o").replace(/[üÜ]/g,"u").replace(/ß/g,"ss")
    .replace(/[^\w\s]/g,"").replace(/\s+/g," ");
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function meaningsLabel(m) {
  return Array.isArray(m) && m.length ? m.join(" / ") : "?";
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
}
function formatLabel(f) {
  return f === "typing" ? "Eintippen" : f === "multiplechoice" ? "Ankreuzen" : "Zuordnung";
}

// ──────────────────────────────────────────────
// STARTSEITE: Dropdowns & XP
// ──────────────────────────────────────────────

function populateHomeScreen() {
  // Klassen
  const classSel = document.getElementById("class-select");
  const prevClass = classSel.value;
  classSel.innerHTML = `<option value="">– Keine Klasse –</option>`;
  loadClasses().forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.name; classSel.appendChild(o);
  });
  if (prevClass && loadClasses().find(c => String(c.id) === prevClass)) classSel.value = prevClass;

  // Lektionen
  const lessonSel = document.getElementById("lesson-select");
  const prevLesson = lessonSel.value;
  lessonSel.innerHTML = `<option value="">– Alle Lektionen –</option>`;
  loadLessons().forEach(l => {
    const o = document.createElement("option");
    o.value = l.id; o.textContent = l.name; lessonSel.appendChild(o);
  });
  if (prevLesson && loadLessons().find(l => String(l.id) === prevLesson)) lessonSel.value = prevLesson;

  updateStudentInput();
}

function updateStudentInput() {
  const classId    = Number(document.getElementById("class-select").value) || null;
  const selGroup   = document.getElementById("group-student-select");
  const nameGroup  = document.getElementById("group-student-name");
  const studentSel = document.getElementById("student-select");

  if (!classId) { selGroup.style.display="none"; nameGroup.style.display=""; return; }
  const students = getStudentsInClass(classId);
  if (!students.length) { selGroup.style.display="none"; nameGroup.style.display=""; return; }

  selGroup.style.display=""; nameGroup.style.display="none";
  studentSel.innerHTML = `<option value="">– Name wählen –</option>`;
  students.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id; o.dataset.name = s.name; o.textContent = s.name; studentSel.appendChild(o);
  });
}

// ──────────────────────────────────────────────
// SCREEN-NAVIGATION
// ──────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const s = document.getElementById(id);
  if (s) s.classList.add("active");
}

// ──────────────────────────────────────────────
// QUIZ
// ──────────────────────────────────────────────

let quizState = null;
const FORMATS = ["typing","multiplechoice","matching"];

function startQuiz(playerName, classId, lessonId) {
  const allVocab = loadVocab();
  const pool0    = lessonId ? allVocab.filter(v => v.lessonId === lessonId) : allVocab;
  if (pool0.length < 4) {
    alert("Es sind zu wenige Vokabeln vorhanden (mindestens 4 benötigt).");
    return;
  }
  const pool = shuffle(pool0).slice(0, Math.min(pool0.length, 15));
  quizState = { playerName, classId: classId||null, lessonId: lessonId||null, pool, index:0, formatCycle:0, correct:0, total:0 };
  document.getElementById("quiz-player-name").textContent = playerName;
  showScreen("screen-quiz");
  document.getElementById("screen-result").style.display = "none";
  renderNextQuestion();
}

function renderNextQuestion() {
  const s = quizState;
  const format = FORMATS[s.formatCycle % FORMATS.length];

  if (format === "matching") {
    if (s.index + 4 > s.pool.length) {
      s.formatCycle++;
      if (s.index >= s.pool.length) { showResult(); return; }
      renderNextQuestion(); return;
    }
  } else {
    if (s.index >= s.pool.length) { showResult(); return; }
  }

  updateProgressLabel();
  hideAllFormats();
  document.getElementById("btn-next").style.display = "none";

  if (format === "typing")          renderTyping();
  else if (format === "multiplechoice") renderMultiple();
  else if (format === "matching")   renderMatching();
}

function hideAllFormats() {
  ["format-typing","format-multiple","format-matching"].forEach(id =>
    document.getElementById(id).style.display = "none");
}

function updateProgressLabel() {
  const s = quizState;
  const format = FORMATS[s.formatCycle % FORMATS.length];
  if (format === "matching") {
    const end = Math.min(s.index + 4, s.pool.length);
    document.getElementById("quiz-progress").textContent = `${s.index+1}–${end} / ${s.pool.length}`;
  } else {
    document.getElementById("quiz-progress").textContent = `${s.index+1} / ${s.pool.length}`;
  }
}

// Eintippen
function renderTyping() {
  const s = quizState, vocab = s.pool[s.index];
  s._typingVocab = vocab;
  document.getElementById("format-typing").style.display = "flex";
  document.getElementById("typing-question").textContent = vocab.latin;
  document.getElementById("typing-answer").value = "";
  document.getElementById("typing-answer").disabled = false;
  document.getElementById("typing-submit").disabled = false;
  document.getElementById("typing-feedback").textContent = "";
  document.getElementById("typing-feedback").className = "feedback";
  document.getElementById("meaning-progress").innerHTML = "";
  const total = Array.isArray(vocab.meanings) ? vocab.meanings.length : 0;
  document.getElementById("typing-hint").textContent = total <= 1
    ? "Gib die deutsche Bedeutung ein" : "Gib eine der deutschen Bedeutungen ein";
  setTimeout(() => document.getElementById("typing-answer").focus(), 100);
}

function submitTyping() {
  const s = quizState, vocab = s._typingVocab;
  const answer = document.getElementById("typing-answer").value.trim();
  if (!answer) return;
  const meanings  = Array.isArray(vocab.meanings) ? vocab.meanings : [];
  const normAns   = normalize(answer);
  const isCorrect = meanings.some(m => normalize(m) === normAns);
  const fb = document.getElementById("typing-feedback");
  if (isCorrect) {
    fb.textContent = "✓ Richtig!"; fb.className = "feedback correct";
  } else {
    const all = meanings.join(" / ");
    fb.textContent = meanings.length <= 1
      ? `✗ Falsch. Richtige Antwort: „${all}"`
      : `✗ Falsch. Mögliche Antworten: „${all}"`;
    fb.className = "feedback wrong";
  }
  document.getElementById("typing-answer").disabled = true;
  document.getElementById("typing-submit").disabled = true;
  if (isCorrect) s.correct++;
  addResult(s.playerName, s.classId, s.lessonId, vocab.id, vocab.latin, vocab.meanings, "typing", isCorrect);
  s.total++; s.index++; s.formatCycle++;
  document.getElementById("btn-next").style.display = "block";
}

// Multiple Choice
function renderMultiple() {
  const s = quizState, vocab = s.pool[s.index];
  const others = loadVocab().filter(v => v.id !== vocab.id);
  const correctLabel = meaningsLabel(vocab.meanings);
  const options = shuffle([correctLabel, ...pick(others,3).map(v => meaningsLabel(v.meanings))]);
  document.getElementById("format-multiple").style.display = "flex";
  document.getElementById("multiple-question").textContent = vocab.latin;
  document.getElementById("multiple-feedback").textContent = "";
  document.getElementById("multiple-feedback").className = "feedback";
  const grid = document.getElementById("multiple-choices");
  grid.innerHTML = "";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "choice-btn"; btn.textContent = opt;
    btn.addEventListener("click", () => selectMultiple(btn, opt, vocab, correctLabel));
    grid.appendChild(btn);
  });
  s._multipleVocab = vocab;
}

function selectMultiple(btn, chosen, vocab, correctLabel) {
  const s = quizState, isCorrect = chosen === correctLabel;
  document.querySelectorAll(".choice-btn").forEach(b => {
    b.disabled = true;
    if (b.textContent === correctLabel) b.classList.add("reveal-correct");
  });
  if (isCorrect) {
    btn.classList.add("selected-correct");
    document.getElementById("multiple-feedback").textContent = "✓ Richtig!";
    document.getElementById("multiple-feedback").className = "feedback correct";
  } else {
    btn.classList.add("selected-wrong");
    document.getElementById("multiple-feedback").textContent = `✗ Falsch. Richtig wäre: „${correctLabel}"`;
    document.getElementById("multiple-feedback").className = "feedback wrong";
  }
  addResult(s.playerName, s.classId, s.lessonId, vocab.id, vocab.latin, vocab.meanings, "multiplechoice", isCorrect);
  if (isCorrect) s.correct++;
  s.total++; s.index++; s.formatCycle++;
  document.getElementById("btn-next").style.display = "block";
}

// Zuordnung
function renderMatching() {
  const s = quizState;
  const pairs = s.pool.slice(s.index, s.index + 4);
  document.getElementById("format-matching").style.display = "flex";
  document.getElementById("matching-feedback").textContent = "";
  document.getElementById("matching-feedback").className = "feedback";
  document.getElementById("matching-submit").disabled = false;
  document.getElementById("matching-submit").style.display = "block";
  const leftCol  = document.getElementById("matching-left");
  const rightCol = document.getElementById("matching-right");
  leftCol.innerHTML = ""; rightCol.innerHTML = "";
  s._matchPairs = pairs; s._matchSelected = {left:null,right:null};
  s._matchConnections = {}; s._matchSubmitted = false; s._matchTimeout = null;
  shuffle(pairs).forEach(v => {
    const el = document.createElement("div");
    el.className="match-item"; el.textContent=v.latin;
    el.dataset.id=v.id; el.dataset.side="left";
    el.addEventListener("click",()=>matchClick(el)); leftCol.appendChild(el);
  });
  shuffle(pairs).forEach(v => {
    const el = document.createElement("div");
    el.className="match-item"; el.textContent=meaningsLabel(v.meanings);
    el.dataset.id=v.id; el.dataset.side="right";
    el.addEventListener("click",()=>matchClick(el)); rightCol.appendChild(el);
  });
}

function matchClick(el) {
  const s = quizState;
  if (el.classList.contains("matched") || el.classList.contains("disabled")) return;
  const side = el.dataset.side, sel = s._matchSelected;
  if (sel[side] === el) { el.classList.remove("selected"); sel[side]=null; return; }
  if (sel[side]) sel[side].classList.remove("selected");
  el.classList.add("selected"); sel[side] = el;
  if (sel.left && sel.right) {
    const leftId = Number(sel.left.dataset.id), rightId = Number(sel.right.dataset.id);
    if (leftId === rightId) {
      sel.left.classList.remove("selected"); sel.right.classList.remove("selected");
      sel.left.classList.add("matched"); sel.right.classList.add("matched");
      s._matchConnections[leftId] = rightId;
      if (Object.keys(s._matchConnections).length === s._matchPairs.length)
        s._matchTimeout = setTimeout(submitMatching, 400);
    } else {
      sel.left.classList.add("wrong-flash"); sel.right.classList.add("wrong-flash");
      const l=sel.left, r=sel.right;
      setTimeout(()=>{ l.classList.remove("wrong-flash","selected"); r.classList.remove("wrong-flash","selected"); }, 500);
    }
    sel.left=null; sel.right=null;
  }
}

function submitMatching() {
  const s = quizState;
  if (s._matchSubmitted) return;
  s._matchSubmitted = true;
  if (s._matchTimeout) { clearTimeout(s._matchTimeout); s._matchTimeout=null; }
  const pairs = s._matchPairs, conn = s._matchConnections;
  const correctCount = pairs.filter(v => conn[v.id] === v.id).length;
  const fb = document.getElementById("matching-feedback");
  fb.textContent = correctCount === pairs.length
    ? `✓ Alle ${pairs.length} Paare richtig zugeordnet!`
    : `${correctCount} von ${pairs.length} Paaren richtig.`;
  fb.className = "feedback " + (correctCount === pairs.length ? "correct" : "wrong");
  document.getElementById("matching-submit").style.display = "none";
  pairs.forEach(v => {
    const correct = conn[v.id] === v.id;
    addResult(s.playerName, s.classId, s.lessonId, v.id, v.latin, v.meanings, "matching", correct);
    if (correct) s.correct++;
    s.total++;
  });
  document.querySelectorAll(".match-item").forEach(el => { el.classList.add("matched"); el.style.cursor="default"; });
  s.index += 4; s.formatCycle++;
  document.getElementById("btn-next").style.display = "block";
}

// Ergebnis-Bildschirm
function showResult() {
  const s   = quizState;
  const pct = s.total > 0 ? Math.round(s.correct / s.total * 100) : 0;
  document.getElementById("result-score").textContent = `${s.correct} / ${s.total} richtig`;
  document.getElementById("result-bar").style.width   = pct + "%";
  let icon="🏆", msg="Ausgezeichnet! Wahrhaft ein würdiger Römer!";
  if (pct < 40)      { icon="📜"; msg="Noch viel zu lernen — aber der Weg ist das Ziel!"; }
  else if (pct < 70) { icon="⚔️"; msg="Solide Leistung! Übe weiter, Discipulus!"; }
  else if (pct < 90) { icon="🦅"; msg="Gut gemacht! Fast schon ein Magister!"; }
  document.getElementById("result-icon").textContent = icon;
  document.getElementById("result-msg").textContent  = msg;

  const xpGained = s.correct * XP_CORRECT + (s.total - s.correct) * XP_ATTEMPT;
  const xpNow    = getStudentXP(s.playerName);
  const lvlNow   = getCurrentLevel(xpNow, getXPLevels());
  document.getElementById("result-xp").innerHTML =
    `+${xpGained} XP &nbsp;·&nbsp; Gesamt: <em>${lvlNow.roman} ${lvlNow.title}</em>`;

  // Level-Up prüfen, Ergebnis speichern und ggf. Benachrichtigung zeigen
  const levelUps = checkLevelUps(s.playerName, s.lessonId);
  _levelUpQueue  = [...levelUps];
  document.getElementById("level-up-overlay").style.display = "none";

  if (_levelUpQueue.length) {
    showNextLevelUp(); // Level-Up zuerst; danach öffnet showNextLevelUp das Ergebnis
  } else {
    document.getElementById("screen-result").style.display = "flex";
  }

  updateXPBar(s.playerName);
}

// ──────────────────────────────────────────────
// ADMIN – Vokabeln
// ──────────────────────────────────────────────

function updateNoLessonCount() {
  const n = loadVocab().filter(v => !v.lessonId).length;
  const el = document.getElementById("no-lesson-count");
  if (el) el.textContent = n;
  const btn = document.getElementById("btn-delete-no-lesson");
  if (btn) btn.style.display = n > 0 ? "" : "none";
}

function renderAdminVocab() {
  const vocab   = loadVocab();
  const lessons = loadLessons();
  const lesMap  = Object.fromEntries(lessons.map(l => [l.id, l.name]));
  document.getElementById("vocab-count").textContent = vocab.length;

  // Lektion-Dropdown im Formular aktualisieren
  const sel = document.getElementById("new-vocab-lesson");
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = `<option value="">– Keine Lektion –</option>`;
    lessons.forEach(l => { const o=document.createElement("option"); o.value=l.id; o.textContent=l.name; sel.appendChild(o); });
    if (prev && lessons.find(l => String(l.id)===prev)) sel.value = prev;
  }

  const wrap = document.getElementById("vocab-list");
  if (!vocab.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📜</div>Noch keine Vokabeln vorhanden.</div>`;
    return;
  }
  let html = `<table><thead><tr><th>Lateinisch</th><th>Bedeutungen</th><th>Lektion</th><th>Hinzugefügt</th><th></th></tr></thead><tbody>`;
  vocab.forEach(v => {
    const meanings = Array.isArray(v.meanings) ? v.meanings : [];
    const mHtml = meanings.length
      ? meanings.map((m,i)=>`<span>${i+1}. ${escapeHTML(m)}</span>`).join("<br>")
      : `<span class="text-muted">–</span>`;
    const lesName = v.lessonId && lesMap[v.lessonId] ? escapeHTML(lesMap[v.lessonId]) : `<span class="text-muted">–</span>`;
    html += `<tr>
      <td><strong>${escapeHTML(v.latin||"")}</strong></td>
      <td class="meanings-cell">${mHtml}</td>
      <td class="meanings-cell">${lesName}</td>
      <td>${formatDate(v.createdAt)}</td>
      <td><button class="btn-icon" title="Löschen" onclick="deleteVocabUI(${v.id})">&#128465;</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
  updateNoLessonCount();
}

function deleteVocabUI(id) {
  if (!confirm("Vokabel wirklich löschen?")) return;
  deleteVocab(id); renderAdminVocab();
}

// ── Lektionen-Panel ──
function toggleLessonsPanel() {
  const panel = document.getElementById("lessons-panel");
  const icon  = document.getElementById("lessons-toggle-icon");
  const open  = panel.style.display !== "none";
  panel.style.display = open ? "none" : "";
  icon.textContent = open ? "▸" : "▾";
}

function renderLessons() {
  const lessons = loadLessons();
  const wrap = document.getElementById("lesson-list");
  if (!lessons.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:1rem 0">Noch keine Lektionen angelegt.</div>`;
    return;
  }
  const vocab = loadVocab();
  let html = `<table><thead><tr><th>Lektion</th><th>Vokabeln</th><th></th></tr></thead><tbody>`;
  lessons.forEach(l => {
    const count = vocab.filter(v => v.lessonId === l.id).length;
    html += `<tr>
      <td><strong>${escapeHTML(l.name)}</strong></td>
      <td>${count}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="deleteVocabByLessonUI(${l.id})" ${count===0?"disabled":""} title="Alle Vokabeln dieser Lektion löschen">Vokabeln löschen</button>
        <button class="btn-icon" title="Lektion löschen" onclick="deleteLessonUI(${l.id})">&#128465;</button>
      </td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function deleteVocabByLessonUI(id) {
  const l = loadLessons().find(x => x.id === id);
  const n = loadVocab().filter(v => v.lessonId === id).length;
  if (!n) return;
  if (!confirm(`Alle ${n} Vokabeln der Lektion „${l?.name}" unwiderruflich löschen?\n\nDie Lektion selbst bleibt erhalten.`)) return;
  deleteVocabByLesson(id);
  renderLessons();
  renderAdminVocab();
}

function deleteLessonUI(id) {
  const l = loadLessons().find(x => x.id === id);
  const n = loadVocab().filter(v => v.lessonId === id).length;
  const msg = n > 0
    ? `Lektion „${l?.name}" löschen? Die ${n} Vokabeln bleiben erhalten, verlieren aber die Lektion.`
    : `Lektion „${l?.name}" wirklich löschen?`;
  if (!confirm(msg)) return;
  deleteLesson(id);
  renderLessons();
  renderAdminVocab();
  populateHomeScreen();
}

// ──────────────────────────────────────────────
// ADMIN – Klassen & Schüler
// ──────────────────────────────────────────────

function renderAdminClasses() {
  const classes  = loadClasses();
  const students = loadStudents();
  document.getElementById("class-count").textContent = classes.length;
  const wrap = document.getElementById("class-list");
  if (!classes.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏫</div>Noch keine Klassen vorhanden.</div>`;
    return;
  }
  let html = `<table><thead><tr><th>Klasse</th><th>Schüler</th><th></th></tr></thead><tbody>`;
  classes.forEach(c => {
    const count = students.filter(s => s.classId === c.id).length;
    html += `
    <tr>
      <td><strong>${escapeHTML(c.name)}</strong></td>
      <td>${count}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="toggleClassRow(${c.id})">Schüler ▾</button>
        <button class="btn-icon" title="Löschen" onclick="deleteClassUI(${c.id})">&#128465;</button>
      </td>
    </tr>
    <tr id="cls-row-${c.id}" class="class-students-row" style="display:none">
      <td colspan="3">${buildStudentPanel(c.id)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function buildStudentPanel(classId) {
  const students = getStudentsInClass(classId);
  let html = `<div class="student-panel">`;
  if (!students.length) html += `<p class="hint-text">Noch keine Schüler.</p>`;
  else {
    html += `<ul class="student-list">`;
    students.forEach(s => {
      html += `<li><span>${escapeHTML(s.name)}</span>
        <button class="btn-icon" onclick="deleteStudentUI(${s.id},${classId})">&#10005;</button></li>`;
    });
    html += `</ul>`;
  }
  html += `<div class="add-student-row">
    <input type="text" id="new-student-${classId}" class="input input-sm" placeholder="Schülername…" maxlength="60"
      onkeydown="if(event.key==='Enter')addStudentUI(${classId})" />
    <button class="btn btn-primary btn-sm" onclick="addStudentUI(${classId})">Hinzufügen</button>
  </div></div>`;
  return html;
}

function toggleClassRow(cid) {
  const r = document.getElementById(`cls-row-${cid}`);
  if (r) r.style.display = r.style.display === "none" ? "table-row" : "none";
}
function deleteClassUI(id) {
  const c = loadClasses().find(x => x.id===id);
  const n = getStudentsInClass(id).length;
  if (!confirm(n ? `Klasse „${c?.name}" und ${n} Schüler löschen?` : `Klasse „${c?.name}" löschen?`)) return;
  deleteClassEntry(id); renderAdminClasses(); populateHomeScreen();
}
function deleteStudentUI(sid, cid) {
  const s = loadStudents().find(x => x.id===sid);
  if (!confirm(`Schüler „${s?.name}" entfernen?`)) return;
  deleteStudentEntry(sid); renderAdminClasses();
  const r = document.getElementById(`cls-row-${cid}`);
  if (r) r.style.display = "table-row";
  populateHomeScreen();
}
function addStudentUI(cid) {
  const input = document.getElementById(`new-student-${cid}`);
  if (!input) return;
  const name = input.value.trim(); if (!name) { input.focus(); return; }
  if (getStudentsInClass(cid).find(s => s.name.toLowerCase()===name.toLowerCase())) {
    alert(`„${name}" ist bereits in dieser Klasse.`); return;
  }
  addStudentEntry(name, cid); input.value = "";
  renderAdminClasses();
  const r = document.getElementById(`cls-row-${cid}`);
  if (r) r.style.display = "table-row";
  populateHomeScreen();
}

// ──────────────────────────────────────────────
// ADMIN – Ergebnisse
// ──────────────────────────────────────────────

function renderAdminResults() {
  const classes    = loadClasses();
  const lessons    = loadLessons();
  const classMap   = Object.fromEntries(classes.map(c=>[c.id,c.name]));
  const lessonMap  = Object.fromEntries(lessons.map(l=>[l.id,l.name]));
  const allResults = loadResults().slice().reverse();

  // Filter-Dropdowns
  const fc = document.getElementById("filter-class");
  const fl = document.getElementById("filter-lesson");
  if (fc) {
    const prev = fc.value;
    fc.innerHTML = `<option value="">Alle Klassen</option>`;
    classes.forEach(c => { const o=document.createElement("option"); o.value=c.id; o.textContent=c.name; fc.appendChild(o); });
    if (prev && classes.find(c=>String(c.id)===prev)) fc.value = prev;
  }
  if (fl) {
    const prev = fl.value;
    fl.innerHTML = `<option value="">Alle Lektionen</option>`;
    lessons.forEach(l => { const o=document.createElement("option"); o.value=l.id; o.textContent=l.name; fl.appendChild(o); });
    if (prev && lessons.find(l=>String(l.id)===prev)) fl.value = prev;
  }

  const filterClass  = fc ? (Number(fc.value)||null) : null;
  const filterLesson = fl ? (Number(fl.value)||null) : null;
  const results = allResults
    .filter(r => !filterClass  || r.classId  === filterClass)
    .filter(r => !filterLesson || r.lessonId === filterLesson);

  const wrap = document.getElementById("results-list");
  if (!results.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div>Keine Ergebnisse vorhanden.</div>`;
    return;
  }
  let html = `<table><thead><tr>
    <th>Datum</th><th>Klasse</th><th>Lektion</th><th>Schüler</th><th>Lateinisch</th><th>Bedeutungen</th><th>Format</th><th>Richtig?</th>
  </tr></thead><tbody>`;
  results.forEach(r => {
    const meanings  = Array.isArray(r.meanings) ? r.meanings.map(escapeHTML).join(" / ") : escapeHTML(r.german||"");
    const className = r.classId && classMap[r.classId] ? escapeHTML(classMap[r.classId]) : `<span class="text-muted">–</span>`;
    const lesName   = r.lessonId && lessonMap[r.lessonId] ? escapeHTML(lessonMap[r.lessonId]) : `<span class="text-muted">–</span>`;
    html += `<tr>
      <td>${formatDate(r.answeredAt)}</td>
      <td>${className}</td>
      <td>${lesName}</td>
      <td>${escapeHTML(r.studentName)}</td>
      <td>${escapeHTML(r.latin)}</td>
      <td class="meanings-cell">${meanings}</td>
      <td>${formatLabel(r.format)}</td>
      <td class="${r.correct?'correct-yes':'correct-no'}">${r.correct?"✓ Ja":"✗ Nein"}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ──────────────────────────────────────────────
// ADMIN – Statistiken
// ──────────────────────────────────────────────

async function renderAdminStats() {
  const wrap = document.getElementById("stats-by-student-level");
  wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div>Lade Daten…</div>`;

  const results   = await fbLoadAllResults();
  const lessons   = loadLessons();
  const lessonMap = Object.fromEntries(lessons.map(l => [l.id, l.name]));

  if (!results.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div>Noch keine Ergebnisse vorhanden.</div>`;
    return;
  }

  // XP direkt aus dem geladenen Ergebnis-Array berechnen (nicht localStorage)
  function xpFromResults(arr) {
    return arr.reduce((acc, r) => acc + (r.correct ? XP_CORRECT : XP_ATTEMPT), 0);
  }
  function xpBar(xp, lvl, lvls) {
    const idx     = lvls.indexOf(lvl);
    const nextLvl = lvls[idx + 1];
    const pct     = nextLvl
      ? Math.min(100, Math.round((xp - lvl.min) / (nextLvl.min - lvl.min) * 100))
      : 100;
    const label   = nextLvl ? `→ ${nextLvl.title} bei ${nextLvl.min} XP` : "Höchstes Level erreicht";
    return `<div class="ssc-xp-wrap">
      <div class="ssc-xp-track"><div class="ssc-xp-fill" style="width:${pct}%"></div></div>
      <span class="ssc-xp-label">${xp} XP &nbsp;${label}</span>
    </div>`;
  }

  // Daten je Schüler + Lektion aggregieren
  const studentData = {};
  results.forEach(r => {
    if (!studentData[r.studentName])
      studentData[r.studentName] = { classId: r.classId, byLesson: {}, total: 0, correct: 0, results: [] };
    const sd = studentData[r.studentName];
    sd.total++; if (r.correct) sd.correct++;
    sd.results.push(r);
    const key = r.lessonId ?? "__none__";
    if (!sd.byLesson[key]) sd.byLesson[key] = { total: 0, correct: 0, results: [] };
    sd.byLesson[key].total++; if (r.correct) sd.byLesson[key].correct++;
    sd.byLesson[key].results.push(r);
  });

  const overallLvls = getXPLevels();
  const classMap    = Object.fromEntries(loadClasses().map(c => [c.id, c.name]));
  let html = "";

  Object.keys(studentData).sort().forEach(name => {
    const sd      = studentData[name];
    const totalXP = xpFromResults(sd.results);
    const overall = getCurrentLevel(totalXP, overallLvls);
    const pct     = sd.total ? Math.round(sd.correct / sd.total * 100) : 0;
    const cls     = sd.classId && classMap[sd.classId] ? escapeHTML(classMap[sd.classId]) : "";
    const isMagOverall = overall.title === "Magister";

    html += `<div class="ssc card${isMagOverall ? " ssc-magister-overall" : ""}">
      <div class="ssc-header">
        <div class="ssc-badge${isMagOverall ? " ssc-badge--gold" : ""}">${overall.roman}</div>
        <div class="ssc-info">
          <span class="ssc-name">${escapeHTML(name)}</span>${cls ? ` <span class="ssc-class">${cls}</span>` : ""}
          <span class="ssc-rank"><strong>${overall.title}</strong> &nbsp;·&nbsp; Gesamtlevel</span>
          <span class="ssc-overall">${sd.correct} / ${sd.total} richtig &nbsp;(${pct} %)</span>
        </div>
      </div>
      ${xpBar(totalXP, overall, overallLvls)}`;

    // Zeilen je Lektion
    const lessonKeys = Object.keys(sd.byLesson)
      .filter(k => k !== "__none__")
      .sort((a, b) => lessons.findIndex(l => l.id === Number(a)) - lessons.findIndex(l => l.id === Number(b)));

    if (lessonKeys.length) {
      html += `<div class="ssc-table-wrap"><table>
        <thead><tr>
          <th>Lektion</th><th>Rang</th><th>Titel</th><th>Fortschritt</th>
          <th>Richtig</th><th>Quote</th>
        </tr></thead><tbody>`;

      lessonKeys.forEach(k => {
        const ld    = sd.byLesson[k];
        const lid   = Number(k);
        const xp    = xpFromResults(ld.results);
        const lvls  = getLessonXPLevels(lid);
        const lv    = getCurrentLevel(xp, lvls);
        const lName = lessonMap[lid] ? escapeHTML(lessonMap[lid]) : `Lektion ${k}`;
        const q     = ld.total ? Math.round(ld.correct / ld.total * 100) : 0;
        const isMag = lv.title === "Magister";
        const lvlIdx  = lvls.indexOf(lv);
        const nextLvl = lvls[lvlIdx + 1];
        const barPct  = nextLvl
          ? Math.min(100, Math.round((xp - lv.min) / (nextLvl.min - lv.min) * 100))
          : 100;
        html += `<tr${isMag ? ' class="ssc-row-magister"' : ""}>
          <td>${lName}</td>
          <td><span class="ssc-rank-badge${isMag ? " ssc-rank-badge--gold" : ""}">${lv.roman}</span></td>
          <td><em>${lv.title}</em>${isMag ? " ✓" : ""}</td>
          <td class="ssc-bar-cell">
            <div class="ssc-mini-track"><div class="ssc-mini-fill" style="width:${barPct}%"></div></div>
            <span class="ssc-mini-label">${xp} XP</span>
          </td>
          <td>${ld.correct} / ${ld.total}</td><td>${q} %</td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    if (sd.byLesson["__none__"]) {
      const ld = sd.byLesson["__none__"];
      const q  = ld.total ? Math.round(ld.correct / ld.total * 100) : 0;
      html += `<p class="ssc-no-lesson">Ohne Lektion: ${ld.correct} / ${ld.total} richtig (${q} %)</p>`;
    }

    html += `</div>`;
  });

  wrap.innerHTML = html;
}

function switchAdminTab(tab) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id==="tab-"+tab));
  if (tab==="vocab")   renderAdminVocab();
  if (tab==="classes") renderAdminClasses();
  if (tab==="results") renderAdminResults();
  if (tab==="stats")   renderAdminStats();
}

// ──────────────────────────────────────────────
// EVENT-LISTENER
// ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Firebase initialisieren und Daten aus der Cloud laden
  initFirebase();
  (async () => {
    const [fbVocab, fbLessons, fbClasses] = await Promise.all([
      fbGetAll("vocab"), fbGetAll("lessons"), fbGetAll("classes")
    ]);
    if (fbVocab   && fbVocab.length)   { saveVocab(fbVocab);     normalizeVocabIds(); }
    if (fbLessons && fbLessons.length)  saveLessons(fbLessons.sort((a,b)=>a.id-b.id));
    if (fbClasses && fbClasses.length)  saveClasses(fbClasses.sort((a,b)=>a.id-b.id));
    populateHomeScreen();
  })();

  normalizeVocabIds();
  seedIfEmpty();
  populateHomeScreen();
  updateXPBar("");

  // ── Startseite ──
  document.getElementById("class-select").addEventListener("change", updateStudentInput);

  function getActiveName() {
    const selGroup = document.getElementById("group-student-select");
    if (selGroup.style.display !== "none") {
      const sel = document.getElementById("student-select");
      return sel.value ? (sel.options[sel.selectedIndex].dataset.name || "") : "";
    }
    return document.getElementById("student-name").value.trim();
  }

  function refreshProfileButton() {
    const name = getActiveName();
    document.getElementById("btn-profile").style.display = name ? "" : "none";
    updateXPBar(name);
  }

  document.getElementById("student-name").addEventListener("input", () => {
    refreshProfileButton();
    const name = document.getElementById("student-name").value.trim();
    if (name.length >= 2) fbSyncStudentData(name);
  });
  document.getElementById("student-select").addEventListener("change", () => {
    refreshProfileButton();
    const sel = document.getElementById("student-select");
    const name = sel.value ? (sel.options[sel.selectedIndex].dataset.name || "") : "";
    if (name) fbSyncStudentData(name);
  });

  document.getElementById("btn-start").addEventListener("click", () => {
    const classId  = Number(document.getElementById("class-select").value) || null;
    const lessonId = Number(document.getElementById("lesson-select").value) || null;
    const selGroup = document.getElementById("group-student-select");
    let playerName;
    if (selGroup.style.display !== "none") {
      const sel = document.getElementById("student-select");
      if (!sel.value) { sel.focus(); return; }
      playerName = sel.options[sel.selectedIndex].dataset.name;
    } else {
      playerName = document.getElementById("student-name").value.trim();
      if (!playerName) { document.getElementById("student-name").focus(); return; }
    }
    startQuiz(playerName, classId, lessonId);
  });

  document.getElementById("student-name").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-start").click();
  });

  document.getElementById("btn-profile").addEventListener("click", () => {
    const name = getActiveName();
    if (!name) return;
    renderProfile(name);
    showScreen("screen-profile");
  });
  document.getElementById("btn-profile-back").addEventListener("click", () => showScreen("screen-home"));

  document.getElementById("btn-goto-admin").addEventListener("click", () => {
    document.getElementById("admin-username").value = "";
    document.getElementById("admin-password").value = "";
    document.getElementById("admin-error").textContent = "";
    showScreen("screen-admin-login");
  });

  // ── Vokabeln ohne Lektion löschen ──
  document.getElementById("btn-delete-no-lesson").addEventListener("click", () => {
    const toDelete = loadVocab().filter(v => !v.lessonId);
    if (!toDelete.length) return;
    if (!confirm(`${toDelete.length} Vokabel${toDelete.length !== 1 ? "n" : ""} ohne Lektion wirklich löschen?`)) return;
    toDelete.forEach(v => { deleteVocab(v.id); });
    renderAdminVocab();
  });

  // ── Level-Up-Overlay ──
  document.getElementById("btn-lu-close").addEventListener("click", () => {
    document.getElementById("level-up-overlay").style.display = "none";
    showNextLevelUp();
  });

  // ── Quiz ──
  document.getElementById("btn-quiz-back").addEventListener("click", () => {
    if (confirm("Übung abbrechen?")) showScreen("screen-home");
  });
  document.getElementById("typing-submit").addEventListener("click", submitTyping);
  document.getElementById("typing-answer").addEventListener("keydown", e => {
    if (e.key==="Enter" && !document.getElementById("typing-submit").disabled) submitTyping();
  });
  document.getElementById("matching-submit").addEventListener("click", submitMatching);
  document.getElementById("btn-next").addEventListener("click", () => {
    document.getElementById("btn-next").style.display = "none";
    renderNextQuestion();
  });
  document.getElementById("btn-restart").addEventListener("click", () => {
    document.getElementById("screen-result").style.display = "none";
    startQuiz(quizState.playerName, quizState.classId, quizState.lessonId);
  });
  document.getElementById("btn-home").addEventListener("click", () => {
    document.getElementById("screen-result").style.display = "none";
    if (quizState) { updateXPBar(quizState.playerName); refreshProfileButton(); }
    showScreen("screen-home");
  });

  // ── Admin-Login ──
  document.getElementById("btn-admin-back").addEventListener("click", () => showScreen("screen-home"));
  document.getElementById("btn-admin-login").addEventListener("click", () => {
    const user = document.getElementById("admin-username").value.trim();
    const pw   = document.getElementById("admin-password").value;
    const err  = document.getElementById("admin-error");
    if (user===ADMIN_USERNAME && pw===ADMIN_PASSWORD) {
      err.textContent = ""; showScreen("screen-admin"); switchAdminTab("vocab");
    } else {
      err.textContent = "Benutzername oder Passwort falsch.";
      document.getElementById("admin-password").select();
    }
  });
  document.getElementById("admin-username").addEventListener("keydown", e => {
    if (e.key==="Enter") document.getElementById("admin-password").focus();
  });
  document.getElementById("admin-password").addEventListener("keydown", e => {
    if (e.key==="Enter") document.getElementById("btn-admin-login").click();
  });

  // ── Admin-Dashboard ──
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchAdminTab(btn.dataset.tab));
  });
  document.getElementById("btn-logout").addEventListener("click", () => showScreen("screen-home"));

  // ── Lektionen ──
  document.getElementById("btn-add-lesson").addEventListener("click", () => {
    const name = document.getElementById("new-lesson-name").value.trim();
    const err  = document.getElementById("lesson-error");
    if (!name) { err.textContent="Bitte einen Namen eingeben."; return; }
    if (loadLessons().find(l=>l.name.toLowerCase()===name.toLowerCase())) {
      err.textContent=`„${name}" existiert bereits.`; return;
    }
    err.textContent = "";
    addLesson(name);
    document.getElementById("new-lesson-name").value = "";
    renderLessons(); renderAdminVocab(); populateHomeScreen();
    document.getElementById("new-lesson-name").focus();
  });
  document.getElementById("new-lesson-name").addEventListener("keydown", e => {
    if (e.key==="Enter") document.getElementById("btn-add-lesson").click();
  });

  // ── Alle Vokabeln löschen ──
  document.getElementById("btn-clear-vocab").addEventListener("click", () => {
    const n = loadVocab().length;
    if (!n) return;
    if (!confirm(`Alle ${n} Vokabeln unwiderruflich löschen?`)) return;
    saveVocab([]);
    renderAdminVocab();
  });

  // ── Vokabel hinzufügen ──
  document.getElementById("btn-add-vocab").addEventListener("click", () => {
    const latin = document.getElementById("new-latin").value.trim();
    const m1    = document.getElementById("new-m1").value.trim();
    const m2    = document.getElementById("new-m2").value.trim();
    const m3    = document.getElementById("new-m3").value.trim();
    const lesId = Number(document.getElementById("new-vocab-lesson").value) || null;
    const err   = document.getElementById("vocab-error");
    if (!latin || !m1) { err.textContent="Bitte Lateinisch und Bedeutung 1 eingeben."; return; }
    err.textContent = "";
    addVocab(latin, [m1,m2,m3].filter(m=>m), lesId);
    ["new-latin","new-m1","new-m2","new-m3"].forEach(id => document.getElementById(id).value="");
    renderAdminVocab();
    document.getElementById("new-latin").focus();
  });

  // ── Klassen ──
  document.getElementById("btn-add-class").addEventListener("click", () => {
    const name = document.getElementById("new-class-name").value.trim();
    const err  = document.getElementById("class-error");
    if (!name) { err.textContent="Bitte einen Namen eingeben."; return; }
    if (loadClasses().find(c=>c.name.toLowerCase()===name.toLowerCase())) {
      err.textContent=`„${name}" existiert bereits.`; return;
    }
    err.textContent = "";
    addClassEntry(name);
    document.getElementById("new-class-name").value = "";
    renderAdminClasses(); populateHomeScreen();
    document.getElementById("new-class-name").focus();
  });
  document.getElementById("new-class-name").addEventListener("keydown", e => {
    if (e.key==="Enter") document.getElementById("btn-add-class").click();
  });

  // ── Ergebnisse ──
  document.getElementById("filter-class").addEventListener("change", renderAdminResults);
  document.getElementById("filter-lesson").addEventListener("change", renderAdminResults);
  document.getElementById("btn-clear-results").addEventListener("click", () => {
    if (!confirm("Alle Ergebnisse unwiderruflich löschen?")) return;
    saveResults([]); renderAdminResults(); renderAdminStats();
  });

  // ── CSV-Upload ──
  let csvParsed = [];
  const uploadArea = document.getElementById("upload-area");
  const csvFile    = document.getElementById("csv-file");
  uploadArea.addEventListener("click", () => csvFile.click());
  uploadArea.addEventListener("dragover", e => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea.addEventListener("drop", e => {
    e.preventDefault(); uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) processCSVFile(e.dataTransfer.files[0]);
  });
  csvFile.addEventListener("change", () => {
    if (csvFile.files[0]) processCSVFile(csvFile.files[0]);
    csvFile.value = "";
  });

  function processCSVFile(file) {
    const err = document.getElementById("upload-error");
    err.textContent = "";
    if (!file.name.match(/\.(csv|txt)$/i)) { err.textContent="Bitte .csv oder .txt wählen."; return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = ev.target.result.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length);
      csvParsed = []; const errors = [];
      lines.forEach((line,i) => {
        const sep   = line.includes(";") ? ";" : ",";
        const parts = line.split(sep).map(p=>p.trim());
        if (!parts[0] || !parts[1]) { errors.push(`Zeile ${i+1} übersprungen`); return; }
        const meanings   = [parts[1],parts[2],parts[3]].filter(m=>m&&m.length);
        const lessonName = parts[4] ? parts[4].trim() : null;
        csvParsed.push({ latin:parts[0], meanings, lessonName });
      });
      if (!csvParsed.length) { err.textContent="Keine gültigen Einträge gefunden."; return; }
      document.getElementById("upload-preview-title").textContent =
        `${csvParsed.length} Vokabel${csvParsed.length!==1?"n":""} erkannt` +
        (errors.length ? ` (${errors.length} übersprungen)` : "") + ":";
      let html = `<table><thead><tr><th>Lateinisch</th><th>Bedeutung 1</th><th>Bedeutung 2</th><th>Bedeutung 3</th><th>Lektion</th></tr></thead><tbody>`;
      csvParsed.forEach(v => {
        html += `<tr><td>${escapeHTML(v.latin)}</td><td>${escapeHTML(v.meanings[0]||"")}</td><td>${escapeHTML(v.meanings[1]||"–")}</td><td>${escapeHTML(v.meanings[2]||"–")}</td><td>${escapeHTML(v.lessonName||"–")}</td></tr>`;
      });
      html += `</tbody></table>`;
      document.getElementById("upload-preview-list").innerHTML = html;
      document.getElementById("upload-preview").style.display = "block";
      if (errors.length) err.textContent = errors.slice(0,3).join(", ") + (errors.length>3?" …":"");
    };
    reader.readAsText(file, "UTF-8");
  }

  document.getElementById("btn-import-confirm").addEventListener("click", () => {
    if (!csvParsed.length) return;
    // Lektionsnamen → IDs auflösen (ggf. anlegen)
    const lessonCache = {};
    csvParsed.forEach(v => {
      if (!v.lessonName) return;
      if (lessonCache[v.lessonName]) return;
      const existing = loadLessons().find(l => l.name.toLowerCase()===v.lessonName.toLowerCase());
      lessonCache[v.lessonName] = existing ? existing.id : addLesson(v.lessonName).id;
    });
    csvParsed.forEach(v => addVocab(v.latin, v.meanings, v.lessonName ? lessonCache[v.lessonName] : null));
    document.getElementById("upload-preview").style.display = "none";
    document.getElementById("upload-error").textContent = "";
    csvParsed = [];
    renderAdminVocab(); renderLessons(); populateHomeScreen();
    alert("Import abgeschlossen!");
  });

  document.getElementById("btn-import-cancel").addEventListener("click", () => {
    document.getElementById("upload-preview").style.display = "none";
    document.getElementById("upload-error").textContent = "";
    csvParsed = [];
  });
});
