import { useState } from 'react';
import { Share, SquarePlus, X } from 'lucide-react';

const KEY = 'orrery-install-hint-dismissed';

/** iOS never offers to install web apps, so tell iPhone and iPad users how. */
function shouldShow() {
  if ('__TAURI_INTERNALS__' in window) return false;
  if (new URLSearchParams(location.search).has('install-hint')) return true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(KEY) === '1';
  } catch {
    /* storage unavailable */
  }
  return ios && !installed && !dismissed;
}

export function InstallHint() {
  const [show, setShow] = useState(shouldShow);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="install-hint" role="dialog" aria-label="Install Orrery">
      <img src="/apple-touch-icon.png" alt="" />
      <div className="install-text">
        <strong>Install Orrery</strong>
        <span>
          Tap <Share size={15} aria-label="Share" /> then <b>Add to Home Screen</b> <SquarePlus size={15} aria-hidden /> to use it like an app, even offline.
        </span>
      </div>
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">
        <X size={18} />
      </button>
    </div>
  );
}
