import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/ui';

export function DialogHost() {
  const dialog = useUI((s) => s.dialog);
  const set = useUI((s) => s.set);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.kind === 'prompt') {
      setValue(dialog.value);
      setTimeout(() => input.current?.select(), 0);
    }
  }, [dialog]);

  if (!dialog) return null;

  const finish = (result: unknown) => {
    set({ dialog: null });
    (dialog.resolve as (v: unknown) => void)(result);
  };
  const cancel = () => finish(dialog.kind === 'confirm' ? false : null);

  return (
    <div className="overlay" onMouseDown={cancel} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
      <div className={`dialog ${dialog.kind}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={dialog.title}>
        <h3>{dialog.title}</h3>
        {dialog.kind === 'prompt' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              finish(value);
            }}
          >
            <input ref={input} value={value} placeholder={dialog.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn primary">{dialog.confirm}</button>
            </div>
          </form>
        )}
        {dialog.kind === 'confirm' && (
          <>
            <p className="muted">{dialog.message}</p>
            <div className="dialog-actions">
              {dialog.confirm !== 'OK' && <button className="btn" onClick={cancel}>Cancel</button>}
              <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)} autoFocus>
                {dialog.confirm}
              </button>
            </div>
          </>
        )}
        {dialog.kind === 'menu' && (
          <div className="menu-items">
            {dialog.items.map((item, i) => (
              <button key={item.label} className={`menu-item ${item.danger ? 'danger' : ''}`} onClick={() => finish(i)} autoFocus={i === 0}>
                {item.label}
              </button>
            ))}
            <button className="menu-item cancel" onClick={cancel}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
