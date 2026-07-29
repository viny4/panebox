/**
 * Built-in service catalog.
 *
 * Loaded both as a <script> in the renderer and via require() in the main
 * process, so it stays framework-free and side-effect-free.
 *
 * `color` is only used for the generated letter avatar shown until the service
 * reports its own favicon — we never call a third-party favicon API.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CATALOG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SERVICES = [
    // --- AI ---------------------------------------------------------------
    { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', category: 'AI', color: '#10a37f' },
    { key: 'claude', name: 'Claude', url: 'https://claude.ai', category: 'AI', color: '#d97757' },
    { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', category: 'AI', color: '#4285f4' },
    { key: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai', category: 'AI', color: '#20808d' },
    { key: 'grok', name: 'Grok', url: 'https://grok.com', category: 'AI', color: '#1d9bf0' },
    { key: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com', category: 'AI', color: '#0078d4' },
    { key: 'mistral', name: 'Le Chat', url: 'https://chat.mistral.ai', category: 'AI', color: '#fa520f' },
    { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', category: 'AI', color: '#4d6bfe' },
    { key: 'huggingface', name: 'HuggingFace', url: 'https://huggingface.co/chat', category: 'AI', color: '#ff9d00' },
    { key: 'napkin', name: 'NotebookLM', url: 'https://notebooklm.google.com', category: 'AI', color: '#1a73e8' },

    // --- Messaging --------------------------------------------------------
    { key: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com', category: 'Messaging', color: '#25d366' },
    { key: 'telegram', name: 'Telegram', url: 'https://web.telegram.org', category: 'Messaging', color: '#2aabee' },
    { key: 'slack', name: 'Slack', url: 'https://app.slack.com/client', category: 'Messaging', color: '#4a154b' },
    { key: 'discord', name: 'Discord', url: 'https://discord.com/app', category: 'Messaging', color: '#5865f2' },
    { key: 'messenger', name: 'Messenger', url: 'https://www.messenger.com', category: 'Messaging', color: '#0084ff' },
    { key: 'teams', name: 'Teams', url: 'https://teams.microsoft.com', category: 'Messaging', color: '#6264a7' },
    { key: 'signal', name: 'Signal', url: 'https://signal.org/download/', category: 'Messaging', color: '#3a76f0' },
    { key: 'googlechat', name: 'Google Chat', url: 'https://mail.google.com/chat/', category: 'Messaging', color: '#00ac47' },
    { key: 'element', name: 'Element', url: 'https://app.element.io', category: 'Messaging', color: '#0dbd8b' },
    { key: 'skype', name: 'Skype', url: 'https://web.skype.com', category: 'Messaging', color: '#00aff0' },

    // --- Mail & calendar --------------------------------------------------
    { key: 'gmail', name: 'Gmail', url: 'https://mail.google.com', category: 'Mail', color: '#ea4335' },
    { key: 'outlook', name: 'Outlook', url: 'https://outlook.live.com/mail/', category: 'Mail', color: '#0078d4' },
    { key: 'protonmail', name: 'Proton Mail', url: 'https://mail.proton.me', category: 'Mail', color: '#6d4aff' },
    { key: 'fastmail', name: 'Fastmail', url: 'https://app.fastmail.com', category: 'Mail', color: '#0067b9' },
    { key: 'gcalendar', name: 'Calendar', url: 'https://calendar.google.com', category: 'Mail', color: '#1a73e8' },

    // --- Social -----------------------------------------------------------
    { key: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com', category: 'Social', color: '#0a66c2' },
    { key: 'x', name: 'X', url: 'https://x.com', category: 'Social', color: '#000000' },
    { key: 'instagram', name: 'Instagram', url: 'https://www.instagram.com', category: 'Social', color: '#e4405f' },
    { key: 'facebook', name: 'Facebook', url: 'https://www.facebook.com', category: 'Social', color: '#1877f2' },
    { key: 'reddit', name: 'Reddit', url: 'https://www.reddit.com', category: 'Social', color: '#ff4500' },
    { key: 'bluesky', name: 'Bluesky', url: 'https://bsky.app', category: 'Social', color: '#0085ff' },
    { key: 'mastodon', name: 'Mastodon', url: 'https://mastodon.social', category: 'Social', color: '#6364ff' },
    { key: 'threads', name: 'Threads', url: 'https://www.threads.net', category: 'Social', color: '#000000' },

    // --- Productivity -----------------------------------------------------
    { key: 'notion', name: 'Notion', url: 'https://www.notion.so', category: 'Productivity', color: '#000000' },
    { key: 'linear', name: 'Linear', url: 'https://linear.app', category: 'Productivity', color: '#5e6ad2' },
    { key: 'trello', name: 'Trello', url: 'https://trello.com', category: 'Productivity', color: '#0079bf' },
    { key: 'asana', name: 'Asana', url: 'https://app.asana.com', category: 'Productivity', color: '#f06a6a' },
    { key: 'jira', name: 'Jira', url: 'https://www.atlassian.com/software/jira', category: 'Productivity', color: '#0052cc' },
    { key: 'obsidian', name: 'Obsidian', url: 'https://obsidian.md', category: 'Productivity', color: '#7c3aed' },
    { key: 'gdrive', name: 'Drive', url: 'https://drive.google.com', category: 'Productivity', color: '#1fa463' },
    { key: 'figma', name: 'Figma', url: 'https://www.figma.com/files', category: 'Productivity', color: '#f24e1e' },
    { key: 'canva', name: 'Canva', url: 'https://www.canva.com', category: 'Productivity', color: '#00c4cc' },

    // --- Developer --------------------------------------------------------
    { key: 'github', name: 'GitHub', url: 'https://github.com', category: 'Developer', color: '#ffffff' },
    { key: 'gitlab', name: 'GitLab', url: 'https://gitlab.com', category: 'Developer', color: '#fc6d26' },
    { key: 'vercel', name: 'Vercel', url: 'https://vercel.com/dashboard', category: 'Developer', color: '#ffffff' },
    { key: 'cloudflare', name: 'Cloudflare', url: 'https://dash.cloudflare.com', category: 'Developer', color: '#f38020' },
    { key: 'supabase', name: 'Supabase', url: 'https://supabase.com/dashboard', category: 'Developer', color: '#3ecf8e' },
    { key: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com', category: 'Developer', color: '#f48024' },

    // --- Media ------------------------------------------------------------
    { key: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', category: 'Media', color: '#ff0000' },
    { key: 'spotify', name: 'Spotify', url: 'https://open.spotify.com', category: 'Media', color: '#1db954' },
    { key: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', category: 'Media', color: '#9146ff' },
    { key: 'youtubemusic', name: 'YT Music', url: 'https://music.youtube.com', category: 'Media', color: '#ff0000' },
  ];

  const CATEGORIES = ['AI', 'Messaging', 'Mail', 'Social', 'Productivity', 'Developer', 'Media'];

  // Shipped on first launch. Deliberately AI-forward — that is the workspace
  // this app is built around; everything else is one click away in the catalog.
  const DEFAULT_KEYS = ['chatgpt', 'claude', 'gemini', 'perplexity', 'whatsapp', 'gmail'];

  function byKey(key) {
    return SERVICES.find((s) => s.key === key) || null;
  }

  return { SERVICES, CATEGORIES, DEFAULT_KEYS, byKey };
});
