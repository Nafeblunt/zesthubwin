// A deterministic text filter, not a link reputation or media scanning service.
const blockedWords = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'motherfucker', 'nigger', 'nigga', 'faggot', 'retard'];
const spacedWord = word => word.split('').join('[\\s._*\\-]*');
const profanity = new RegExp(`\\b(?:${blockedWords.map(spacedWord).join('|')})(?:s|ing|er|ers|ed)?\\b`, 'i');

export function chatFilterError(text) {
  const normalized = text.normalize('NFKD').replace(/\p{M}|[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '').toLowerCase();
  const plain = normalized.replace(/(?<=[a-z])!(?=[a-z])/g, 'i')
    .replace(/[013457@$]/g, character => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', '$': 's' })[character]);
  if (profanity.test(plain)) return 'Please keep chat respectful That message contains blocked language';
  if (/discord\s*(?:\.\s*gg|(?:\.\s*com|app\s*\.\s*com)\s*\/\s*invite)\b/i.test(normalized))
    return 'Discord invite advertising is not allowed in chat';
  if (/(?:javascript|vbscript|data|file)\s*:/i.test(normalized) || /\b(?:bit\.ly|tinyurl\.com|t\.co|shorturl\.at)\b/i.test(normalized))
    return 'That link is not allowed Share a direct HTTPS link instead';
  for (const match of normalized.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/g)) {
    try {
      const url = new URL(match[0].startsWith('www.') ? `https://${match[0]}` : match[0]);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' ||
          !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') ||
          /\.(?:exe|msi|bat|cmd|ps1|scr|com|js|vbs|jar)(?:$|[/?#])/i.test(decodeURIComponent(url.pathname)))
        return 'That link is not allowed Share a direct HTTPS link instead';
    } catch { return 'Please check the link in your message'; }
  }
  return null;
}
