import { Window } from "kwin-api";
import { QPoint, QTimer } from "kwin-api/qt";
import { Workspace } from "kwin-api/qml";
import { DBus } from "../../extern";
import { config } from "..";

const displayChangeQuietMs = 250;
const hitTestDepth = 8;
// kwin's delayed focus-follows-mouse lands up to 300ms after the pointer stops
const pointerQuietMs = 400;

interface Pos {
    x: number;
    y: number;
}

export class MouseFollowsFocusHandler {
    private workspace: Workspace;
    private timer: QTimer;
    private dbus: DBus;
    // last window activated with the cursor elsewhere - a keyboard focus
    // change the warp may need to defend from focus-follows-mouse
    private target: Window | null = null;
    // a copy: cursorPos itself is a live reference into kwin
    private armPos: Pos | null = null;
    // compared by identity only; the window may already be destroyed
    private lastWindow: Window | null = null;
    private quietUntil = 0;
    private lastMotion = 0;
    // cursor state right before the last rebuild
    private wasInside = false;
    private rebuildPos: Pos | null = null;

    constructor(workspace: Workspace, timer: QTimer, dbus: DBus) {
        this.workspace = workspace;
        this.timer = timer;
        this.dbus = dbus;
        this.timer.interval = config().mouseFollowsFocusDelay;
        this.timer.repeat = false;
        this.timer.triggered.connect(this.warp.bind(this));
        this.workspace.cursorPosChanged.connect(() => {
            this.lastMotion = Date.now();
        });
    }

    windowActivated(window: Window | null) {
        if (this.effectOpen()) {
            this.reset();
            return;
        }
        if (!isTargetable(window)) {
            return;
        }
        // focus handed back after a shell popup or effect closes
        if (window === this.lastWindow) {
            return;
        }
        this.lastWindow = window;
        if (Date.now() < this.quietUntil) {
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
        // keyboard and script activations raise the window first; a delayed
        // focus-follows-mouse activation never does
        if (!this.isRaised(window) && this.motionAge() < pointerQuietMs) {
            return;
        }
        this.target = window;
        this.armPos = copyPos(this.workspace.cursorPos);
        this.timer.restart();
    }

    // called by the controller right before it rebuilds layouts
    beforeRebuild() {
        const active = this.workspace.activeWindow;
        this.wasInside = isTargetable(active) && this.cursorInside(active);
        this.rebuildPos = copyPos(this.workspace.cursorPos);
    }

    // called by the controller after rebuilding layouts; a retile can move
    // the focused window out from under the cursor without any activation
    retiled() {
        if (this.effectOpen()) {
            this.reset();
            return;
        }
        if (Date.now() < this.quietUntil) {
            return;
        }
        if (this.target === null && !this.wasInside) {
            this.timer.stop();
            return;
        }
        this.timer.restart();
    }

    // desktop switches, drags and move-to-desktop change focus without a keyboard focus move
    displayChanged() {
        this.quietUntil = Date.now() + displayChangeQuietMs;
        this.target = null;
        this.armPos = null;
        this.timer.stop();
    }

    windowRemoved(window: Window) {
        if (this.lastWindow === window) {
            this.lastWindow = null;
        }
        if (this.target === window) {
            this.target = null;
            this.armPos = null;
        }
    }

    // a full-screen effect owns the pointer; its activations must not arm or fire a warp
    private effectOpen(): boolean {
        return config().mouseFollowsFocusIgnoreEffects.some((id) => this.workspace.isEffectActive(id));
    }

    private reset() {
        this.target = null;
        this.armPos = null;
        this.timer.stop();
    }

    private motionAge(): number {
        return this.lastMotion === 0 ? Infinity : Date.now() - this.lastMotion;
    }

    private cursorMoved(): boolean {
        return this.cursorMovedSince(this.armPos);
    }

    private cursorMovedSince(p: Pos | null): boolean {
        const pos = this.workspace.cursorPos;
        return p === null || pos.x !== p.x || pos.y !== p.y;
    }

    // kwin's own hit test, past shell overlays; a cursor in a gap is inside nothing
    private cursorInside(window: Window): boolean {
        const under = this.workspace
            .windowAt(this.workspace.cursorPos, hitTestDepth)
            .find((w) => isTargetable(w));
        return under === window;
    }

    // topmost targetable window of its layer on this desktop; a window kwin
    // has not stacked yet was just mapped and goes on top
    private isRaised(window: Window): boolean {
        const order = this.workspace.stackingOrder;
        if (!order.includes(window)) {
            return true;
        }
        const desktop = this.workspace.currentDesktop;
        for (let i = order.length - 1; i >= 0; i -= 1) {
            const w = order[i];
            if (
                !isTargetable(w) ||
                w.layer !== window.layer ||
                w.minimized ||
                w.hidden ||
                (w.transient && w !== window) ||
                (!w.onAllDesktops && !w.desktops.includes(desktop))
            ) {
                continue;
            }
            return w === window;
        }
        return false;
    }

    private warp() {
        if (this.effectOpen()) {
            this.reset();
            return;
        }
        const target = this.target;
        const moved = this.cursorMoved();
        this.target = null;
        this.armPos = null;
        let active = this.workspace.activeWindow;
        if (active !== null && !isTargetable(active)) {
            return;
        }
        // a retile only earns a warp if it moved the window from under a still cursor
        if (target === null && this.cursorMovedSince(this.rebuildPos)) {
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

// layer-shell surfaces report a Normal window type, so specialWindow misses them
function isTargetable(window: Window | null): window is Window {
    return (
        window !== null &&
        !window.specialWindow &&
        !window.popupWindow &&
        !(window.skipTaskbar && !window.moveable)
    );
}

function copyPos(p: QPoint): Pos {
    return { x: p.x, y: p.y };
}
