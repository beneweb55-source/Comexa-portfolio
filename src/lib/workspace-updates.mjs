/** Invalidation après confirmation serveur, jamais sur une écriture échouée. */
export const WORKSPACE_UPDATED = "comexa:workspace-updated";

export function isWorkspaceMutation(method = "GET") {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function notifyWorkspaceUpdate(path, options = {}) {
  if (typeof window !== "undefined" && isWorkspaceMutation(options.method)) {
    window.dispatchEvent(new CustomEvent(WORKSPACE_UPDATED, { detail: { path, space: options.space } }));
  }
}
