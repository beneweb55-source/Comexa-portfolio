/** Only web URLs are rendered as links; workflow text is never trusted HTML. */
export function consoleLink(raw) {
  if (typeof raw !== "string" || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  const base = "https://comexa-portfolio.vercel.app";
  if (!/^https?:\/\//i.test(raw) && !/^\/(?!\/)/.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (url.username || url.password) return null;
    const internal = url.origin === base;
    // The dashboard has a task board, not a /taches/[id] detail page.
    const task = internal && url.pathname.match(/^\/espace-equipe\/taches\/([^/]+)\/?$/);
    if (task) {
      url.pathname = "/espace-equipe/taches";
      url.searchParams.set("tache", decodeURIComponent(task[1]));
    }
    return { href: internal ? `${url.pathname}${url.search}${url.hash}` : url.href, internal };
  } catch {
    return null;
  }
}

export function operationDetails(proposed) {
  const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    label: text(proposed?.summary) ?? text(proposed?.label) ?? text(proposed?.description),
    entityName: text(proposed?.entity?.name),
    consequences: text(proposed?.consequences),
  };
}
