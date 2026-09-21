import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';

// Safari ignores user-scalable=no; block pinch-zoom gestures explicitly.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

new App(document.querySelector<HTMLDivElement>('#app')!);

// Keep the installed app current: check for a new build every minute and whenever
// the app comes back to the foreground; autoUpdate mode reloads when one takes over.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => void registration.update().catch(() => undefined);
    setInterval(check, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
