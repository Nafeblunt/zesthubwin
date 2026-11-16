export const games = Object.freeze({
  cs2: { name: 'Counter-Strike 2', objectKey: 'ZestHub.dll' },
  fallout76: { name: 'Fallout 76', objectKey: 'Fallout76ESP.dll' }
});
export function gameFor(id = 'cs2') {
  return typeof id === 'string' && Object.hasOwn(games, id) ? games[id] : null;
}
