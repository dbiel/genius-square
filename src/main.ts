import './style.css';
import { App } from './ui/app';

// Safari ignores user-scalable=no; block pinch-zoom gestures explicitly.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

new App(document.querySelector<HTMLDivElement>('#app')!);
