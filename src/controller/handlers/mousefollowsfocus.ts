import { Window } from "kwin-api";
import { QTimer } from "kwin-api/qt";
import { Workspace } from "kwin-api/qml";
import { DBus } from "../../extern";
import { config, controller as ctrl } from "..";

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
        // cursor already inside means a click or focus-follows-mouse reacting
        // to moving tiles; neither should retarget the warp
        if (this.cursorInside(window)) {
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
        const target = this.target;
        this.clearTarget();
        if (
            target === null ||
            !ctrl().windowExists(target) ||
            target.minimized ||
            (!target.onAllDesktops &&
                !target.desktops.includes(this.workspace.currentDesktop))
        ) {
            return;
        }
        if (this.cursorInside(target)) {
            return;
        }
        // undo any focus theft from windows sliding under the stationary
        // cursor, so MoveMouseToFocus resolves the intended window
        if (this.workspace.activeWindow !== target) {
            this.workspace.activeWindow = target;
        }
        this.dbus.moveMouseToFocus().call();
    }
}
