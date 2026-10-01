import { useEffect } from 'react';

// Official splash: uploaded logo (unmodified), app name, and the exact one-line credit.
export default function Splash({ onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 2200); return () => clearTimeout(id); }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <img src="/brand/logo.webp" alt="MAVRIX FIRE" width="300" height="272" />
      <h1>MAVRIX FIRE</h1>
      <div className="from">from SAYRIX MATHAV</div>
    </div>
  );
}
