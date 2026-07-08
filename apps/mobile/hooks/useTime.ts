import { useState, useEffect } from 'react';

export function useTime(intervalMs = 1000) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return time;
}
