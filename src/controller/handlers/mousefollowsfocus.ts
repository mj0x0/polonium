import { Window } from "kwin-api";
import { QTimer } from "kwin-api/qt";
import { Workspace } from "kwin-api/qml";
import { DBus } from "../../extern";
import { config } from "..";

export class MouseFollowsFocusHandler {
    private workspace: Workspace;
    private timer: QTimer;
    private dbus: DBus;
    private target: Window | null = null;
    private geometryChanged: () => void;

    constructor(workspace: Workspace, timer: QTimer, dbus: DBus) {
        this.workspace = workspace;
        this.timer = timer;
        this.dbus = dbus;
        this.geometryChanged = this.restartTimer.bind(this);
        this.timer.interval = config().mouseFollowsFocusDelay;
        this.timer.repeat = false;
        this.timer.triggered.connect(this.warp.bind(this));
    }

    windowActivated(window: Window | null) {
        if (window === null || window.specialWindow || window.popupWindow) {
            return;
        }
        // cursor already inside means a click or focus-follows-mouse put it
        // there; cancel any pending warp rather than leave it armed
        if (this.cursorInside(window)) {
            this.clearTarget();
            return;
        }
        if (this.target !== window) {
            this.clearTarget();
            this.target = window;
            window.frameGeometryChanged.connect(this.geometryChanged);
        }
        this.timer.restart();
    }

    private restartTimer() {
        // geometry changes only delay a warp while the target stays focused;
        // they never justify one on their own
        if (this.target !== this.workspace.activeWindow) {
            this.clearTarget();
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

    private clearTarget() {
        if (this.target !== null) {
            this.target.frameGeometryChanged.disconnect(this.geometryChanged);
            this.target = null;
        }
        this.timer.stop();
    }

    private warp() {
        this.clearTarget();
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
