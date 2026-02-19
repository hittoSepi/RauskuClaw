import { computed, ref } from "vue";
import { api } from "./api.js";

const authLoading = ref(false);
const authError = ref("");
const authInfo = ref(null);

const authRole = computed(() => String(authInfo.value?.role || "").trim().toLowerCase() || "unknown");
const isReadOnly = computed(() => authRole.value === "read");
const queueAllowlist = computed(() => {
  const raw = authInfo.value?.queue_allowlist;
  if (!Array.isArray(raw)) return null;
  const out = raw.map((x) => String(x || "").trim()).filter(Boolean);
  return out.length > 0 ? out : null;
});

export async function refreshAuthState() {
  authLoading.value = true;
  authError.value = "";
  try {
    const out = await api.authWhoami();
    authInfo.value = out?.auth || null;
  } catch (e) {
    authInfo.value = null;
    authError.value = e?.message || String(e);
  } finally {
    authLoading.value = false;
  }
}

export function useAuthState() {
  return {
    authInfo,
    authRole,
    queueAllowlist,
    authLoading,
    authError,
    isReadOnly
  };
}
