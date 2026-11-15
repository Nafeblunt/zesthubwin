function zestTimeAgo(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.floor(now / 1000 - timestamp));
  for (const [unit, length] of [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60]
  ]) {
    if (seconds < length) continue;
    const amount = Math.floor(seconds / length);
    return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
  }
  return 'Just now';
}
