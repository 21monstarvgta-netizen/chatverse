// Chat helper module (imported by app.js)
// Additional chat utilities can go here

// Auto-linkify URLs in messages
function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener" style="color:var(--primary-light)">$1</a>');
}

// Format message with basic markdown-like syntax
function formatMessage(text) {
  let formatted = escapeHTML(text);
  
  // Bold **text**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic *text*
  formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Code `text`
  formatted = formatted.replace(/`(.*?)`/g, '<code style="background:var(--bg-input);padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>');
  
  // Linkify
  formatted = linkify(formatted);
  
  return formatted;
}