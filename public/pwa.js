let deferredInstallPrompt = null;

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function showInstallButton() {
  if (isStandaloneMode() || document.getElementById('installAppButton')) return;
  const button = document.createElement('button');
  button.id = 'installAppButton';
  button.className = 'install-app-button';
  button.type = 'button';
  button.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i> Install Dia Shield';
  button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome !== 'accepted') button.classList.remove('is-visible');
    deferredInstallPrompt = null;
  });
  document.body.appendChild(button);
  requestAnimationFrame(() => button.classList.add('is-visible'));
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('installAppButton')?.remove();
});

function updateOfflineBanner() {
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    document.body.appendChild(banner);
  }
  banner.textContent = navigator.onLine
    ? 'Back online. Pending activity will sync automatically.'
    : 'You are offline. Cached lessons remain available; activity will sync when connection returns.';
  banner.classList.toggle('is-visible', !navigator.onLine);
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('DOMContentLoaded', updateOfflineBanner);

// Register Service Worker for PWA Capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((reg) => console.log('Service Worker Registered Successfully! Scope:', reg.scope))
      .catch((err) => console.error('Service Worker Registration Failed:', err));
  });
}
