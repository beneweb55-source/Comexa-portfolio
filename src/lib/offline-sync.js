"use client";

import { ApiError, offlineResourceKey } from "@/lib/api";

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function replaceMappedIds(value, mappings) {
  if (typeof value === "string") {
    return Object.entries(mappings)
      .sort(([a], [b]) => b.length - a.length)
      .reduce((result, [localId, serverId]) => result.split(localId).join(serverId), value);
  }
  if (Array.isArray(value)) return value.map((item) => replaceMappedIds(item, mappings));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMappedIds(item, mappings)]));
  }
  return value;
}

function equal(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function conflictingFields(operation, server) {
  const base = operation.baseSnapshot;
  if (!base || !server) return ["version-unknown"];
  if (operation.method === "DELETE") {
    const excluded = new Set(["updatedAt", "updated_at", "lastActivityAt"]);
    return Object.keys(base).filter((key) => !excluded.has(key) && !equal(base[key], server[key]));
  }
  const patch = operation.body && typeof operation.body === "object" ? operation.body : {};
  return Object.keys(patch).filter((field) =>
    !equal(base[field], server[field]) && !equal(patch[field], server[field]),
  );
}

function goalIdOf(task) {
  return task?.goalId ?? task?.goal?.id ?? null;
}

async function rebaseDependentOperations(bridge, userId, operations, parentId) {
  if (!operations.some((operation) => operation.dependsOn.includes(parentId))) return;
  const refreshed = await bridge.listPending({ userId, includeFailed: true });
  const byId = new Map(refreshed.map((operation) => [operation.operationId, operation]));
  for (let index = 0; index < operations.length; index += 1) {
    const current = byId.get(operations[index].operationId);
    if (current) Object.assign(operations[index], current);
  }
}

async function apiRequest(path, { token, space, method = "GET", body, idempotencyKey, headers: extraHeaders = {} } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(space ? { "X-Comexa-Space": space } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey, "X-Comexa-Offline-Operation": "true" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await response.text();
  let envelope = null;
  try { envelope = text ? JSON.parse(text) : null; } catch {}
  return { response, envelope };
}

async function refreshCachedViews(bridge, userId, token, mappings) {
  const entries = await bridge.listCached({ userId });
  let refreshed = 0;
  let revoked = 0;
  // A bounded batch avoids flooding the shared API after a long disconnect. The
  // oldest still-valid views remain available locally and are refreshed on use.
  for (const entry of entries.slice(0, 100)) {
    const requestKey = replaceMappedIds(entry.requestKey, mappings);
    if (requestKey !== entry.requestKey) {
      await bridge.renameCachedRequest({ userId, space: entry.space, oldRequestKey: entry.requestKey, newRequestKey: requestKey });
    }
    try {
      const { response, envelope } = await apiRequest(requestKey, { token, space: entry.space });
      if (response.status === 401) throw new ApiError(401, "UNAUTHENTICATED", "La session doit être renouvelée avant la synchronisation.");
      if (response.status === 403 || response.status === 404) {
        await bridge.deleteCacheEntry({ userId, space: entry.space, requestKey });
        revoked += 1;
        continue;
      }
      if (response.ok && envelope?.success === true) {
        await bridge.cacheResponse({ userId, space: entry.space, requestKey, response: envelope, resourceKey: offlineResourceKey(requestKey) || entry.resourceKey });
        refreshed += 1;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      // A failed refresh never removes the last encrypted copy.
    }
    await wait(8);
  }
  return { refreshed, revoked };
}

export async function synchronizeOfflineWork({ userId, token, bridge, refreshViews = true }) {
  if (!bridge || !userId || !token) throw new Error("Une session serveur active est nécessaire pour synchroniser.");
  const { response: sessionResponse, envelope: sessionEnvelope } = await apiRequest("/auth/me", { token });
  if (!sessionResponse.ok || sessionEnvelope?.success !== true) throw new ApiError(sessionResponse.status, "SYNC_AUTH_FAILED", "La session serveur ne permet pas de synchroniser.");
  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  const refreshedBefore = refreshViews
    ? await refreshCachedViews(bridge, userId, token, await bridge.listIdMappings({ userId }))
    : { refreshed: 0, revoked: 0 };
  let operations = await bridge.listPending({ userId, includeFailed: true });
  const now = Date.now();

  for (const operation of operations) {
    if (operation.state === "conflict" || operation.nextAttemptAt > now || operation.dependsOn.length) continue;
    const mappings = await bridge.listIdMappings({ userId });
    const path = replaceMappedIds(operation.path, mappings);
    const body = replaceMappedIds(operation.body, mappings);

    if (operation.method !== "POST") {
      const resolvedId = replaceMappedIds(operation.entityId, mappings);
      if (operation.baseRequestKey) {
        const baselinePath = replaceMappedIds(operation.baseRequestKey, mappings);
        let baselineError = null;
        let baselineStatus = 0;
        try {
          const { response: baselineResponse, envelope: baselineEnvelope } = await apiRequest(baselinePath, { token, space: operation.space });
          baselineStatus = baselineResponse.status;
          if (baselineStatus === 401) throw new ApiError(401, "UNAUTHENTICATED", "La session doit être renouvelée avant la synchronisation.");
          if (baselineStatus === 403) {
            await bridge.deleteCacheEntry({ userId, space: operation.space, requestKey: baselinePath });
            baselineError = "Le serveur ne vous autorise plus à consulter cette donnée. Votre modification reste conservée.";
          } else if (baselineStatus === 404) {
            await bridge.deleteCacheEntry({ userId, space: operation.space, requestKey: baselinePath });
          } else if (baselineResponse.ok && baselineEnvelope?.success === true) {
            await bridge.cacheResponse({ userId, space: operation.space, requestKey: baselinePath, response: baselineEnvelope, resourceKey: offlineResourceKey(baselinePath) });
          } else {
            baselineError = baselineEnvelope?.error?.message || `La version serveur n'a pas pu être vérifiée (${baselineStatus}).`;
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          baselineError = error?.message || "La version serveur n'a pas pu être vérifiée.";
        }
        if (baselineError) {
          const transient = baselineStatus === 0 || TRANSIENT_STATUSES.has(baselineStatus);
          const attempts = operation.attempts + 1;
          await bridge.updateOperation({ userId, operationId: operation.operationId, state: transient ? "pending" : "failed", lastError: baselineError, nextAttemptAt: transient ? Date.now() + Math.min(30_000 * 2 ** Math.min(attempts, 6), 30 * 60_000) : 0 });
          failed += 1;
          if (transient) break;
          continue;
        }
      }
      const remote = await bridge.findCachedEntity({ userId, space: operation.space, entityId: resolvedId });
      const server = remote?.entity ?? null;
      if (operation.entityType === "goal-task-link") {
        const desiredGoalId = operation.localResult?.goalId ?? null;
        if (!server) {
          await bridge.recordConflict({ userId, operationId: operation.operationId, serverSnapshot: null, changedFields: ["goal"], message: "La tâche n'est plus accessible ; le rattachement local est conservé." });
          conflicts += 1;
          continue;
        }
        const serverGoalId = goalIdOf(server);
        if (serverGoalId === desiredGoalId) {
          await bridge.updateOperation({ userId, operationId: operation.operationId, state: "synced", serverResult: { data: server } });
          synced += 1;
          await rebaseDependentOperations(bridge, userId, operations, operation.operationId);
          continue;
        }
        if (!operation.baseSnapshot || goalIdOf(operation.baseSnapshot) !== serverGoalId) {
          await bridge.recordConflict({ userId, operationId: operation.operationId, serverSnapshot: server, changedFields: ["goal"], message: "Cette tâche a été rattachée à un autre objectif depuis sa dernière synchronisation." });
          conflicts += 1;
          continue;
        }
      }
      const fields = conflictingFields({ ...operation, body }, server);
      if (fields.length) {
        await bridge.recordConflict({ userId, operationId: operation.operationId, serverSnapshot: server, changedFields: fields, message: "La version du serveur a changé sur les champs concernés." });
        conflicts += 1;
        continue;
      }
    }

    await bridge.updateOperation({ userId, operationId: operation.operationId, state: "in_progress" });
    try {
      const headers = operation.baseVersion && operation.method !== "POST"
        ? { "If-Match": `\"${operation.baseVersion}\"` }
        : {};
      const { response, envelope } = await apiRequest(path, {
        token,
        space: operation.space,
        method: operation.method,
        body,
        idempotencyKey: operation.idempotencyKey,
        headers,
      });
      if (response.ok && envelope?.success === true) {
        let confirmedResult = envelope;
        if (operation.entityType === "goal-task-link" && operation.baseRequestKey) {
          const taskPath = replaceMappedIds(operation.baseRequestKey, mappings);
          const { response: taskResponse, envelope: taskEnvelope } = await apiRequest(taskPath, { token, space: operation.space });
          if (!taskResponse.ok || taskEnvelope?.success !== true) {
            const attempts = operation.attempts + 1;
            await bridge.updateOperation({ userId, operationId: operation.operationId, state: "pending", lastError: "La modification est acceptée, mais sa version serveur n'a pas encore pu être confirmée. Elle sera vérifiée avec la même clé.", nextAttemptAt: Date.now() + Math.min(30_000 * 2 ** Math.min(attempts, 6), 30 * 60_000) });
            failed += 1;
            break;
          }
          await bridge.cacheResponse({ userId, space: operation.space, requestKey: taskPath, response: taskEnvelope, resourceKey: "personal-tasks" });
          const confirmedTask = await bridge.findCachedEntity({ userId, space: operation.space, entityId: replaceMappedIds(operation.entityId, mappings) });
          if (!confirmedTask?.entity) {
            await bridge.updateOperation({ userId, operationId: operation.operationId, state: "pending", lastError: "La version serveur de la tâche n'a pas été trouvée après l'enregistrement.", nextAttemptAt: Date.now() + 30_000 });
            failed += 1;
            break;
          }
          confirmedResult = { ...taskEnvelope, data: confirmedTask.entity };
        }
        await bridge.updateOperation({ userId, operationId: operation.operationId, state: "synced", serverResult: confirmedResult });
        synced += 1;
        await rebaseDependentOperations(bridge, userId, operations, operation.operationId);
      } else if (response.status === 409 && envelope?.error?.code === "IDEMPOTENCY_OPERATION_IN_PROGRESS") {
        await bridge.updateOperation({ userId, operationId: operation.operationId, state: "failed", lastError: envelope.error.message || "Le serveur doit vérifier une opération commencée avant son interruption. Votre version locale est conservée.", nextAttemptAt: 0 });
        failed += 1;
      } else if (response.status === 409 || response.status === 412) {
        const entityId = replaceMappedIds(operation.entityId, mappings);
        if (operation.baseRequestKey) {
          const { response: latestResponse, envelope: latestEnvelope } = await apiRequest(replaceMappedIds(operation.baseRequestKey, mappings), { token, space: operation.space });
          if (latestResponse.ok && latestEnvelope?.success === true) {
            await bridge.cacheResponse({ userId, space: operation.space, requestKey: replaceMappedIds(operation.baseRequestKey, mappings), response: latestEnvelope, resourceKey: operation.resourceKey });
          }
        }
        const current = await bridge.findCachedEntity({ userId, space: operation.space, entityId });
        await bridge.recordConflict({ userId, operationId: operation.operationId, serverSnapshot: current?.entity ?? envelope?.error?.details ?? null, changedFields: Object.keys(body ?? {}), message: envelope?.error?.message || "Conflit signalé par le serveur." });
        conflicts += 1;
      } else if (TRANSIENT_STATUSES.has(response.status) || response.status === 0) {
        const attempts = operation.attempts + 1;
        const retryAt = Date.now() + Math.min(30_000 * 2 ** Math.min(attempts, 6), 30 * 60_000);
        await bridge.updateOperation({ userId, operationId: operation.operationId, state: "pending", lastError: envelope?.error?.message || "Le serveur est temporairement indisponible.", nextAttemptAt: retryAt });
        failed += 1;
        break;
      } else {
        await bridge.updateOperation({ userId, operationId: operation.operationId, state: "failed", lastError: envelope?.error?.message || `Refus du serveur (${response.status}).`, nextAttemptAt: 0 });
        failed += 1;
      }
    } catch (error) {
      const attempts = operation.attempts + 1;
      const retryAt = Date.now() + Math.min(30_000 * 2 ** Math.min(attempts, 6), 30 * 60_000);
      await bridge.updateOperation({ userId, operationId: operation.operationId, state: "pending", lastError: error?.message || "La synchronisation a été interrompue.", nextAttemptAt: retryAt });
      failed += 1;
      break;
    }
  }

  const refreshedAfter = refreshViews || synced > 0
    ? await refreshCachedViews(bridge, userId, token, await bridge.listIdMappings({ userId }))
    : { refreshed: 0, revoked: 0 };
  const cacheEntries = await bridge.listCached({ userId });
  const spaces = new Set([...operations.map((item) => item.space), ...cacheEntries.slice(0, 100).map((item) => item.space)]);
  if (!spaces.size) spaces.add("");
  for (const space of spaces) await bridge.markSyncSuccess({ userId, space });
  return {
    synced,
    conflicts,
    failed,
    refreshed: refreshedBefore.refreshed + refreshedAfter.refreshed,
    revoked: refreshedBefore.revoked + refreshedAfter.revoked,
    status: await bridge.status({ userId }),
  };
}
