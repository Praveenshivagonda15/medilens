

let reminderTimer = null;

export function isNotificationSupported() {
  return 'Notification' in window;
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'denied';
  return await Notification.requestPermission();
}

export function getNotificationPermissionState() {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export function triggerInstantNotification(title, options = {}) {
  if (getNotificationPermissionState() !== 'granted') return;
  
  try {
    const defaultOptions = {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'medilens-reminder',
      renotify: true,
      ...options
    };
    new Notification(title, defaultOptions);
  } catch (err) {
    console.error("Failed to fire browser notification:", err);
  }
}

export function startReminderLoop(cabinetItems, timeSettings, onDoseTriggered) {
  if (reminderTimer) {
    clearInterval(reminderTimer);
  }

  const defaultTimes = {
    Morning: '08:00',
    Afternoon: '13:00',
    Evening: '18:00',
    Bedtime: '22:00',
    ...timeSettings
  };

  reminderTimer = setInterval(() => {
    const now = new Date();
    const currentHM = now.toTimeString().substring(0, 5);

    const slotsToFire = [];
    for (const [slot, timeStr] of Object.entries(defaultTimes)) {
      if (currentHM === timeStr) {
        slotsToFire.push(slot);
      }
    }

    if (slotsToFire.length === 0) return;

    cabinetItems.forEach(item => {

      const itemSlot = item.meta?.idealTime || 'Morning';
      if (slotsToFire.includes(itemSlot) && item.notificationsEnabled) {
        const title = `MediLens Medicine Reminder: ${item.brandName}`;
        const body = `It's time to take your dose of ${item.brandName} (${item.saltComposition}).\nGuideline: ${item.meta?.foodRelation || 'With or without food'}.`;
        
        triggerInstantNotification(title, { body });
        
        if (onDoseTriggered) {
          onDoseTriggered(item, itemSlot);
        }
      }
    });
  }, 60000);
}

export function stopReminderLoop() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}
