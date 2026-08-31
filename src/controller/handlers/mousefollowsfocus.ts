import { Window } from "kwin-api";
import { QTimer } from "kwin-api/qt";
import { Workspace } from "kwin-api/qml";
import { DBus } from "../../extern";
import { config } from "..";

export class MouseFollowsFocusHandler {
    private workspace: Workspace;
    private timer: QTimer;
    private dbus: DBus;
    private watched: Window | null = null;
    private geometryChanged: () => void;

    constructor(workspace: Workspace, timer: QTimer, dbus: DBus) {
        this.workspace = workspace;
        this.timer = timer;
        this.dbus = dbus;
        this.geometryChanged = this.followGeometry.bind(this);
        this.timer.interval = config().mouseFollowsFocusDelay;
        this.timer.repeat = false;
        this.timer.triggered.connect(this.warp.bind(this));
    }

    windowActivated(window: Window | null) {
        if (window === null || window.specialWindow || window.popupWindow) {
            return;
        }
        if (this.watched !== window) {
            if (this.watched !== null) {
                this.watched.frameGeometryChanged.disconnect(
                    this.geometryChanged,
                );
            }
            this.watched = window;
            window.frameGeometryChanged.connect(this.geometryChanged);
        }
        // cursor already inside means a click or focus-follows-mouse put it
        // there; cancel any pending warp rather than leave it armed
        if (this.cursorInside(window)) {
            this.timer.stop();
            return;
        }
        this.timer.restart();
    }

    // the focused window moved out from under the cursor (a swap, a retile);
    // follow it once its geometry settles
    private followGeometry() {
        const watched = this.watched;
        if (watched === null || watched !== this.workspace.activeWindow) {
            this.timer.stop();
            return;
        }
        if (watched.move || watched.resize) {
            return;
        }
        this.timer.restart();
    }

    private cursorInside(window: Window): boolean {
        const pos = this.workspace.cursorPos;
        const geo = window.frameGeometry;
        return (
            pos.x >= geo.x &&
            pos.x < geo.x + geo.width &&
            pos.y >= geo.y &&
            pos.y < geo.y + geo.height
        );
    }

    private warp() {
        // warp to wherever focus actually is once geometry has settled,
        // never to a remembered window
        const target = this.workspace.activeWindow;
        if (target === null || target.specialWindow || target.popupWindow) {
            return;
        }
        if (this.cursorInside(target)) {
            return;
        }
        this.dbus.moveMouseToFocus().call();
    }
}
