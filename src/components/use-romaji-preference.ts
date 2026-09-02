"use client";

import { useSyncExternalStore } from "react";

export const ROMAJI_PREFERENCE_KEY = "shiori.ui.showRomaji";
const changeEvent = "shiori-romaji-preference";
let fallback = false;
let storageUnavailable = false;

function snapshot() {
  if (storageUnavailable) return fallback;
  try { return window.localStorage.getItem(ROMAJI_PREFERENCE_KEY) === "true"; }
  catch { storageUnavailable = true; return fallback; }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changeEvent, listener);
  };
}

export function useRomajiPreference() {
  const shown = useSyncExternalStore(subscribe, snapshot, () => false);
  function toggle() {
    fallback = !shown;
    try { window.localStorage.setItem(ROMAJI_PREFERENCE_KEY, String(fallback)); }
    catch { storageUnavailable = true; /* Restricted storage still supports this tab. */ }
    window.dispatchEvent(new Event(changeEvent));
  }
  return [shown, toggle] as const;
}
