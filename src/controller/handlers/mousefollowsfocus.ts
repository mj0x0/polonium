import { Window } from "kwin-api";
import { QPoint, QTimer } from "kwin-api/qt";
import { Workspace } from "kwin-api/qml";
import { DBus } from "../../extern";
import { config } from "..";

export class MouseFollowsFocusHandler {
    private workspace: Workspace;
    private timer: QTimer;
    private dbus: DBus;
    // last window activated with the cursor elsewhere - a keyboard focus
    // change the warp may need to defend from focus-follows-mouse
    private target: Window | null = null;
    private armPos: QPoint | null = null;

    constructor(workspace: Workspace, timer: QTimer, dbus: DBus) {
        this.workspace = workspace;
        this.timer = timer;
        this.dbus = dbus;
        this.timer.interval = config().mouseFollowsFocusDelay;
        this.timer.repeat = false;
        this.timer.triggered.connect(this.warp.bind(this));
    }

    windowActivated(window: Window | null) {
        if (window === null || window.specialWindow || window.popupWindow) {
            return;
        }
        if (this.cursorInside(window)) {
            // focus landed under a stationary cursor on its own - that is
            // focus-follows-mouse reverting a keyboard focus change, so keep
            // the pending warp. a moved cursor means the user did it
            if (this.target !== null && !this.cursorMoved()) {
                return;
            }
            this.target = null;
            this.armPos = null;
            this.timer.stop();
            return;
        }
        this.target = window;
        this.armPos = this.workspace.cursorPos;
        this.timer.restart();
    }

    // called by the controller after rebuilding layouts; a retile can move
    // the focused window out from under the cursor without any activation
    retiled() {
        this.timer.restart();
    }

    windowRemoved(window: Window) {
        if (this.target === window) {
            this.target = null;
            this.armPos = null;
        }
    }

    private cursorMoved(): boolean {
        const pos = this.workspace.cursorPos;
        return (
            this.armPos === null ||
            pos.x !== this.armPos.x ||
            pos.y !== this.armPos.y
        );
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
        const target = this.target;
        const moved = this.cursorMoved();
        this.target = null;
        this.armPos = null;
        let active = this.workspace.activeWindow;
        if (active !== null && (active.specialWindow || active.popupWindow)) {
            return;
        }
        if (target !== null && !moved && active !== target) {
            this.workspace.activeWindow = target;
            active = target;
        }
        if (active === null) {
            return;
        }
        if (active.move || active.resize) {
            return;
        }
        if (this.cursorInside(active)) {
            return;
        }
        this.dbus.moveMouseToFocus().call();
    }
}
