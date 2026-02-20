'use client';

import { useEffect } from 'react';

export default function PlexCallbackPage() {
  useEffect(() => {
    window.close();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground text-sm">Authentication complete. Closing window…</p>
    </div>
  );
}
