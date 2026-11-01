/* Thèmes de couleurs : noir (par défaut), blanc, rouge — choix mémorisé dans le navigateur. */
const THEMES = {
  noir: { fr: "⚫ Noir", en: "⚫ Black", ar: "⚫ أسود", barre: "#0a0a0b" },
  blanc: { fr: "⚪ Blanc", en: "⚪ White", ar: "⚪ أبيض", barre: "#f4f4f6" },
  rouge: { fr: "🔴 Rouge", en: "🔴 Red", ar: "🔴 أحمر", barre: "#2a0709" },
};
const THEME = (() => { try { const t = localStorage.getItem("chm_theme"); return THEMES[t] ? t : "noir"; } catch { return "noir"; } })();
document.documentElement.dataset.theme = THEME;
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[THEME].barre);

function changerTheme(theme) {
  try { localStorage.setItem("chm_theme", theme); } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme].barre);
  document.querySelectorAll(".selecteur-theme").forEach((s) => { s.value = theme; });
}

document.addEventListener("DOMContentLoaded", () => {
  const langue = THEMES.noir[document.documentElement.lang] ? document.documentElement.lang : "fr";
  document.querySelectorAll(".selecteur-theme").forEach((s) => {
    s.innerHTML = Object.entries(THEMES).map(([k, t]) => `<option value="${k}" ${k === THEME ? "selected" : ""} data-notr>${t[langue]}</option>`).join("");
    s.addEventListener("change", () => changerTheme(s.value));
  });
});
