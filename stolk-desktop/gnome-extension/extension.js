// Stölk side panel: while settings.json says panel=true and the Stölk window is open, reserve a strip on the
// right of its screen (a strut, so maximized windows and tiling use only the rest) and put Stölk in it.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const WIDTH = 440;

export default class StolkPanel extends Extension {
  enable() {
    this._file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), 'Stölk', 'settings.json']));
    this._fileMonitor = this._file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    this._fileMonitor.connect('changed', () => this._queue());
    this._ids = [
      [global.display, global.display.connect('window-created', () => this._queue())],
      [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._queue())],
    ];
    this._queue();
  }

  disable() {
    if (this._timeout) GLib.source_remove(this._timeout);
    this._timeout = 0;
    this._fileMonitor.cancel();
    for (const [obj, id] of this._ids) obj.disconnect(id);
    this._watch(null);
    this._release();
  }

  // Windows get their class and size a moment after they appear, so sync shortly after any event.
  _queue() {
    if (this._timeout) return;
    this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => { this._timeout = 0; this._sync(); return GLib.SOURCE_REMOVE; });
  }

  _panelOn() {
    try { return !!JSON.parse(new TextDecoder().decode(this._file.load_contents(null)[1])).panel; } catch { return false; }
  }

  _stolkWindow() {
    return global.get_window_actors().map((a) => a.meta_window)
      .find((w) => (w.get_wm_class() || '').toLowerCase() === 'stolk' && w.get_window_type() === Meta.WindowType.NORMAL);
  }

  // Follow the window: hiding Stölk (closing it to the tray) frees the strip again.
  _watch(win) {
    if (this._win === win) return;
    if (this._win) for (const id of this._winIds) this._win.disconnect(id);
    this._win = win;
    this._winIds = win ? ['unmanaged', 'notify::minimized'].map((s) => win.connect(s, () => this._queue())) : [];
  }

  _sync() {
    const win = this._stolkWindow();
    this._watch(win || null);
    if (!win || win.minimized || !this._panelOn()) { this._release(); return; }
    const m = Main.layoutManager.monitors[win.get_monitor()] || Main.layoutManager.primaryMonitor;
    if (!this._strut) {
      this._strut = new St.Widget({ reactive: false });
      Main.layoutManager.addChrome(this._strut, { affectsStruts: true, affectsInputRegion: false, trackFullscreen: true });
    }
    this._strut.set_position(m.x + m.width - WIDTH, m.y);
    this._strut.set_size(WIDTH, m.height);
    // The work area shrinks on the next layout pass; place Stölk after it.
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      const wa = Main.layoutManager.getWorkAreaForMonitor(m.index);
      if (win.get_maximized()) win.unmaximize(Meta.MaximizeFlags.BOTH);
      win.make_above();
      win.stick();
      win.move_resize_frame(true, m.x + m.width - WIDTH, wa.y, WIDTH, wa.height);
      return GLib.SOURCE_REMOVE;
    });
  }

  _release() {
    if (!this._strut) return;
    Main.layoutManager.removeChrome(this._strut);
    this._strut.destroy();
    this._strut = null;
    if (this._win && !this._panelOn()) { this._win.unmake_above(); this._win.unstick(); }
  }
}
