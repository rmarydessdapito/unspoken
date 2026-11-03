/**
 * Gentle notifications: daily reminders and future-me unlocks.
 *
 * Without a push server, the web can only notify while unspoken is open or running in the background
 * (an open tab or installed app that the OS hasn't suspended). We check every minute while open and on
 * every launch, so nothing is ever missed — an unlock that happened while the app was closed shows up
 * the next time you open it.
 */
import { REMINDER_LINES } from './prompts';

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export async function askNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export async function notify(title: string, body: string, url = '/') {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, icon: '/icon.svg', badge: '/icon.svg', data: { url }, tag: url });
      return;
    }
  } catch {
    /* fall back below */
  }
  try {
    new Notification(title, { body, icon: '/icon.svg' });
  } catch {
    /* some mobile browsers only allow service worker notifications */
  }
}

export function reminderLine(date = new Date()): string {
  return REMINDER_LINES[date.getDate() % REMINDER_LINES.length];
}

/** Is it time for today's reminder? reminderTime is "HH:MM". */
export function reminderDue(reminderTime: string, lastDate: string | null, todayKey: string, now = new Date()): boolean {
  if (lastDate === todayKey) return false;
  const [h, m] = reminderTime.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}
