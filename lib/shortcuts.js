/**
 * Every shortcut and gesture in the app, in one place.
 *
 * This is what the Settings → Shortcuts tab renders. A test checks that every
 * accelerator declared in the application menu appears here, so the list
 * cannot quietly fall out of date with the real bindings.
 *
 * Keys are tokens rather than rendered strings: "mod" becomes ⌘ on macOS and
 * Ctrl everywhere else.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHORTCUTS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SECTIONS = [
    {
      title: 'Services',
      items: [
        { keys: ['mod', '1'], label: 'Jump to the first service (1–9)' },
        { keys: ['mod', 'Tab'], label: 'Next service' },
        { keys: ['mod', 'shift', 'Tab'], label: 'Previous service' },
        { keys: ['mod', 'N'], label: 'Add a service' },
        { keys: ['mod', 'R'], label: 'Reload the current service' },
      ],
    },
    {
      title: 'Layout',
      items: [
        { keys: ['mod', 'shift', 'S'], label: 'Split view — several services at once' },
        { keys: ['mod', 'B'], label: 'Show or hide the sidebar' },
        { keys: ['mod', 'T'], label: 'Todo panel' },
        { keys: ['Esc'], label: 'Step back: close a menu, then the spotlight, then the grid' },
      ],
    },
    {
      title: 'Window',
      items: [
        { keys: ['mod', 'F'], label: 'Find in page' },
        { keys: ['mod', ','], label: 'Settings' },
        { keys: ['mod', 'shift', 'M'], label: 'Task manager' },
        { keys: ['mod', 'shift', 'R'], label: 'Restart Panebox' },
        { keys: ['alt', 'mod', 'I'], label: 'Developer tools', mac: true },
        { keys: ['ctrl', 'shift', 'I'], label: 'Developer tools', win: true },
        { keys: ['mod', 'ctrl', 'F'], label: 'Full screen', mac: true },
        { keys: ['mod', 'Q'], label: 'Quit', mac: true },
      ],
    },
    {
      title: 'Mouse',
      mouse: true,
      items: [
        { gesture: 'Right-click a sidebar icon', label: 'Configure that service' },
        { gesture: 'Drag a sidebar icon', label: 'Reorder your services' },
        { gesture: 'Drag a sidebar icon onto the grid', label: 'Add it as a pane' },
        { gesture: 'Click a sidebar icon while in split view', label: 'Add or remove that pane' },
        { gesture: 'Double-click a pane header', label: 'Expand that pane' },
        { gesture: 'Triple-click a pane header', label: 'Open that service on its own' },
        { gesture: 'Drag the ⠿ handle in Settings → Services', label: 'Reorder your services' },
      ],
    },
  ];

  const MAC_SYMBOLS = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', Esc: 'esc', Tab: '⇥' };
  const PC_SYMBOLS = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', Esc: 'Esc', Tab: 'Tab' };

  /** Renders one key token for the given platform. */
  function keyLabel(token, isMac) {
    const table = isMac ? MAC_SYMBOLS : PC_SYMBOLS;
    return table[token] || token;
  }

  /** The sections that apply to a platform, with mac-only rows filtered out. */
  function forPlatform(platform) {
    const isMac = platform === 'darwin';
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => (item.mac ? isMac : item.win ? !isMac : true)),
    })).filter((section) => section.items.length);
  }

  return { SECTIONS, forPlatform, keyLabel };
});
