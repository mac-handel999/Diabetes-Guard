// Register Service Worker for PWA Capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => console.log('Service Worker Registered Successfully! Scope:', reg.scope))
      .catch((err) => console.error('Service Worker Registration Failed:', err));
  });
}