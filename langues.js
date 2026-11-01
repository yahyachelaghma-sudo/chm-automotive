/* ═══════════════════════════════════════════════════════════════
   LANGUES : français · English · العربية (écriture de droite à gauche)
   Le code écrit tout en français ; ce module traduit l'affichage au vol
   à partir de traductions.js (PAIRES = mots exacts, REGLES = phrases avec des nombres ou des noms).
   ═══════════════════════════════════════════════════════════════ */
const LANGUES = { fr: "Français", en: "English", ar: "العربية" };
const LANGUE = (() => { try { const l = localStorage.getItem("chm_langue"); return LANGUES[l] ? l : "fr"; } catch { return "fr"; } })();
const LOCALE = { fr: "fr-FR", en: "en-GB", ar: "ar-DZ-u-nu-latn" }[LANGUE];
document.documentElement.lang = LANGUE;
document.documentElement.dir = LANGUE === "ar" ? "rtl" : "ltr";

function changerLangue(langue) {
  try { localStorage.setItem("chm_langue", langue); } catch {}
  location.reload();
}

// ---------- Dictionnaire ----------
const DICO = new Map();
if (LANGUE !== "fr" && typeof PAIRES !== "undefined") {
  const colonne = LANGUE === "en" ? 1 : 2;
  for (const ligne of PAIRES) if (ligne[colonne]) DICO.set(ligne[0], ligne[colonne]);
}

// Noms qui se mettent au pluriel après un nombre : [français singulier, français pluriel, anglais sing., anglais plur., arabe (1, 2, 3-10, 11+)]
const UNITES = {
  jour: ["day", "days", ["يوم", "يومان", "أيام", "يومًا"]],
  réservation: ["booking", "bookings", ["حجز", "حجزان", "حجوزات", "حجزًا"]],
  véhicule: ["vehicle", "vehicles", ["مركبة", "مركبتان", "مركبات", "مركبة"]],
  location: ["rental", "rentals", ["عملية كراء", "عمليتا كراء", "عمليات كراء", "عملية كراء"]],
  alerte: ["alert", "alerts", ["تنبيه", "تنبيهان", "تنبيهات", "تنبيهًا"]],
  client: ["client", "clients", ["عميل", "عميلان", "عملاء", "عميلًا"]],
  événement: ["event", "events", ["حدث", "حدثان", "أحداث", "حدثًا"]],
  dossier: ["file", "files", ["ملف", "ملفان", "ملفات", "ملفًا"]],
  document: ["document", "documents", ["وثيقة", "وثيقتان", "وثائق", "وثيقة"]],
  minute: ["minute", "minutes", ["دقيقة", "دقيقتان", "دقائق", "دقيقة"]],
  semaine: ["week", "weeks", ["أسبوع", "أسبوعان", "أسابيع", "أسبوعًا"]],
  photo: ["photo", "photos", ["صورة", "صورتان", "صور", "صورة"]],
  incident: ["incident", "incidents", ["حادثة", "حادثتان", "حوادث", "حادثة"]],
  intervention: ["intervention", "interventions", ["تدخّل", "تدخّلان", "تدخلات", "تدخّلًا"]],
  annulation: ["cancellation", "cancellations", ["إلغاء", "إلغاءان", "إلغاءات", "إلغاءً"]],
};
function unite(n, mot) {
  const u = UNITES[mot];
  if (!u) return `${n} ${mot}`;
  if (LANGUE === "en") return `${n} ${n === 1 ? u[0] : u[1]}`;
  const f = u[2];
  return n === 1 ? f[0] : n === 2 ? f[1] : n <= 10 ? `${n} ${f[2]}` : `${n} ${f[3]}`;
}
const MOTS_UNITES = Object.keys(UNITES).filter((m) => UNITES[m]).join("|");
const REGLE_UNITE = new RegExp(`^(\\d+) (${MOTS_UNITES})s?$`);

// ---------- Traduction d'un texte ----------
function traduireTexte(brut) {
  if (LANGUE === "fr" || !brut) return brut;
  const t = brut.trim();
  if (!t || !/[A-Za-zÀ-ÿ]/.test(t)) return brut;
  const remplacer = (nouveau) => (nouveau === t ? brut : brut.replace(t, nouveau));
  const direct = DICO.get(t);
  if (direct !== undefined) return remplacer(direct);
  return remplacer(traduireLibre(t));
}

