export const HABIT_APP_URL = (
  import.meta.env.VITE_HABIT_APP_URL || "http://localhost:7071"
).replace(/\/$/, "");

export const POMODORO_APP_URL = (
  import.meta.env.VITE_POMODORO_APP_URL || "http://localhost:8081"
).replace(/\/$/, "");

let isRedirecting = false;

export function getLoginUrl(returnTo?: string): string {
  const target =
    returnTo ??
    `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${HABIT_APP_URL}/login?returnTo=${encodeURIComponent(target)}`;
}

export function redirectToLogin(returnTo?: string): void {
  if (isRedirecting) return;
  isRedirecting = true;
  window.location.replace(getLoginUrl(returnTo));
}