function traduireLibre(t) {
  const direct = DICO.get(t);
  if (direct !== undefined) return direct;
  // un « · » collé au début ou à la fin du texte : on le garde et on traduit le reste
  const bords = t.match(/^(· )?(.*?)( ·)?$/s);
  if ((bords[1] || bords[3]) && bords[2]) return `${bords[1] ?? ""}${traduireLibre(bords[2])}${bords[3] ?? ""}`;
  const u = t.match(REGLE_UNITE);
  if (u) return unite(+u[1], u[2]);
  if (typeof REGLES !== "undefined") {
    for (const [re, en, ar] of REGLES) {
      const m = t.match(re);
      if (m) {
        const modele = LANGUE === "en" ? en : ar;
        return modele.replace(/\$(\d)/g, (_, i) => traduireLibre(m[+i] ?? "")).replace(/\{u:(\d+):([^}]+)\}/g, (_, i, mot) => unite(+m[+i], mot));
      }
    }
  }
  // une icône ou un avertissement devant la phrase : on traduit la suite
  const prefixe = t.match(/^(⚠️|⚠|📁|✓|🌐|🏢|🔧|💳|📱|🏦|🧾|💵) (.+)$/);
  if (prefixe) return `${prefixe[1]} ${traduireLibre(prefixe[2])}`;
  // « A · B · C » : on traduit chaque morceau
  for (const sep of [" · ", " — ", " → ", " ; ", " : "]) {
    if (t.includes(sep)) return t.split(sep).map(traduireLibre).join(sep);
  }
  // le dinar et les kilomètres
  if (/\/jour\b/.test(t)) t = t.replace(/\/jour\b/g, LANGUE === "en" ? "/day" : "/اليوم");
  if (/\bDA\b/.test(t)) t = t.replace(/\bDA\b/g, LANGUE === "en" ? "DZD" : "د.ج");
  if (LANGUE === "ar" && /\bkm\b/.test(t)) t = t.replace(/\bkm\b/g, "كلم");
  return t;
}
const traduire = (t) => traduireTexte(t);

// ---------- Application au document ----------
const ATTRIBUTS_TRADUITS = ["placeholder", "title", "aria-label", "alt"];
const BALISES_IGNOREES = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE"]);

function traduireNoeud(noeud) {
  if (LANGUE === "fr") return;
  if (noeud.nodeType === Node.TEXT_NODE) {
    const parent = noeud.parentElement;
    if (!parent || BALISES_IGNOREES.has(parent.tagName) || parent.closest("[data-notr]")) return;
    const neuf = traduireTexte(noeud.nodeValue);
    if (neuf === noeud.nodeValue) return;
    // la valeur d'une liste déroulante doit rester en français : le code en dépend
    if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) parent.setAttribute("value", noeud.nodeValue.trim());
    noeud.nodeValue = neuf;
  } else if (noeud.nodeType === Node.ELEMENT_NODE) {
    if (noeud.hasAttribute("data-notr") || ["SCRIPT", "STYLE"].includes(noeud.tagName)) return;
    for (const a of ATTRIBUTS_TRADUITS) {
      const v = noeud.getAttribute(a);
      if (v) { const neuf = traduireTexte(v); if (neuf !== v) noeud.setAttribute(a, neuf); }
    }
    if (BALISES_IGNOREES.has(noeud.tagName)) return;
    // une option sans valeur explicite garde son texte français comme valeur
    if (noeud.tagName === "OPTION" && !noeud.hasAttribute("value")) noeud.setAttribute("value", noeud.textContent.trim());
    for (const enfant of noeud.childNodes) traduireNoeud(enfant);
  }
}

function demarrerTraduction() {
  if (LANGUE === "fr") return;
  document.title = traduireTexte(document.title);
  traduireNoeud(document.body);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") m.addedNodes.forEach(traduireNoeud);
      else if (m.type === "characterData") traduireNoeud(m.target);
      else if (m.type === "attributes") traduireNoeud(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTS_TRADUITS });
}


// ---------- Sélecteur de langue ----------
function brancherSelecteursLangue() {
  $$(".selecteur-langue").forEach((s) => {
    s.innerHTML = Object.entries(LANGUES).map(([k, n]) => `<option value="${k}" ${k === LANGUE ? "selected" : ""} data-notr>${n}</option>`).join("");
    s.addEventListener("change", () => changerLangue(s.value));
  });
}
